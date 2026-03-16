import type { WordPressClient } from "../wordpress/client";
import type { WPToolHandler } from "./wp-types";
import { textResult, errorResult, formatTable } from "./format";

const definition = {
  name: "wp_list_pages",
  description:
    "List WordPress pages. Shows titles, status, dates, and URLs.",
  inputSchema: {
    type: "object",
    properties: {
      search: {
        type: "string",
        description: "Search pages by keyword",
      },
      status: {
        type: "string",
        enum: ["publish", "draft", "pending", "private"],
        description: "Filter by status",
      },
      limit: {
        type: "number",
        description: "Max pages to return (default 20, max 100)",
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

  const result = await client.listPages({
    search,
    status,
    per_page: limit,
  });

  if (!result.ok) {
    return errorResult(
      `Failed to list pages (HTTP ${result.status}): ${result.message}`,
    );
  }

  const pages = result.data;

  if (pages.length === 0) {
    return textResult("No pages found matching your criteria.");
  }

  const table = formatTable(
    ["ID", "Title", "Status", "Parent", "Date", "URL"],
    pages.map((p) => [
      p.id,
      stripHtml(p.title.rendered),
      p.status,
      p.parent || "-",
      p.date.split("T")[0],
      p.link,
    ]),
  );

  return textResult(`Found ${pages.length} page(s):\n\n${table}`);
}

export const wpListPagesTool: WPToolHandler = { definition, execute };
