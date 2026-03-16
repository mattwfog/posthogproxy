import type { PostHogClient } from "../posthog/client";
import type { WordPressClient } from "../wordpress/client";
import type { TokenData } from "../types";
import type { CrossToolHandler } from "./cross-types";
import {
  textResult,
  errorResult,
  formatTable,
  formatNumber,
} from "./format";

const definition = {
  name: "check_ab_test",
  description:
    "Check the results of an A/B test. Shows how each variant is performing based on a target event (e.g., signups, purchases).",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description: "PostHog project ID",
      },
      flag_key: {
        type: "string",
        description: "Feature flag key used for the test",
      },
      target_event: {
        type: "string",
        description:
          "Event to measure (e.g., 'sign_up', 'purchase', '$pageview')",
      },
      date_from: {
        type: "string",
        description: "Start date. Defaults to '-14d'",
      },
    },
    required: ["project_id", "flag_key", "target_event"],
  },
} as const;

interface TrendResultRow {
  readonly labels: readonly string[];
  readonly data: readonly number[];
  readonly label: string;
  readonly count: number;
  readonly breakdown_value: string;
}

async function execute(
  args: Record<string, unknown>,
  posthog: PostHogClient,
  _wordpress: WordPressClient,
  _tokenData: TokenData,
) {
  const projectId = args.project_id as number;
  const flagKey = args.flag_key as string;
  const targetEvent = args.target_event as string;
  const dateFrom =
    (args.date_from as string | undefined) ?? "-14d";

  const query = {
    kind: "TrendsQuery",
    series: [
      {
        kind: "EventsNode",
        event: targetEvent,
        math: "total",
      },
    ],
    dateRange: { date_from: dateFrom },
    breakdownFilter: {
      breakdown: `$feature/${flagKey}`,
      breakdown_type: "event",
    },
    filterTestAccounts: true,
  };

  const result = await posthog.query(projectId, query);

  if (!result.ok) {
    return errorResult(
      `A/B test query failed (HTTP ${result.status}): ${result.message}`,
    );
  }

  const rawResults =
    result.data.results as ReadonlyArray<unknown>;

  if (rawResults.length === 0) {
    return textResult(
      `No data found for flag \`${flagKey}\` with event "${targetEvent}". ` +
        "The test may not have received traffic yet, or the flag key may be incorrect.",
    );
  }

  // Check if results are TrendResultRow-shaped
  const firstRow = rawResults[0];
  const isTrendRow =
    firstRow !== null &&
    typeof firstRow === "object" &&
    "data" in (firstRow as Record<string, unknown>) &&
    "count" in (firstRow as Record<string, unknown>);

  if (!isTrendRow) {
    // Fallback: render as raw table
    const columns = result.data.columns as readonly string[];
    const table = formatTable(
      columns as string[],
      rawResults as ReadonlyArray<ReadonlyArray<unknown>>,
    );
    return textResult(
      `A/B test results for \`${flagKey}\`:\n\n${table}`,
    );
  }

  const rows = rawResults as ReadonlyArray<TrendResultRow>;

  // Build variant summary
  const variantSummaries: readonly {
    readonly variant: string;
    readonly total: number;
  }[] = rows.map((row) => ({
    variant:
      row.breakdown_value || row.label || "unknown",
    total: row.data.reduce((sum, n) => sum + n, 0),
  }));

  // Determine the winner
  const sorted = [...variantSummaries].sort(
    (a, b) => b.total - a.total,
  );
  const leader = sorted[0];
  const runnerUp = sorted[1];

  const summaryTable = formatTable(
    ["Variant", "Total Events"],
    variantSummaries.map((v) => [
      v.variant,
      formatNumber(v.total),
    ]),
  );

  // Build per-variant time series
  const timeSeriesParts: string[] = [];

  for (const row of rows) {
    const variantLabel =
      row.breakdown_value || row.label || "unknown";
    const total = row.data.reduce((sum, n) => sum + n, 0);

    const timeRows = row.labels.map((label, i) => [
      label,
      formatNumber(row.data[i] ?? 0),
    ]);

    const table = formatTable(["Date", "Count"], timeRows);
    timeSeriesParts.push(
      `### ${variantLabel} (Total: ${formatNumber(total)})\n\n${table}`,
    );
  }

  const winnerNote =
    leader && runnerUp
      ? leader.total > runnerUp.total
        ? `**Leading variant:** ${leader.variant} is ahead by ${formatNumber(leader.total - runnerUp.total)} events.`
        : leader.total === runnerUp.total
          ? "**Result:** Both variants are tied."
          : ""
      : "";

  const lines: readonly string[] = [
    `# A/B Test Results: \`${flagKey}\``,
    "",
    `**Event:** ${targetEvent}`,
    `**Date range:** ${dateFrom} to now`,
    "",
    "## Summary",
    "",
    summaryTable,
    "",
    winnerNote,
    "",
    "## Daily Breakdown",
    "",
    ...timeSeriesParts,
  ];

  return textResult(lines.join("\n"));
}

export const checkAbTestTool: CrossToolHandler = {
  definition,
  execute,
};
