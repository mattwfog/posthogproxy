import type { TokenData } from "../types";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types";
import type { WPToolHandler } from "./wp-types";
import type { CrossToolHandler } from "./cross-types";
import { createPostHogClient } from "../posthog/client";
import { createWordPressClient } from "../wordpress/client";
import { errorResult } from "./format";

// PostHog tools
import { listProjectsTool } from "./list-projects";
import { getTrendsTool } from "./get-trends";
import { findPersonTool } from "./find-person";
import { searchEventsTool } from "./search-events";
import { runQueryTool } from "./run-query";
import { getFunnelTool } from "./get-funnel";
import { getPersonEventsTool } from "./get-person-events";
import { listFeatureFlagsTool } from "./list-feature-flags";
import { listDashboardsTool } from "./list-dashboards";
import { listErrorsTool } from "./list-errors";

// WordPress tools
import { wpListPostsTool } from "./wp-list-posts";
import { wpGetPostTool } from "./wp-get-post";
import { wpUpdatePostTool } from "./wp-update-post";
import { wpListPagesTool } from "./wp-list-pages";
import { wpGetPageTool } from "./wp-get-page";
import { wpUpdatePageTool } from "./wp-update-page";

// Cross-service tools
import { createAbTestTool } from "./create-ab-test";
import { checkAbTestTool } from "./check-ab-test";
import { applyWinnerTool } from "./apply-winner";

const posthogTools: readonly ToolHandler[] = [
  listProjectsTool,
  getTrendsTool,
  findPersonTool,
  searchEventsTool,
  runQueryTool,
  getFunnelTool,
  getPersonEventsTool,
  listFeatureFlagsTool,
  listDashboardsTool,
  listErrorsTool,
];

const wpTools: readonly WPToolHandler[] = [
  wpListPostsTool,
  wpGetPostTool,
  wpUpdatePostTool,
  wpListPagesTool,
  wpGetPageTool,
  wpUpdatePageTool,
];

const crossTools: readonly CrossToolHandler[] = [
  createAbTestTool,
  checkAbTestTool,
  applyWinnerTool,
];

export function getToolDefinitions(): readonly ToolDefinition[] {
  return [
    ...posthogTools.map((t) => t.definition),
    ...wpTools.map((t) => t.definition),
    ...crossTools.map((t) => t.definition),
  ];
}

export async function dispatchToolCall(
  name: string,
  args: Record<string, unknown>,
  tokenData: TokenData,
): Promise<ToolResult> {
  // PostHog tools
  const phTool = posthogTools.find((t) => t.definition.name === name);
  if (phTool) {
    const client = createPostHogClient(tokenData);
    return phTool.execute(args, client);
  }

  // WordPress tools
  const wpTool = wpTools.find((t) => t.definition.name === name);
  if (wpTool) {
    const client = createWordPressClient(tokenData);
    if (!client) {
      return errorResult(
        "WordPress is not connected. Re-authorize and provide your WordPress site URL, username, and application password to use this tool.",
      );
    }
    return wpTool.execute(args, client);
  }

  // Cross-service tools
  const crossTool = crossTools.find((t) => t.definition.name === name);
  if (crossTool) {
    const wpClient = createWordPressClient(tokenData);
    if (!wpClient) {
      return errorResult(
        "WordPress is not connected. Re-authorize and provide your WordPress credentials to use this tool.",
      );
    }
    const phClient = createPostHogClient(tokenData);
    return crossTool.execute(args, phClient, wpClient, tokenData);
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
}
