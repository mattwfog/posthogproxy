import type { WordPressClient } from "../wordpress/client";
import type { WPToolHandler } from "./wp-types";
import { textResult, errorResult } from "./format";

const definition = {
  name: "wp_get_page",
  description:
    "Get a WordPress page's full content by ID. Returns the title, content, status, and URL.",
  inputSchema: {
    type: "object",
    properties: {
      page_id: {
        type: "number",
        description: "WordPress page ID",
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

  const result = await client.getPage(pageId);

  if (!result.ok) {
    return errorResult(
      `Failed to get page ${pageId} (HTTP ${result.status}): ${result.message}`,
    );
  }

  const page = result.data;

  const lines: readonly string[] = [
    `# ${stripHtml(page.title.rendered)}`,
    "",
    `**ID:** ${page.id}`,
    `**Status:** ${page.status}`,
    `**Date:** ${page.date}`,
    `**Modified:** ${page.modified}`,
    `**Slug:** ${page.slug}`,
    `**Parent:** ${page.parent || "None (top-level)"}`,
    `**URL:** ${page.link}`,
    "",
    "## Content",
    "",
    stripHtml(page.content.rendered) || "_No content_",
  ];

  return textResult(lines.join("\n"));
}

export const wpGetPageTool: WPToolHandler = { definition, execute };
