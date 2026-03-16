import { describe, it, expect } from "vitest";
import { getToolDefinitions, dispatchToolCall } from "../../src/tools/registry";
import type { TokenData } from "../../src/types";

const EXPECTED_TOOL_NAMES = [
  "list_projects",
  "get_trends",
  "find_person",
  "search_events",
  "run_query",
  "get_funnel",
  "get_person_events",
  "list_feature_flags",
  "list_dashboards",
  "list_errors",
  "wp_list_posts",
  "wp_get_post",
  "wp_update_post",
  "wp_list_pages",
  "wp_get_page",
  "wp_update_page",
  "create_ab_test",
  "check_ab_test",
  "apply_winner",
] as const;

describe("getToolDefinitions", () => {
  it("returns all 19 tools", () => {
    const defs = getToolDefinitions();

    expect(defs).toHaveLength(19);
  });

  it("each tool has name, description, and inputSchema", () => {
    const defs = getToolDefinitions();

    for (const def of defs) {
      expect(def.name).toBeDefined();
      expect(typeof def.name).toBe("string");
      expect(def.name.length).toBeGreaterThan(0);

      expect(def.description).toBeDefined();
      expect(typeof def.description).toBe("string");
      expect(def.description.length).toBeGreaterThan(0);

      expect(def.inputSchema).toBeDefined();
      expect(typeof def.inputSchema).toBe("object");
    }
  });

  it("contains every expected tool name", () => {
    const defs = getToolDefinitions();
    const names = defs.map((d) => d.name);

    for (const expected of EXPECTED_TOOL_NAMES) {
      expect(names).toContain(expected);
    }
  });
});

describe("dispatchToolCall", () => {
  const tokenData: TokenData = {
    posthog_api_key: "phx_test_key",
    posthog_region: "us",
    client_id: "test-client",
    created_at: Date.now(),
    expires_at: Date.now() + 3600000,
  };

  it("returns error result for unknown tool", async () => {
    const result = await dispatchToolCall("nonexistent_tool", {}, tokenData);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
    expect(result.content[0].text).toContain("nonexistent_tool");
  });
});
