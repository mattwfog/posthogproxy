import { describe, it, expect } from "vitest";
import type { PostHogClient, PostHogResult } from "../../src/posthog/client";
import type {
  Project,
  Person,
  Event,
  FeatureFlag,
  Dashboard,
  QueryResult,
  PaginatedResponse,
} from "../../src/posthog/types";
import { listProjectsTool } from "../../src/tools/list-projects";
import { getTrendsTool } from "../../src/tools/get-trends";
import { getFunnelTool } from "../../src/tools/get-funnel";
import { findPersonTool } from "../../src/tools/find-person";
import { getPersonEventsTool } from "../../src/tools/get-person-events";
import { searchEventsTool } from "../../src/tools/search-events";
import { listFeatureFlagsTool } from "../../src/tools/list-feature-flags";
import { listDashboardsTool } from "../../src/tools/list-dashboards";
import { listErrorsTool } from "../../src/tools/list-errors";
import { runQueryTool } from "../../src/tools/run-query";

function createMockClient(
  overrides: Partial<PostHogClient> = {},
): PostHogClient {
  return {
    listProjects: async (): Promise<PostHogResult<readonly Project[]>> => ({
      ok: true,
      data: [],
    }),
    query: async (): Promise<PostHogResult<QueryResult>> => ({
      ok: true,
      data: { columns: [], results: [] },
    }),
    listEvents: async (): Promise<PostHogResult<PaginatedResponse<Event>>> => ({
      ok: true,
      data: { count: 0, results: [], next: null },
    }),
    searchPersons: async (): Promise<
      PostHogResult<PaginatedResponse<Person>>
    > => ({
      ok: true,
      data: { count: 0, results: [], next: null },
    }),
    getPersonEvents: async (): Promise<
      PostHogResult<PaginatedResponse<Event>>
    > => ({
      ok: true,
      data: { count: 0, results: [], next: null },
    }),
    listFeatureFlags: async (): Promise<
      PostHogResult<PaginatedResponse<FeatureFlag>>
    > => ({
      ok: true,
      data: { count: 0, results: [], next: null },
    }),
    listDashboards: async (): Promise<
      PostHogResult<PaginatedResponse<Dashboard>>
    > => ({
      ok: true,
      data: { count: 0, results: [], next: null },
    }),
    ...overrides,
  };
}

function apiError(status: number, message: string): PostHogResult<never> {
  return { ok: false, status, message };
}

// ---------------------------------------------------------------------------
// list_projects
// ---------------------------------------------------------------------------

describe("list_projects", () => {
  it("returns formatted table with project data", async () => {
    const client = createMockClient({
      listProjects: async () => ({
        ok: true,
        data: [
          {
            id: 1,
            name: "My App",
            organization: "Acme Corp",
            created_at: "2025-01-01",
          },
          {
            id: 2,
            name: "Staging",
            organization: "Acme Corp",
            created_at: "2025-02-01",
          },
        ],
      }),
    });

    const result = await listProjectsTool.execute({}, client);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Found 2 project(s)");
    expect(result.content[0].text).toContain("My App");
    expect(result.content[0].text).toContain("Staging");
    expect(result.content[0].text).toContain("Acme Corp");
  });

  it("handles empty project list", async () => {
    const client = createMockClient({
      listProjects: async () => ({ ok: true, data: [] }),
    });

    const result = await listProjectsTool.execute({}, client);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No projects found");
  });

  it("handles API error", async () => {
    const client = createMockClient({
      listProjects: async () => apiError(403, "Forbidden"),
    });

    const result = await listProjectsTool.execute({}, client);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 403");
    expect(result.content[0].text).toContain("Forbidden");
  });
});

// ---------------------------------------------------------------------------
// get_trends
// ---------------------------------------------------------------------------

