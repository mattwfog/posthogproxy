import type { PostHogClient } from "../posthog/client";
import type { ToolHandler } from "./types";
import { textResult, errorResult, formatTable } from "./format";

const definition = {
  name: "run_query",
  description:
    "Run a HogQL query against your PostHog data. HogQL is PostHog's SQL dialect. Use this for questions the other tools can't answer.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description: "PostHog project ID",
      },
      query: {
        type: "string",
        description:
          "HogQL SQL query. Example: SELECT event, count() FROM events WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY event ORDER BY count() DESC LIMIT 20",
      },
    },
    required: ["project_id", "query"],
  },
} as const;

async function execute(
  args: Record<string, unknown>,
  client: PostHogClient,
) {
  const projectId = args.project_id as number;
  const queryString = args.query as string | undefined;

  if (queryString === undefined || queryString.trim() === "") {
    return errorResult(
      "Query is required. Provide a HogQL SQL query string.",
    );
  }

  const hogqlQuery = {
    kind: "HogQLQuery",
    query: queryString,
  };

  const result = await client.query(projectId, hogqlQuery);

  if (!result.ok) {
    return errorResult(
      `HogQL query failed (HTTP ${result.status}): ${result.message}`,
    );
  }

  const queryResult = result.data;
  const columns = queryResult.columns as readonly string[];
  const rows = queryResult.results;

  if (rows.length === 0) {
    return textResult("Query returned no results.");
  }

  const table = formatTable(columns, rows);

  const rowCount = rows.length;
  const moreIndicator = queryResult.hasMore
    ? " (more results available -- add a LIMIT clause to control output)"
    : "";

  return textResult(
    `Query returned ${rowCount} row(s)${moreIndicator}:\n\n${table}`,
  );
}

export const runQueryTool: ToolHandler = { definition, execute };
