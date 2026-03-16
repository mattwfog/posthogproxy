import type { PostHogClient } from "../posthog/client";
import type { Event } from "../posthog/types";
import type { ToolHandler } from "./types";
import { textResult, errorResult, formatTable } from "./format";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const definition = {
  name: "search_events",
  description:
    "Search for recent events, optionally filtered by event name and properties. Find out what's happening in your product.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description: "PostHog project ID",
      },
      event: {
        type: "string",
        description:
          "Event name to filter by (e.g., '$pageview', 'purchase')",
      },
      date_from: {
        type: "string",
        description: "Start date. Defaults to '-7d'",
      },
      properties: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            value: { type: "string" },
            operator: {
              type: "string",
              enum: [
                "exact",
                "is_not",
                "contains",
                "not_contains",
                "gt",
                "lt",
              ],
            },
          },
          required: ["key", "value"],
        },
        description: "Property filters",
      },
      limit: {
        type: "number",
        description: "Max events to return (default 20, max 100)",
      },
    },
    required: ["project_id"],
  },
} as const;

function extractKeyProperties(event: Event): string {
  const props = event.properties;
  const interesting = [
    "$current_url",
    "$browser",
    "$os",
    "$referring_domain",
    "email",
  ];
  const parts: string[] = [];

  for (const key of interesting) {
    if (props[key] !== undefined && props[key] !== null) {
      parts.push(`${key}=${String(props[key])}`);
    }
  }

  return parts.length > 0 ? parts.join("; ") : "-";
}

async function execute(
  args: Record<string, unknown>,
  client: PostHogClient,
) {
  const projectId = args.project_id as number;
  const event = args.event as string | undefined;
  const dateFrom = (args.date_from as string | undefined) ?? "-7d";
  const rawLimit = args.limit as number | undefined;
  const limit = Math.min(rawLimit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const properties = args.properties as
    | ReadonlyArray<{ readonly key: string; readonly value: string; readonly operator?: string }>
    | undefined;

  const result = await client.listEvents(projectId, {
    event,
    date_from: dateFrom,
    properties,
    limit,
  });

  if (!result.ok) {
    return errorResult(
      `Event search failed (HTTP ${result.status}): ${result.message}`,
    );
  }

  const events = result.data.results;

  if (events.length === 0) {
    const eventFilter = event !== undefined ? ` for "${event}"` : "";
    return textResult(
      `No events found${eventFilter} in the given date range. Try expanding the date range or checking the event name.`,
    );
  }

  const table = formatTable(
    ["Timestamp", "Event", "Distinct ID", "Key Properties"],
    events.map((e) => [
      e.timestamp,
      e.event,
      e.distinct_id,
      extractKeyProperties(e),
    ]),
  );

  const total = result.data.count;
  const showing =
    total > events.length
      ? `Showing ${events.length} of ${total} events`
      : `Found ${events.length} event(s)`;

  return textResult(`${showing}:\n\n${table}`);
}

export const searchEventsTool: ToolHandler = { definition, execute };
