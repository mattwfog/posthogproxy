import type { PostHogClient } from "../posthog/client";
import type { FeatureFlag } from "../posthog/types";
import type { ToolHandler } from "./types";
import { textResult, errorResult, formatTable } from "./format";

const definition = {
  name: "list_feature_flags",
  description:
    "List feature flags in a project. Shows which flags are active, their rollout percentage, and type. Can filter by active status or search by flag key.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description: "PostHog project ID",
      },
      active: {
        type: "boolean",
        description: "Filter by active status. Omit to show all",
      },
      search: {
        type: "string",
        description: "Search by flag key or name",
      },
    },
    required: ["project_id"],
  },
} as const;

function describeRollout(flag: FeatureFlag): string {
  if (flag.rollout_percentage !== null) {
    return `${flag.rollout_percentage}%`;
  }
  return flag.active ? "100% (no conditions)" : "-";
}

function describeFilterType(flag: FeatureFlag): string {
  const groups = flag.filters.groups as
    | ReadonlyArray<Readonly<Record<string, unknown>>>
    | undefined;

  if (!groups || groups.length === 0) return "simple";

  const hasProperties = groups.some(
    (g) => Array.isArray(g.properties) && g.properties.length > 0,
  );

  return hasProperties ? "conditional" : "simple";
}

async function execute(
  args: Record<string, unknown>,
  client: PostHogClient,
) {
  const projectId = args.project_id as number;
  const active = args.active as boolean | undefined;
  const search = args.search as string | undefined;

  const result = await client.listFeatureFlags(projectId, {
    active,
    search,
  });

  if (!result.ok) {
    return errorResult(
      `Failed to list feature flags (HTTP ${result.status}): ${result.message}`,
    );
  }

  const flags = result.data.results;

  if (flags.length === 0) {
    const filterDesc = active !== undefined
      ? ` with active=${active}`
      : search !== undefined
        ? ` matching "${search}"`
        : "";
    return textResult(
      `No feature flags found${filterDesc}. Check the project ID or broaden your search.`,
    );
  }

  const table = formatTable(
    ["Key", "Name", "Active", "Rollout", "Type"],
    flags.map((f) => [
      f.key,
      f.name || "-",
      f.active ? "Yes" : "No",
      describeRollout(f),
      describeFilterType(f),
    ]),
  );

  return textResult(`Found ${flags.length} feature flag(s):\n\n${table}`);
}

export const listFeatureFlagsTool: ToolHandler = { definition, execute };
