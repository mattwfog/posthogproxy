import type { PostHogClient } from "../posthog/client";
import type { Event } from "../posthog/types";
import type { ToolHandler } from "./types";
import { textResult, errorResult, formatTable } from "./format";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const definition = {
  name: "get_person_events",
  description:
    "Get recent activity for a specific person. Shows what actions they've taken. Use find_person first to get their distinct_id.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description: "PostHog project ID",
      },
      distinct_id: {
        type: "string",
        description:
          "The person's distinct_id (from find_person results)",
      },
      limit: {
        type: "number",
        description: "Number of events to return (default 20, max 100)",
      },
    },
    required: ["project_id", "distinct_id"],
  },
} as const;

function extractKeyProperties(event: Event): string {
  const props = event.properties;
  const interesting = ["$current_url", "$browser"];
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
  const distinctId = args.distinct_id as string | undefined;
  const rawLimit = args.limit as number | undefined;
  const limit = Math.min(rawLimit ?? DEFAULT_LIMIT, MAX_LIMIT);

  if (distinctId === undefined || distinctId.trim() === "") {
    return errorResult(
      "distinct_id is required. Use find_person first to look up a user's distinct_id.",
    );
  }

  const result = await client.getPersonEvents(projectId, distinctId, limit);

  if (!result.ok) {
    return errorResult(
      `Failed to get person events (HTTP ${result.status}): ${result.message}`,
    );
  }

  const events = result.data.results;

  if (events.length === 0) {
    return textResult(
      `No events found for distinct_id "${distinctId}". The user may not have recent activity.`,
    );
  }

  const table = formatTable(
    ["Timestamp", "Event", "Key Properties"],
    events.map((e) => [
      e.timestamp,
      e.event,
      extractKeyProperties(e),
    ]),
  );

  const total = result.data.count;
  const showing =
    total > events.length
      ? `Showing ${events.length} of ${total} events for "${distinctId}"`
      : `Found ${events.length} event(s) for "${distinctId}"`;

  return textResult(`${showing}:\n\n${table}`);
}

export const getPersonEventsTool: ToolHandler = { definition, execute };
