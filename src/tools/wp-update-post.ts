import type { WordPressClient } from "../wordpress/client";
import type { WPToolHandler } from "./wp-types";
import { textResult, errorResult } from "./format";

const definition = {
  name: "wp_update_post",
  description:
    "Update a WordPress post's content, title, or status. Use wp_get_post first to see the current content.",
  inputSchema: {
    type: "object",
    properties: {
      post_id: {
        type: "number",
        description: "WordPress post ID",
      },
      title: {
        type: "string",
        description: "New title (omit to keep current)",
      },
      content: {
        type: "string",
        description: "New HTML content (omit to keep current)",
      },
      excerpt: {
        type: "string",
        description: "New excerpt (omit to keep current)",
      },
      status: {
        type: "string",
        enum: ["publish", "draft", "pending", "private"],
        description: "New status (omit to keep current)",
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
  const title = args.title as string | undefined;
  const content = args.content as string | undefined;
  const excerpt = args.excerpt as string | undefined;
  const status = args.status as string | undefined;

  const update: Record<string, string> = {};

  if (title !== undefined) {
    update.title = title;
  }
  if (content !== undefined) {
    update.content = content;
  }
  if (excerpt !== undefined) {
    update.excerpt = excerpt;
  }
  if (status !== undefined) {
    update.status = status;
  }

  if (Object.keys(update).length === 0) {
    return errorResult(
      "No fields to update. Provide at least one of: title, content, excerpt, status.",
    );
  }

  const result = await client.updatePost(postId, update);

  if (!result.ok) {
    return errorResult(
      `Failed to update post ${postId} (HTTP ${result.status}): ${result.message}`,
    );
  }

  const post = result.data;

  return textResult(
    `Post updated successfully.\n\n` +
      `**ID:** ${post.id}\n` +
      `**Title:** ${stripHtml(post.title.rendered)}\n` +
      `**Status:** ${post.status}\n` +
      `**URL:** ${post.link}`,
  );
}

export const wpUpdatePostTool: WPToolHandler = { definition, execute };
