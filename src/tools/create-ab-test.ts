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
  name: "create_ab_test",
  description:
    "Create an A/B test on WordPress content. Creates a PostHog feature flag with string payloads for each variant, and shows the current WordPress content that will be tested. You'll need to add the PostHog snippet to your WordPress site to evaluate the flag.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description: "PostHog project ID",
      },
      post_id: {
        type: "number",
        description: "WordPress post or page ID to test",
      },
      flag_key: {
        type: "string",
        description:
          "Feature flag key (e.g., 'homepage-headline-test')",
      },
      control_content: {
        type: "string",
        description: "Control variant content (variant A)",
      },
      test_content: {
        type: "string",
        description: "Test variant content (variant B)",
      },
      description: {
        type: "string",
        description: "What you're testing and why",
      },
    },
    required: [
      "project_id",
      "post_id",
      "flag_key",
      "control_content",
      "test_content",
    ],
  },
} as const;

interface FeatureFlagResponse {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly active: boolean;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

async function createFeatureFlag(
  tokenData: TokenData,
  projectId: number,
  flagKey: string,
  controlContent: string,
  testContent: string,
  description: string,
): Promise<
  | { readonly ok: true; readonly data: FeatureFlagResponse }
  | { readonly ok: false; readonly message: string }
> {
  const host =
    POSTHOG_HOSTS[tokenData.posthog_region] ?? POSTHOG_HOSTS.us;
  const url = `${host}/api/environments/${projectId}/feature_flags/`;
  const headers = {
    Authorization: `Bearer ${tokenData.posthog_api_key}`,
    "Content-Type": "application/json",
  };

  const body = {
    key: flagKey,
    name: description || flagKey,
    filters: {
      groups: [
        { properties: [], rollout_percentage: 100 },
      ],
      multivariate: {
        variants: [
          {
            key: "control",
            name: "Control",
            rollout_percentage: 50,
          },
          {
            key: "test",
            name: "Test",
            rollout_percentage: 50,
          },
        ],
      },
      payloads: {
        control: controlContent,
        test: testContent,
      },
    },
    active: true,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      return {
        ok: false,
        message: `PostHog API error (HTTP ${response.status}): ${text}`,
      };
    }

    const data = (await response.json()) as FeatureFlagResponse;
    return { ok: true, data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Network error";
    return { ok: false, message };
  } finally {
    clearTimeout(timeoutId);
  }
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
  const controlContent = args.control_content as string;
  const testContent = args.test_content as string;
  const description = (args.description as string | undefined) ?? "";

  // 1. Verify the WordPress post exists and get current content
  const postResult = await wordpress.getPost(postId);

  if (!postResult.ok) {
    return errorResult(
      `WordPress post ${postId} not found (HTTP ${postResult.status}): ${postResult.message}`,
    );
  }

  const post = postResult.data;
  const currentTitle = stripHtml(post.title.rendered);
  const currentContent = stripHtml(post.content.rendered);

  // 2. Create the feature flag in PostHog
  const flagResult = await createFeatureFlag(
    tokenData,
    projectId,
    flagKey,
    controlContent,
    testContent,
    description,
  );

  if (!flagResult.ok) {
    return errorResult(
      `Failed to create PostHog feature flag: ${flagResult.message}`,
    );
  }

  const flag = flagResult.data;

  // 3. Return summary
  const lines: readonly string[] = [
    "# A/B Test Created",
    "",
    `**Flag Key:** \`${flag.key}\``,
    `**Flag ID:** ${flag.id}`,
    `**Active:** ${flag.active}`,
    "",
    "## WordPress Post",
    "",
    `**Post ID:** ${post.id}`,
    `**Title:** ${currentTitle}`,
    `**URL:** ${post.link}`,
    "",
    "## Variants",
    "",
    "### Control (50%)",
    "",
    controlContent,
    "",
    "### Test (50%)",
    "",
    testContent,
    "",
    "## Current WordPress Content",
    "",
    currentContent.slice(0, 500) +
      (currentContent.length > 500 ? "..." : ""),
    "",
    "## Next Steps",
    "",
    "1. Add the PostHog JavaScript snippet to your WordPress site if not already installed",
    `2. In your theme or page template, use \`posthog.getFeatureFlag('${flagKey}')\` to get the variant`,
    "3. Replace the content dynamically based on the returned variant ('control' or 'test')",
    `4. Use \`check_ab_test\` with flag_key \`${flagKey}\` and a target event to monitor results`,
  ];

  return textResult(lines.join("\n"));
}

export const createAbTestTool: CrossToolHandler = {
  definition,
  execute,
};
