import type { PostHogClient } from "../posthog/client";
import type { ToolHandler } from "./types";
import { textResult, errorResult, formatTable } from "./format";

const MAX_DESCRIPTION_LENGTH = 80;

const definition = {
  name: "list_dashboards",
  description:
    "List dashboards in a project. Shows dashboard names, descriptions, and when they were last accessed. Good for getting a high-level overview of what's being tracked.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description: "PostHog project ID",
      },
    },
    required: ["project_id"],
  },
} as const;

function truncateDescription(description: string): string {
  if (description.length <= MAX_DESCRIPTION_LENGTH) {
    return description;
  }
  return `${description.slice(0, MAX_DESCRIPTION_LENGTH - 3)}...`;
}

function formatLastAccessed(lastAccessed: string | null): string {
  if (lastAccessed === null) return "Never";
  return lastAccessed;
}

async function execute(
  args: Record<string, unknown>,
  client: PostHogClient,
) {
  const projectId = args.project_id as number;

  const result = await client.listDashboards(projectId);

  if (!result.ok) {
    return errorResult(
      `Failed to list dashboards (HTTP ${result.status}): ${result.message}`,
    );
  }

  const dashboards = result.data.results;

  if (dashboards.length === 0) {
    return textResult(
      "No dashboards found in this project. Create one in PostHog to get started.",
    );
  }

  const table = formatTable(
    ["Name", "Description", "Last Accessed"],
    dashboards.map((d) => [
      d.name,
      truncateDescription(d.description || "-"),
      formatLastAccessed(d.last_accessed_at),
    ]),
  );

  return textResult(`Found ${dashboards.length} dashboard(s):\n\n${table}`);
}

export const listDashboardsTool: ToolHandler = { definition, execute };
