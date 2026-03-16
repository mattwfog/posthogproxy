import type { PostHogClient } from "../posthog/client";
import type { ToolHandler, ToolResult } from "./types";
import { textResult, errorResult, formatTable, formatNumber, formatPercent } from "./format";

const definition = {
  name: "get_funnel",
  description:
    "Analyze conversion funnels. Answer questions like 'what percentage of users who viewed the pricing page went on to sign up?' Define funnel steps as an ordered list of events.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description:
          "PostHog project ID (use list_projects to find this)",
      },
      steps: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        description:
          "Ordered list of event names defining the funnel (e.g., ['$pageview', 'sign_up', 'purchase'])",
      },
      date_from: {
        type: "string",
        description:
          "Start date: '-7d', '-30d', or '2025-01-01'. Defaults to '-30d'",
      },
      date_to: {
        type: "string",
        description: "End date. Defaults to today",
      },
      breakdown_by: {
        type: "string",
        description:
          "Optional property to break down by (e.g., '$browser')",
      },
    },
    required: ["project_id", "steps"],
  },
} as const;

interface FunnelStepResult {
  readonly name: string;
  readonly count: number;
  readonly conversion_rate: number;
}

async function execute(
  args: Record<string, unknown>,
  client: PostHogClient,
) {
  const projectId = args.project_id as number;
  const steps = args.steps as readonly string[] | undefined;
  const dateFrom = (args.date_from as string | undefined) ?? "-30d";
  const dateTo = args.date_to as string | undefined;
  const breakdownBy = args.breakdown_by as string | undefined;

  if (!Array.isArray(steps) || steps.length < 2) {
    return errorResult(
      "Funnel requires at least 2 steps. Provide an array of event names like ['$pageview', 'sign_up'].",
    );
  }

  const series = steps.map((event) => ({
    kind: "EventsNode",
    event,
  }));

  const dateRange: Record<string, string> = { date_from: dateFrom };
  if (dateTo !== undefined) {
    dateRange.date_to = dateTo;
  }

  const query: Record<string, unknown> = {
    kind: "FunnelsQuery",
    series,
    dateRange,
    filterTestAccounts: true,
    funnelsFilter: {
      funnelWindowInterval: 14,
      funnelWindowIntervalUnit: "day",
    },
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
      `Funnel query failed (HTTP ${result.status}): ${result.message}`,
    );
  }

  const queryResult = result.data;
  const rawResults = queryResult.results as ReadonlyArray<unknown>;

  if (rawResults.length === 0) {
    return textResult(
      "No funnel data found for the given steps and date range.",
    );
  }

  return formatFunnelResults(rawResults, steps);
}

function formatFunnelResults(
  rawResults: ReadonlyArray<unknown>,
  steps: readonly string[],
): ToolResult {
  // PostHog FunnelsQuery can return either:
  // 1. A flat array of step objects (no breakdown)
  // 2. An array of arrays (with breakdown, each sub-array is one breakdown value)
  const firstItem = rawResults[0];

  if (Array.isArray(firstItem)) {
    // Breakdown results: each entry is an array of step objects
    const parts: string[] = [];

    for (const group of rawResults as ReadonlyArray<ReadonlyArray<unknown>>) {
      const stepResults = group as ReadonlyArray<FunnelStepResult>;
      if (stepResults.length === 0) continue;

      const breakdownLabel = extractBreakdownLabel(stepResults[0]);
      const table = buildStepTable(stepResults);
      const overall = computeOverallConversion(stepResults);

      parts.push(
        `### ${breakdownLabel}\n\n${table}\n\n**Overall conversion: ${overall}**`,
      );
    }

    return textResult(
      parts.length > 0
        ? parts.join("\n\n---\n\n")
        : "No funnel data found.",
    );
  }

  // Flat results: single array of step objects
  const stepResults = rawResults as ReadonlyArray<FunnelStepResult>;
  const table = buildStepTable(stepResults);
  const overall = computeOverallConversion(stepResults);
  const stepsLabel = steps.join(" → ");

  return textResult(
    `**Funnel: ${stepsLabel}**\n\n${table}\n\n**Overall conversion (step 1 → last step): ${overall}**`,
  );
}

function buildStepTable(stepResults: ReadonlyArray<FunnelStepResult>): string {
  const rows = stepResults.map((step, i) => {
    const dropOff =
      i === 0
        ? "-"
        : formatPercent(1 - (step.count / (stepResults[i - 1]?.count || 1)));

    return [
      String(i + 1),
      step.name,
      formatNumber(step.count),
      i === 0 ? "100.0%" : formatPercent(step.count / (stepResults[0]?.count || 1)),
      dropOff,
    ];
  });

  return formatTable(
    ["Step", "Event", "Count", "Conversion from Step 1", "Drop-off from Previous"],
    rows,
  );
}

function computeOverallConversion(
  stepResults: ReadonlyArray<FunnelStepResult>,
): string {
  if (stepResults.length < 2) return "N/A";

  const firstCount = stepResults[0]?.count ?? 0;
  const lastCount = stepResults[stepResults.length - 1]?.count ?? 0;

  if (firstCount === 0) return "0.0%";
  return formatPercent(lastCount / firstCount);
}

function extractBreakdownLabel(step: FunnelStepResult): string {
  const record = step as unknown as Readonly<Record<string, unknown>>;
  if ("breakdown_value" in record) {
    const val = record.breakdown_value;
    return Array.isArray(val) ? val.join(", ") : String(val ?? "Other");
  }
  return "All users";
}

export const getFunnelTool: ToolHandler = { definition, execute };
