import type { WordPressClient } from "../wordpress/client";
import type { WPToolHandler } from "./wp-types";
import { textResult, errorResult, formatTable } from "./format";

const definition = {
  name: "wp_list_posts",
  description:
    "List WordPress posts. Shows titles, status, dates, and URLs. Can filter by search term or status.",
  inputSchema: {
    type: "object",
    properties: {
      search: {
        type: "string",
        description: "Search posts by keyword",
      },
      status: {
        type: "string",
        enum: ["publish", "draft", "pending", "private"],
        description: "Filter by status. Defaults to 'publish'",
      },
      limit: {
        type: "number",
        description: "Max posts to return (default 20, max 100)",
      },
    },
    required: [],
  },
} as const;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

async function execute(
  args: Record<string, unknown>,
  client: WordPressClient,
) {
  const search = args.search as string | undefined;
  const status = args.status as string | undefined;
  const rawLimit = args.limit as number | undefined;
  const limit = Math.min(Math.max(rawLimit ?? 20, 1), 100);

  const result = await client.listPosts({
    search,
    status,
    per_page: limit,
  });

  if (!result.ok) {
    return errorResult(
      `Failed to list posts (HTTP ${result.status}): ${result.message}`,
    );
  }

  const posts = result.data;

  if (posts.length === 0) {
    return textResult("No posts found matching your criteria.");
  }

  const table = formatTable(
    ["ID", "Title", "Status", "Date", "URL"],
    posts.map((p) => [
      p.id,
      stripHtml(p.title.rendered),
      p.status,
      p.date.split("T")[0],
      p.link,
    ]),
  );

  return textResult(`Found ${posts.length} post(s):\n\n${table}`);
}

export const wpListPostsTool: WPToolHandler = { definition, execute };
