import type { PostHogClient } from "../posthog/client";
import type { ToolHandler, ToolResult } from "./types";
import { textResult, errorResult, formatTable, formatNumber } from "./format";

const definition = {
  name: "get_trends",
  description:
    "Query event trends over time. Answer questions like 'how many signups this week?' or 'daily active users over the last month'.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description:
          "PostHog project ID (use list_projects to find this)",
      },
      event: {
        type: "string",
        description:
          "Event name (e.g., '$pageview', 'user_signed_up', '$autocapture')",
      },
      date_from: {
        type: "string",
        description:
          "Start date: '-7d', '-1m', '-1y', or '2025-01-01'. Defaults to '-7d'",
      },
      date_to: {
        type: "string",
        description: "End date. Defaults to today",
      },
      interval: {
        type: "string",
        enum: ["hour", "day", "week", "month"],
        description: "Time bucket. Defaults to 'day'",
      },
      breakdown_by: {
        type: "string",
        description:
          "Property to break down by (e.g., '$browser', '$os')",
      },
      math: {
        type: "string",
        enum: [
          "total",
          "dau",
          "weekly_active",
          "monthly_active",
          "unique_session",
        ],
        description: "Aggregation type. Defaults to 'total'",
      },
    },
    required: ["project_id", "event"],
  },
} as const;

interface TrendResultRow {
  readonly labels: readonly string[];
  readonly data: readonly number[];
  readonly label: string;
  readonly count: number;
}

async function execute(
  args: Record<string, unknown>,
  client: PostHogClient,
) {
  const projectId = args.project_id as number;
  const event = args.event as string;
  const dateFrom = (args.date_from as string | undefined) ?? "-7d";
  const dateTo = args.date_to as string | undefined;
  const interval = (args.interval as string | undefined) ?? "day";
  const breakdownBy = args.breakdown_by as string | undefined;
  const math = (args.math as string | undefined) ?? "total";

  const series = [
    {
      kind: "EventsNode",
      event,
      math,
    },
  ];

  const dateRange: Record<string, string> = { date_from: dateFrom };
  if (dateTo !== undefined) {
    dateRange.date_to = dateTo;
  }

  const query: Record<string, unknown> = {
    kind: "TrendsQuery",
    series,
    dateRange,
    interval,
    filterTestAccounts: true,
  };

  if (breakdownBy !== undefined) {
    query.breakdownFilter = {
      breakdown: breakdownBy,
      breakdown_type: "event",
    };
  }

  const result = await client.query(projectId, query);

  if (!result.ok) {
    return errorResult(
      `Trends query failed (HTTP ${result.status}): ${result.message}`,
    );
  }

  const queryResult = result.data;

  // The TrendsQuery returns results as an array of series, each with labels/data.
  // The QueryResult type has columns/results, but PostHog trends actually return
  // a "results" array of TrendResultRow objects. We handle both shapes.
  const rawResults = queryResult.results as ReadonlyArray<unknown>;

  if (rawResults.length === 0) {
    return textResult(
      `No trend data found for event "${event}" in the given date range.`,
    );
  }

  // Check if results look like TrendResultRow objects (have labels/data fields)
  const firstRow = rawResults[0];
  if (
    firstRow !== null &&
    typeof firstRow === "object" &&
    "labels" in (firstRow as Record<string, unknown>) &&
    "data" in (firstRow as Record<string, unknown>)
  ) {
    return formatTrendResults(
      rawResults as ReadonlyArray<TrendResultRow>,
      event,
    );
  }

  // Fallback: treat as tabular columns/results
  const columns = queryResult.columns;
  const table = formatTable(
    columns as string[],
    rawResults as ReadonlyArray<ReadonlyArray<unknown>>,
  );
  return textResult(`Trends for "${event}":\n\n${table}`);
}

function formatTrendResults(
  rows: ReadonlyArray<TrendResultRow>,
  event: string,
): ToolResult {
  const parts: string[] = [];

  for (const series of rows) {
    const seriesLabel = series.label || event;

    const tableRows = series.labels.map((label, i) => [
      label,
      formatNumber(series.data[i] ?? 0),
    ]);

    const total = series.data.reduce((sum, n) => sum + n, 0);

    const table = formatTable(["Date", "Count"], tableRows);
    parts.push(
      `### ${seriesLabel}\n\n${table}\n\n**Total: ${formatNumber(total)}**`,
    );
  }

  return textResult(parts.join("\n\n---\n\n"));
}

export const getTrendsTool: ToolHandler = { definition, execute };
