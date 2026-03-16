import type { WordPressClient } from "../wordpress/client";
import type { WPToolHandler } from "./wp-types";
import { textResult, errorResult } from "./format";

const definition = {
  name: "wp_update_page",
  description:
    "Update a WordPress page's content, title, or status.",
  inputSchema: {
    type: "object",
    properties: {
      page_id: {
        type: "number",
        description: "WordPress page ID",
      },
      title: {
        type: "string",
        description: "New title",
      },
      content: {
        type: "string",
        description: "New HTML content",
      },
      status: {
        type: "string",
        enum: ["publish", "draft", "pending", "private"],
        description: "New status",
      },
    },
    required: ["page_id"],
  },
} as const;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

async function execute(
  args: Record<string, unknown>,
  client: WordPressClient,
) {
  const pageId = args.page_id as number;
  const title = args.title as string | undefined;
  const content = args.content as string | undefined;
  const status = args.status as string | undefined;

  const update: Record<string, string> = {};

  if (title !== undefined) {
    update.title = title;
  }
  if (content !== undefined) {
    update.content = content;
  }
  if (status !== undefined) {
    update.status = status;
  }

  if (Object.keys(update).length === 0) {
    return errorResult(
      "No fields to update. Provide at least one of: title, content, status.",
    );
  }

  const result = await client.updatePage(pageId, update);

  if (!result.ok) {
    return errorResult(
      `Failed to update page ${pageId} (HTTP ${result.status}): ${result.message}`,
    );
  }

  const page = result.data;

  return textResult(
    `Page updated successfully.\n\n` +
      `**ID:** ${page.id}\n` +
      `**Title:** ${stripHtml(page.title.rendered)}\n` +
      `**Status:** ${page.status}\n` +
      `**URL:** ${page.link}`,
  );
}

export const wpUpdatePageTool: WPToolHandler = { definition, execute };
