import type { PostHogClient } from "../posthog/client";
import type { WordPressClient } from "../wordpress/client";
import type { TokenData } from "../types";
import type { CrossToolHandler } from "./cross-types";
import { textResult, errorResult } from "./format";

const POSTHOG_HOSTS: Readonly<Record<string, string>> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

const REQUEST_TIMEOUT_MS = 30_000;

const definition = {
  name: "apply_winner",
  description:
    "End an A/B test by applying the winning variant's content to the WordPress post and disabling the feature flag in PostHog.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description: "PostHog project ID",
      },
      post_id: {
        type: "number",
        description: "WordPress post or page ID",
      },
      flag_key: {
        type: "string",
        description: "Feature flag key to disable",
      },
      winning_content: {
        type: "string",
        description:
          "The winning variant's content to apply to WordPress",
      },
    },
    required: [
      "project_id",
      "post_id",
      "flag_key",
      "winning_content",
    ],
  },
} as const;

interface FeatureFlagListItem {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly active: boolean;
}

interface FeatureFlagListResponse {
  readonly results: readonly FeatureFlagListItem[];
}

/**
 * Finds a feature flag by key, then disables it via PATCH.
 * Returns the disabled flag on success or an error message on failure.
 */
async function disableFeatureFlag(
  tokenData: TokenData,
  projectId: number,
  flagKey: string,
): Promise<
  | { readonly ok: true; readonly flagId: number }
  | { readonly ok: false; readonly message: string }
> {
  const host =
    POSTHOG_HOSTS[tokenData.posthog_region] ?? POSTHOG_HOSTS.us;
  const headers = {
    Authorization: `Bearer ${tokenData.posthog_api_key}`,
    "Content-Type": "application/json",
  };

  // Step 1: Find the flag by key
  const listUrl = `${host}/api/environments/${projectId}/feature_flags/?key=${encodeURIComponent(flagKey)}`;

  const controller1 = new AbortController();
  const timeout1 = setTimeout(
    () => controller1.abort(),
    REQUEST_TIMEOUT_MS,
  );

  let flagId: number;

  try {
    const listResponse = await fetch(listUrl, {
      method: "GET",
      headers,
      signal: controller1.signal,
    });

    if (!listResponse.ok) {
      const text = await listResponse
        .text()
        .catch(() => "Unknown error");
      return {
        ok: false,
        message: `Failed to look up flag "${flagKey}" (HTTP ${listResponse.status}): ${text}`,
      };
    }

    const listData =
      (await listResponse.json()) as FeatureFlagListResponse;
    const match = listData.results.find(
      (f) => f.key === flagKey,
    );

    if (!match) {
      return {
        ok: false,
        message: `Feature flag "${flagKey}" not found in project ${projectId}`,
      };
    }

    flagId = match.id;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Network error";
    return { ok: false, message };
  } finally {
    clearTimeout(timeout1);
  }

  // Step 2: Disable the flag via PATCH
  const patchUrl = `${host}/api/environments/${projectId}/feature_flags/${flagId}/`;

  const controller2 = new AbortController();
  const timeout2 = setTimeout(
    () => controller2.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const patchResponse = await fetch(patchUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ active: false }),
      signal: controller2.signal,
    });

    if (!patchResponse.ok) {
      const text = await patchResponse
        .text()
        .catch(() => "Unknown error");
      return {
        ok: false,
        message: `Failed to disable flag "${flagKey}" (HTTP ${patchResponse.status}): ${text}`,
      };
    }

    return { ok: true, flagId };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Network error";
    return { ok: false, message };
  } finally {
    clearTimeout(timeout2);
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

async function execute(
  args: Record<string, unknown>,
  _posthog: PostHogClient,
  wordpress: WordPressClient,
  tokenData: TokenData,
) {
  const projectId = args.project_id as number;
  const postId = args.post_id as number;
  const flagKey = args.flag_key as string;
  const winningContent = args.winning_content as string;

  // 1. Update the WordPress post with the winning content
  const updateResult = await wordpress.updatePost(postId, {
    content: winningContent,
  });

  if (!updateResult.ok) {
    return errorResult(
      `Failed to update WordPress post ${postId} (HTTP ${updateResult.status}): ${updateResult.message}. ` +
        "The feature flag was NOT disabled since the content update failed.",
    );
  }

  const updatedPost = updateResult.data;

  // 2. Disable the feature flag in PostHog
  const flagResult = await disableFeatureFlag(
    tokenData,
    projectId,
    flagKey,
  );

  if (!flagResult.ok) {
    return errorResult(
      `WordPress post ${postId} was updated, but failed to disable the PostHog flag: ${flagResult.message}. ` +
        `Please manually disable flag "${flagKey}" in PostHog.`,
    );
  }

  // 3. Return confirmation
  const lines: readonly string[] = [
    "# A/B Test Concluded",
    "",
    "## WordPress Post Updated",
    "",
    `**Post ID:** ${updatedPost.id}`,
    `**Title:** ${stripHtml(updatedPost.title.rendered)}`,
    `**Status:** ${updatedPost.status}`,
    `**URL:** ${updatedPost.link}`,
    "",
    "## PostHog Feature Flag Disabled",
    "",
    `**Flag Key:** \`${flagKey}\``,
    `**Flag ID:** ${flagResult.flagId}`,
    `**Active:** false`,
    "",
    "The winning content has been applied and the feature flag has been deactivated. " +
      "All visitors will now see the winning variant directly from WordPress.",
  ];

  return textResult(lines.join("\n"));
}

export const applyWinnerTool: CrossToolHandler = {
  definition,
  execute,
};
