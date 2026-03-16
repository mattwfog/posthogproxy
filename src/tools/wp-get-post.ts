import type { WordPressClient } from "../wordpress/client";
import type { WPToolHandler } from "./wp-types";
import { textResult, errorResult } from "./format";

const definition = {
  name: "wp_get_post",
  description:
    "Get a WordPress post's full content by ID. Returns the title, content, excerpt, status, and URL.",
  inputSchema: {
    type: "object",
    properties: {
      post_id: {
        type: "number",
        description: "WordPress post ID",
      },
    },
    required: ["post_id"],
  },
} as const;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

async function execute(
  args: Record<string, unknown>,
  client: WordPressClient,
) {
  const postId = args.post_id as number;

  const result = await client.getPost(postId);

  if (!result.ok) {
    return errorResult(
      `Failed to get post ${postId} (HTTP ${result.status}): ${result.message}`,
    );
  }

  const post = result.data;

  const lines: readonly string[] = [
    `# ${stripHtml(post.title.rendered)}`,
    "",
    `**ID:** ${post.id}`,
    `**Status:** ${post.status}`,
    `**Date:** ${post.date}`,
    `**Modified:** ${post.modified}`,
    `**Slug:** ${post.slug}`,
    `**URL:** ${post.link}`,
    "",
    "## Excerpt",
    "",
    stripHtml(post.excerpt.rendered) || "_No excerpt_",
    "",
    "## Content",
    "",
    stripHtml(post.content.rendered) || "_No content_",
  ];

  return textResult(lines.join("\n"));
}

export const wpGetPostTool: WPToolHandler = { definition, execute };
