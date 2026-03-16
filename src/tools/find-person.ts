import type { PostHogClient } from "../posthog/client";
import type { Person } from "../posthog/types";
import type { ToolHandler } from "./types";
import { textResult, errorResult } from "./format";

const definition = {
  name: "find_person",
  description:
    "Look up a user by email, name, or distinct ID. Returns their properties, first/last seen dates, and distinct IDs.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "number",
        description: "PostHog project ID",
      },
      search: {
        type: "string",
        description: "Email, name, or distinct ID to search for",
      },
    },
    required: ["project_id", "search"],
  },
} as const;

function formatPerson(person: Person): string {
  const lines: string[] = [];

  lines.push(`**Person ID:** ${person.id}`);
  lines.push(`**Created:** ${person.created_at}`);

  if (person.distinct_ids.length > 0) {
    lines.push(
      `**Distinct IDs:** ${person.distinct_ids.map((id) => `\`${id}\``).join(", ")}`,
    );
  }

  const props = person.properties;
  const propKeys = Object.keys(props);

  if (propKeys.length > 0) {
    lines.push("");
    lines.push("**Properties:**");
    for (const key of propKeys) {
      const value = props[key];
      const display =
        value === null || value === undefined
          ? "_not set_"
          : String(value);
      lines.push(`- ${key}: ${display}`);
    }
  }

  return lines.join("\n");
}

async function execute(
  args: Record<string, unknown>,
  client: PostHogClient,
) {
  const projectId = args.project_id as number;
  const search = args.search as string;

  const result = await client.searchPersons(projectId, search);

  if (!result.ok) {
    return errorResult(
      `Person search failed (HTTP ${result.status}): ${result.message}`,
    );
  }

  const persons = result.data.results;

  if (persons.length === 0) {
    return textResult(
      `No persons found matching "${search}". Try a different email, name, or distinct ID.`,
    );
  }

  const formatted = persons.map(
    (p, i) => `## Person ${i + 1}\n\n${formatPerson(p)}`,
  );

  const header =
    persons.length === 1
      ? `Found 1 person matching "${search}":`
      : `Found ${persons.length} persons matching "${search}":`;

  return textResult(`${header}\n\n${formatted.join("\n\n---\n\n")}`);
}

export const findPersonTool: ToolHandler = { definition, execute };
