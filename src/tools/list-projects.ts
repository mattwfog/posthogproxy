import type { PostHogClient } from "../posthog/client";
import type { ToolHandler } from "./types";
import { textResult, errorResult, formatTable } from "./format";

const definition = {
  name: "list_projects",
  description:
    "List all PostHog projects and organizations you have access to. Use this first to find the project_id needed by other tools.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
} as const;

async function execute(
  _args: Record<string, unknown>,
  client: PostHogClient,
) {
  const result = await client.listProjects();

  if (!result.ok) {
    return errorResult(
      `Failed to list projects (HTTP ${result.status}): ${result.message}`,
    );
  }

  const projects = result.data;

  if (projects.length === 0) {
    return textResult("No projects found. Check your API key permissions.");
  }

  const table = formatTable(
    ["Project ID", "Name", "Organization", "Created"],
    projects.map((p) => [p.id, p.name, p.organization, p.created_at]),
  );

  return textResult(`Found ${projects.length} project(s):\n\n${table}`);
}

export const listProjectsTool: ToolHandler = { definition, execute };
