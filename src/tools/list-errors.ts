import type { PostHogClient } from "../posthog/client";
import type { ToolHandler, ToolResult } from "./types";
import { textResult, errorResult, formatTable, formatNumber } from "./format";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const definition = {
  name: "list_errors",
  description:
    "List top errors from PostHog error tracking. Shows error groups sorted by occurrence count. Use this to find what's breaking in your product.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description: "PostHog project ID",
      },
      date_from: {
        type: "string",
        description: "Start date. Defaults to '-7d'",
      },
      status: {
        type: "string",
        enum: ["active", "resolved", "suppressed"],
        description: "Filter by error status. Defaults to 'active'",
      },
      limit: {
        type: "number",
        description: "Max errors to return (default 20)",
      },
    },
    required: ["project_id"],
  },
} as const;

interface ErrorTrackingRow {
  readonly type: string;
  readonly description: string;
  readonly occurrences: number;
  readonly status: string;
}

async function execute(
  args: Record<string, unknown>,
  client: PostHogClient,
) {
  const projectId = args.project_id as number;
  const dateFrom = (args.date_from as string | undefined) ?? "-7d";
  const status = (args.status as string | undefined) ?? "active";
  const rawLimit = args.limit as number | undefined;
  const limit = Math.min(rawLimit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const query: Record<string, unknown> = {
    kind: "ErrorTrackingQuery",
    dateRange: { date_from: dateFrom },
    orderBy: "occurrences",
    filterTestAccounts: true,
    status,
    limit,
  };

  const result = await client.query(projectId, query);

  if (!result.ok) {
    return errorResult(
      `Error tracking query failed (HTTP ${result.status}): ${result.message}`,
    );
  }

  const queryResult = result.data;
  const rawResults = queryResult.results as ReadonlyArray<unknown>;

  if (rawResults.length === 0) {
    return textResult(
      `No ${status} errors found in the last ${dateFrom.replace("-", "")}. That's a good sign.`,
    );
  }

  // ErrorTrackingQuery may return results as objects or as tabular rows.
  // Handle both shapes.
  const firstRow = rawResults[0];

  if (
    firstRow !== null &&
    typeof firstRow === "object" &&
    !Array.isArray(firstRow) &&
    "occurrences" in (firstRow as Record<string, unknown>)
  ) {
    return formatErrorObjects(
      rawResults as ReadonlyArray<ErrorTrackingRow>,
      status,
    );
  }

  // Tabular fallback: use columns from QueryResult
  const columns = queryResult.columns as readonly string[];
  const table = formatTable(
    columns,
    rawResults as ReadonlyArray<ReadonlyArray<unknown>>,
  );

  return textResult(`Errors (status: ${status}):\n\n${table}`);
}

function formatErrorObjects(
  errors: ReadonlyArray<ErrorTrackingRow>,
  status: string,
): ToolResult {
  const table = formatTable(
    ["Type", "Message", "Occurrences", "Status"],
    errors.map((e) => [
      e.type || "Unknown",
      truncateMessage(e.description || "-"),
      formatNumber(e.occurrences),
      e.status || status,
    ]),
  );

  const totalOccurrences = errors.reduce((sum, e) => sum + e.occurrences, 0);

  return textResult(
    `Found ${errors.length} error group(s) with ${formatNumber(totalOccurrences)} total occurrences:\n\n${table}`,
  );
}

function truncateMessage(message: string): string {
  const MAX_MESSAGE_LENGTH = 80;
  if (message.length <= MAX_MESSAGE_LENGTH) return message;
  return `${message.slice(0, MAX_MESSAGE_LENGTH - 3)}...`;
}

export const listErrorsTool: ToolHandler = { definition, execute };