describe("get_trends", () => {
  it("returns formatted trend data with totals", async () => {
    const client = createMockClient({
      query: async () => ({
        ok: true,
        data: {
          columns: [],
          results: [
            {
              label: "$pageview",
              labels: ["2025-01-01", "2025-01-02", "2025-01-03"],
              data: [100, 200, 150],
              count: 450,
            },
          ] as unknown as readonly (readonly unknown[])[],
        },
      }),
    });

    const result = await getTrendsTool.execute(
      { project_id: 1, event: "$pageview" },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("$pageview");
    expect(result.content[0].text).toContain("2025-01-01");
    expect(result.content[0].text).toContain("Total: 450");
  });

  it("applies default date_from of -7d", async () => {
    let capturedQuery: Record<string, unknown> | undefined;

    const client = createMockClient({
      query: async (_projectId: number, query: object) => {
        capturedQuery = query as Record<string, unknown>;
        return {
          ok: true,
          data: { columns: [], results: [] },
        };
      },
    });

    await getTrendsTool.execute({ project_id: 1, event: "$pageview" }, client);

    expect(capturedQuery).toBeDefined();
    const dateRange = capturedQuery!.dateRange as Record<string, string>;
    expect(dateRange.date_from).toBe("-7d");
  });

  it("includes breakdown filter only when breakdown_by provided", async () => {
    let capturedQuery: Record<string, unknown> | undefined;

    const client = createMockClient({
      query: async (_projectId: number, query: object) => {
        capturedQuery = query as Record<string, unknown>;
        return { ok: true, data: { columns: [], results: [] } };
      },
    });

    // Without breakdown_by
    await getTrendsTool.execute({ project_id: 1, event: "$pageview" }, client);
    expect(capturedQuery!.breakdownFilter).toBeUndefined();

    // With breakdown_by
    await getTrendsTool.execute(
      { project_id: 1, event: "$pageview", breakdown_by: "$browser" },
      client,
    );
    expect(capturedQuery!.breakdownFilter).toEqual({
      breakdown: "$browser",
      breakdown_type: "event",
    });
  });

  it("handles API error", async () => {
    const client = createMockClient({
      query: async () => apiError(500, "Internal Server Error"),
    });

    const result = await getTrendsTool.execute(
      { project_id: 1, event: "$pageview" },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 500");
  });
});

// ---------------------------------------------------------------------------
// get_funnel
// ---------------------------------------------------------------------------

describe("get_funnel", () => {
  it("returns step-by-step conversion data", async () => {
    const client = createMockClient({
      query: async () => ({
        ok: true,
        data: {
          columns: [],
          results: [
            { name: "$pageview", count: 1000, conversion_rate: 1.0 },
            { name: "sign_up", count: 300, conversion_rate: 0.3 },
            { name: "purchase", count: 50, conversion_rate: 0.05 },
          ] as unknown as readonly (readonly unknown[])[],
        },
      }),
    });

    const result = await getFunnelTool.execute(
      {
        project_id: 1,
        steps: ["$pageview", "sign_up", "purchase"],
      },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("$pageview");
    expect(result.content[0].text).toContain("sign_up");
    expect(result.content[0].text).toContain("purchase");
    expect(result.content[0].text).toContain("1,000");
    expect(result.content[0].text).toContain("Overall conversion");
  });

  it("validates steps array has at least 2 items", async () => {
    const client = createMockClient();

    const result = await getFunnelTool.execute(
      { project_id: 1, steps: ["$pageview"] },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("at least 2 steps");
  });

  it("returns error when steps is not an array", async () => {
    const client = createMockClient();

    const result = await getFunnelTool.execute(
      { project_id: 1, steps: "not_an_array" },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("at least 2 steps");
  });

  it("handles API error", async () => {
    const client = createMockClient({
      query: async () => apiError(400, "Bad Request"),
    });

    const result = await getFunnelTool.execute(
      { project_id: 1, steps: ["$pageview", "sign_up"] },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 400");
  });
});

// ---------------------------------------------------------------------------
// find_person
// ---------------------------------------------------------------------------

describe("find_person", () => {
  it("returns formatted person properties", async () => {
    const client = createMockClient({
      searchPersons: async () => ({
        ok: true,
        data: {
          count: 1,
          results: [
            {
              id: 42,
              distinct_ids: ["user-abc-123"],
              properties: {
                email: "alice@example.com",
                name: "Alice",
              },
              created_at: "2025-01-15T10:00:00Z",
            },
          ],
          next: null,
        },
      }),
    });

    const result = await findPersonTool.execute(
      { project_id: 1, search: "alice@example.com" },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Found 1 person");
    expect(result.content[0].text).toContain("alice@example.com");
    expect(result.content[0].text).toContain("user-abc-123");
    expect(result.content[0].text).toContain("Alice");
  });

  it("handles no results", async () => {
    const client = createMockClient({
      searchPersons: async () => ({
        ok: true,
        data: { count: 0, results: [], next: null },
      }),
    });

    const result = await findPersonTool.execute(
      { project_id: 1, search: "nobody@example.com" },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No persons found");
  });

  it("handles API error", async () => {
    const client = createMockClient({
      searchPersons: async () => apiError(500, "Server Error"),
    });

    const result = await findPersonTool.execute(
      { project_id: 1, search: "test" },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 500");
  });
});

// ---------------------------------------------------------------------------
// get_person_events
// ---------------------------------------------------------------------------

describe("get_person_events", () => {
  it("returns formatted event timeline", async () => {
    const client = createMockClient({
      getPersonEvents: async () => ({
        ok: true,
        data: {
          count: 2,
          results: [
            {
              id: "evt-1",
              event: "$pageview",
              distinct_id: "user-abc",
              properties: { $current_url: "https://example.com" },
              timestamp: "2025-01-15T10:00:00Z",
            },
            {
              id: "evt-2",
              event: "sign_up",
              distinct_id: "user-abc",
              properties: { $browser: "Chrome" },
              timestamp: "2025-01-15T10:05:00Z",
            },
          ],
          next: null,
        },
      }),
    });

    const result = await getPersonEventsTool.execute(
      { project_id: 1, distinct_id: "user-abc" },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("$pageview");
    expect(result.content[0].text).toContain("sign_up");
    expect(result.content[0].text).toContain("https://example.com");
  });

  it("returns error when distinct_id is not provided", async () => {
    const client = createMockClient();

    const result = await getPersonEventsTool.execute(
      { project_id: 1 },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("distinct_id is required");
  });

  it("returns error when distinct_id is empty string", async () => {
    const client = createMockClient();

    const result = await getPersonEventsTool.execute(
      { project_id: 1, distinct_id: "  " },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("distinct_id is required");
  });

  it("caps limit at 100", async () => {
    let capturedLimit: number | undefined;

    const client = createMockClient({
      getPersonEvents: async (
        _projectId: number,
        _distinctId: string,
        limit?: number,
      ) => {
        capturedLimit = limit;
        return {
          ok: true,
          data: { count: 0, results: [], next: null },
        };
      },
    });

    await getPersonEventsTool.execute(
      { project_id: 1, distinct_id: "user-abc", limit: 500 },
      client,
    );

    expect(capturedLimit).toBe(100);
  });

  it("handles API error", async () => {
    const client = createMockClient({
      getPersonEvents: async () => apiError(404, "Not Found"),
    });

    const result = await getPersonEventsTool.execute(
      { project_id: 1, distinct_id: "user-abc" },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 404");
  });
});

// ---------------------------------------------------------------------------
// search_events
// ---------------------------------------------------------------------------

describe("search_events", () => {
  it("returns formatted event table", async () => {
    const client = createMockClient({
      listEvents: async () => ({
        ok: true,
        data: {
          count: 1,
          results: [
            {
              id: "evt-1",
              event: "$pageview",
              distinct_id: "user-123",
              properties: {
                $current_url: "https://example.com/pricing",
                $browser: "Firefox",
              },
              timestamp: "2025-01-15T12:00:00Z",
            },
          ],
          next: null,
        },
      }),
    });

    const result = await searchEventsTool.execute(
      { project_id: 1, event: "$pageview" },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("$pageview");
    expect(result.content[0].text).toContain("user-123");
    expect(result.content[0].text).toContain("https://example.com/pricing");
  });

  it("applies default limit of 20", async () => {
    let capturedParams: { limit?: number } | undefined;

    const client = createMockClient({
      listEvents: async (_projectId: number, params: { limit?: number }) => {
        capturedParams = params;
        return {
          ok: true,
          data: { count: 0, results: [], next: null },
        };
      },
    });

    await searchEventsTool.execute({ project_id: 1 }, client);

    expect(capturedParams!.limit).toBe(20);
  });

  it("caps limit at 100", async () => {
    let capturedParams: { limit?: number } | undefined;

    const client = createMockClient({
      listEvents: async (_projectId: number, params: { limit?: number }) => {
        capturedParams = params;
        return {
          ok: true,
          data: { count: 0, results: [], next: null },
        };
      },
    });

    await searchEventsTool.execute(
      { project_id: 1, limit: 999 },
      client,
    );

    expect(capturedParams!.limit).toBe(100);
  });

  it("handles API error", async () => {
    const client = createMockClient({
      listEvents: async () => apiError(502, "Bad Gateway"),
    });

    const result = await searchEventsTool.execute(
      { project_id: 1 },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 502");
  });
});

// ---------------------------------------------------------------------------
// list_feature_flags
// ---------------------------------------------------------------------------

describe("list_feature_flags", () => {
  it("returns formatted flag table", async () => {
    const client = createMockClient({
      listFeatureFlags: async () => ({
        ok: true,
        data: {
          count: 2,
          results: [
            {
              id: 1,
              key: "new-onboarding",
              name: "New Onboarding Flow",
              active: true,
              rollout_percentage: 50,
              filters: { groups: [] },
            },
            {
              id: 2,
              key: "dark-mode",
              name: "Dark Mode",
              active: false,
              rollout_percentage: null,
              filters: { groups: [] },
            },
          ],
          next: null,
        },
      }),
    });

    const result = await listFeatureFlagsTool.execute(
      { project_id: 1 },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Found 2 feature flag(s)");
    expect(result.content[0].text).toContain("new-onboarding");
    expect(result.content[0].text).toContain("50%");
    expect(result.content[0].text).toContain("dark-mode");
  });

  it("passes active and search params to client", async () => {
    let capturedParams:
      | { active?: boolean; search?: string }
      | undefined;

    const client = createMockClient({
      listFeatureFlags: async (
        _projectId: number,
        params?: { active?: boolean; search?: string },
      ) => {
        capturedParams = params;
        return {
          ok: true,
          data: { count: 0, results: [], next: null },
        };
      },
    });

    await listFeatureFlagsTool.execute(
      { project_id: 1, active: true, search: "onboarding" },
      client,
    );

    expect(capturedParams).toEqual({
      active: true,
      search: "onboarding",
    });
  });

  it("handles empty flag list", async () => {
    const client = createMockClient({
      listFeatureFlags: async () => ({
        ok: true,
        data: { count: 0, results: [], next: null },
      }),
    });

    const result = await listFeatureFlagsTool.execute(
      { project_id: 1 },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No feature flags found");
  });

  it("handles API error", async () => {
    const client = createMockClient({
      listFeatureFlags: async () => apiError(401, "Unauthorized"),
    });

    const result = await listFeatureFlagsTool.execute(
      { project_id: 1 },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 401");
  });
});

// ---------------------------------------------------------------------------
// list_dashboards
// ---------------------------------------------------------------------------

describe("list_dashboards", () => {
  it("returns formatted dashboard table", async () => {
    const client = createMockClient({
      listDashboards: async () => ({
        ok: true,
        data: {
          count: 2,
          results: [
            {
              id: 10,
              name: "Product Analytics",
              description: "Main product metrics",
              created_at: "2025-01-01",
              last_accessed_at: "2025-03-01T12:00:00Z",
            },
            {
              id: 11,
              name: "Growth",
              description: "Acquisition and retention",
              created_at: "2025-02-01",
              last_accessed_at: null,
            },
          ],
          next: null,
        },
      }),
    });

    const result = await listDashboardsTool.execute(
      { project_id: 1 },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Found 2 dashboard(s)");
    expect(result.content[0].text).toContain("Product Analytics");
    expect(result.content[0].text).toContain("Growth");
    expect(result.content[0].text).toContain("Never");
  });

  it("handles empty dashboard list", async () => {
    const client = createMockClient({
      listDashboards: async () => ({
        ok: true,
        data: { count: 0, results: [], next: null },
      }),
    });

    const result = await listDashboardsTool.execute(
      { project_id: 1 },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No dashboards found");
  });

  it("handles API error", async () => {
    const client = createMockClient({
      listDashboards: async () => apiError(500, "Internal Server Error"),
    });

    const result = await listDashboardsTool.execute(
      { project_id: 1 },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 500");
  });
});

// ---------------------------------------------------------------------------
// list_errors
// ---------------------------------------------------------------------------

describe("list_errors", () => {
  it("returns formatted error groups", async () => {
    const client = createMockClient({
      query: async () => ({
        ok: true,
        data: {
          columns: [],
          results: [
            {
              type: "TypeError",
              description: "Cannot read properties of null",
              occurrences: 1500,
              status: "active",
            },
            {
              type: "ReferenceError",
              description: "x is not defined",
              occurrences: 300,
              status: "active",
            },
          ] as unknown as readonly (readonly unknown[])[],
        },
      }),
    });

    const result = await listErrorsTool.execute({ project_id: 1 }, client);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("TypeError");
    expect(result.content[0].text).toContain("Cannot read properties of null");
    expect(result.content[0].text).toContain("1,500");
    expect(result.content[0].text).toContain("1,800");
  });

  it("applies default date_from of -7d", async () => {
    let capturedQuery: Record<string, unknown> | undefined;

    const client = createMockClient({
      query: async (_projectId: number, query: object) => {
        capturedQuery = query as Record<string, unknown>;
        return { ok: true, data: { columns: [], results: [] } };
      },
    });

    await listErrorsTool.execute({ project_id: 1 }, client);

    const dateRange = capturedQuery!.dateRange as Record<string, string>;
    expect(dateRange.date_from).toBe("-7d");
  });

  it("handles no errors found", async () => {
    const client = createMockClient({
      query: async () => ({
        ok: true,
        data: { columns: [], results: [] },
      }),
    });

    const result = await listErrorsTool.execute({ project_id: 1 }, client);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No active errors found");
  });

  it("handles API error", async () => {
    const client = createMockClient({
      query: async () => apiError(503, "Service Unavailable"),
    });

    const result = await listErrorsTool.execute({ project_id: 1 }, client);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 503");
  });
});

// ---------------------------------------------------------------------------
// run_query
// ---------------------------------------------------------------------------

describe("run_query", () => {
  it("returns formatted query results", async () => {
    const client = createMockClient({
      query: async () => ({
        ok: true,
        data: {
          columns: ["event", "count"],
          results: [
            ["$pageview", 500],
            ["sign_up", 120],
          ],
        },
      }),
    });

    const result = await runQueryTool.execute(
      {
        project_id: 1,
        query: "SELECT event, count() FROM events GROUP BY event",
      },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("2 row(s)");
    expect(result.content[0].text).toContain("$pageview");
    expect(result.content[0].text).toContain("500");
    expect(result.content[0].text).toContain("sign_up");
  });

  it("validates query is not empty", async () => {
    const client = createMockClient();

    const result = await runQueryTool.execute(
      { project_id: 1, query: "" },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Query is required");
  });

  it("validates query is not whitespace-only", async () => {
    const client = createMockClient();

    const result = await runQueryTool.execute(
      { project_id: 1, query: "   " },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Query is required");
  });

  it("validates query is not undefined", async () => {
    const client = createMockClient();

    const result = await runQueryTool.execute({ project_id: 1 }, client);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Query is required");
  });

  it("handles API error", async () => {
    const client = createMockClient({
      query: async () => apiError(400, "Syntax error in HogQL"),
    });

    const result = await runQueryTool.execute(
      { project_id: 1, query: "SELECT invalid FROM nowhere" },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 400");
    expect(result.content[0].text).toContain("Syntax error");
  });

  it("indicates when more results are available", async () => {
    const client = createMockClient({
      query: async () => ({
        ok: true,
        data: {
          columns: ["event"],
          results: [["$pageview"]],
          hasMore: true,
        },
      }),
    });

    const result = await runQueryTool.execute(
      { project_id: 1, query: "SELECT event FROM events" },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("more results available");
  });

  it("handles empty query results", async () => {
    const client = createMockClient({
      query: async () => ({
        ok: true,
        data: { columns: ["event"], results: [] },
      }),
    });

    const result = await runQueryTool.execute(
      { project_id: 1, query: "SELECT event FROM events WHERE 1=0" },
      client,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("no results");
  });
});
