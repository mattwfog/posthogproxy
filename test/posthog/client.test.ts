import { describe, it, expect } from "vitest";
import { createPostHogClient } from "../../src/posthog/client";
import type { TokenData } from "../../src/types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const US_TOKEN: TokenData = {
  posthog_api_key: "phx_test_key",
  posthog_region: "us",
  client_id: "test",
  created_at: Date.now(),
  expires_at: Date.now() + 86_400_000,
};

const EU_TOKEN: TokenData = {
  ...US_TOKEN,
  posthog_region: "eu",
};

// ---------------------------------------------------------------------------
// Mock fetcher helpers
// ---------------------------------------------------------------------------

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
  readonly signal: AbortSignal | null | undefined;
}

function createMockFetcher(status: number, body: unknown): typeof fetch {
  return async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

function createCapturingFetcher(
  status: number,
  body: unknown,
): { readonly fetcher: typeof fetch; readonly captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];

  const fetcher: typeof fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    const headerEntries: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headerEntries[k] = v;
      }
    }
    captured.push({
      url,
      method: init?.method ?? "GET",
      headers: headerEntries,
      body: init?.body !== undefined ? String(init.body) : null,
      signal: init?.signal,
    });

    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  return { fetcher, captured };
}

function createThrowingFetcher(error: Error): typeof fetch {
  return async () => {
    throw error;
  };
}

// ---------------------------------------------------------------------------
// Region routing
// ---------------------------------------------------------------------------

describe("createPostHogClient region routing", () => {
  it("US region client calls https://us.posthog.com", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, { results: [] });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listProjects();

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toMatch(/^https:\/\/us\.posthog\.com\//);
  });

  it("EU region client calls https://eu.posthog.com", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, { results: [] });
    const client = createPostHogClient(EU_TOKEN, fetcher);

    await client.listProjects();

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toMatch(/^https:\/\/eu\.posthog\.com\//);
  });
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe("createPostHogClient authentication", () => {
  it("all requests include Authorization: Bearer {api_key} header", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, { results: [] });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listProjects();

    expect(captured).toHaveLength(1);
    expect(captured[0].headers["Authorization"]).toBe(
      `Bearer ${US_TOKEN.posthog_api_key}`,
    );
  });
});

// ---------------------------------------------------------------------------
// listProjects
// ---------------------------------------------------------------------------

describe("listProjects", () => {
  it("returns ok: true with parsed projects on 200", async () => {
    const projects = [
      { id: 1, name: "Proj A", organization: "org1", created_at: "2025-01-01" },
      { id: 2, name: "Proj B", organization: "org2", created_at: "2025-06-15" },
    ];
    const fetcher = createMockFetcher(200, { results: projects });
    const client = createPostHogClient(US_TOKEN, fetcher);

    const result = await client.listProjects();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(projects);
      expect(result.data).toHaveLength(2);
    }
  });

  it("returns ok: false with status and message on non-200", async () => {
    const fetcher = createMockFetcher(403, "Forbidden");
    const client = createPostHogClient(US_TOKEN, fetcher);

    const result = await client.listProjects();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.message).toBeDefined();
    }
  });

  it("returns ok: false with status 502 on network error", async () => {
    const fetcher = createThrowingFetcher(new Error("Connection refused"));
    const client = createPostHogClient(US_TOKEN, fetcher);

    const result = await client.listProjects();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.message).toBe("Connection refused");
    }
  });
});

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

describe("query", () => {
  const projectId = 42;
  const queryPayload = { kind: "HogQLQuery", query: "SELECT count() FROM events" };

  it("sends POST to /api/environments/{projectId}/query/ with JSON body", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      columns: ["count"],
      results: [[100]],
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.query(projectId, queryPayload);

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe(
      `https://us.posthog.com/api/environments/${projectId}/query/`,
    );
    const parsedBody = JSON.parse(captured[0].body!);
    expect(parsedBody).toEqual({ query: queryPayload });
  });

  it("returns ok: true with parsed QueryResult on 200", async () => {
    const queryResult = {
      columns: ["event", "count"],
      results: [["pageview", 42]],
      hasMore: false,
    };
    const fetcher = createMockFetcher(200, queryResult);
    const client = createPostHogClient(US_TOKEN, fetcher);

    const result = await client.query(projectId, queryPayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.columns).toEqual(["event", "count"]);
      expect(result.data.results).toEqual([["pageview", 42]]);
      expect(result.data.hasMore).toBe(false);
    }
  });

  it("returns ok: false on error", async () => {
    const fetcher = createMockFetcher(500, "Internal server error");
    const client = createPostHogClient(US_TOKEN, fetcher);

    const result = await client.query(projectId, queryPayload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
    }
  });
});

// ---------------------------------------------------------------------------
// listEvents
// ---------------------------------------------------------------------------

describe("listEvents", () => {
  const projectId = 10;

  it("sends GET to /api/environments/{projectId}/events/ with query params", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listEvents(projectId, { limit: 50 });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("GET");
    const url = new URL(captured[0].url);
    expect(url.pathname).toBe(`/api/environments/${projectId}/events/`);
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("includes event param when provided", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listEvents(projectId, { event: "$pageview" });

    const url = new URL(captured[0].url);
    expect(url.searchParams.get("event")).toBe("$pageview");
  });

  it("includes properties as JSON-encoded query param when provided", async () => {
    const properties = [{ key: "browser", value: "Chrome", operator: "exact" }];
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listEvents(projectId, { properties });

    const url = new URL(captured[0].url);
    const propertiesParam = url.searchParams.get("properties");
    expect(propertiesParam).toBeDefined();
    expect(JSON.parse(propertiesParam!)).toEqual(properties);
  });

  it("includes limit param", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listEvents(projectId, { limit: 25 });

    const url = new URL(captured[0].url);
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("maps date_from to after query param", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listEvents(projectId, { date_from: "2025-01-01" });

    const url = new URL(captured[0].url);
    expect(url.searchParams.get("after")).toBe("2025-01-01");
  });

  it("returns parsed PaginatedResponse on success", async () => {
    const events = [
      {
        id: "evt1",
        event: "$pageview",
        distinct_id: "user1",
        properties: {},
        timestamp: "2025-01-01T00:00:00Z",
      },
    ];
    const responseBody = { count: 1, results: events, next: null };
    const fetcher = createMockFetcher(200, responseBody);
    const client = createPostHogClient(US_TOKEN, fetcher);

    const result = await client.listEvents(projectId, {});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.count).toBe(1);
      expect(result.data.results).toEqual(events);
      expect(result.data.next).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// searchPersons
// ---------------------------------------------------------------------------

describe("searchPersons", () => {
  const projectId = 10;

  it("sends GET to /api/environments/{projectId}/persons/ with search param", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.searchPersons(projectId, "alice@example.com");

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("GET");
    const url = new URL(captured[0].url);
    expect(url.pathname).toBe(`/api/environments/${projectId}/persons/`);
    expect(url.searchParams.get("search")).toBe("alice@example.com");
  });

  it("returns parsed PaginatedResponse on success", async () => {
    const persons = [
      {
        id: 1,
        distinct_ids: ["user_abc"],
        properties: { email: "alice@example.com" },
        created_at: "2025-03-01T00:00:00Z",
      },
    ];
    const responseBody = { count: 1, results: persons, next: null };
    const fetcher = createMockFetcher(200, responseBody);
    const client = createPostHogClient(US_TOKEN, fetcher);

    const result = await client.searchPersons(projectId, "alice@example.com");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.count).toBe(1);
      expect(result.data.results).toEqual(persons);
    }
  });
});

// ---------------------------------------------------------------------------
// getPersonEvents
// ---------------------------------------------------------------------------

describe("getPersonEvents", () => {
  const projectId = 10;

  it("sends GET with distinct_id query param", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.getPersonEvents(projectId, "user_xyz");

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("GET");
    const url = new URL(captured[0].url);
    expect(url.pathname).toBe(`/api/environments/${projectId}/events/`);
    expect(url.searchParams.get("distinct_id")).toBe("user_xyz");
  });

  it("respects limit parameter", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.getPersonEvents(projectId, "user_xyz", 5);

    const url = new URL(captured[0].url);
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("omits limit param when not provided", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.getPersonEvents(projectId, "user_xyz");

    const url = new URL(captured[0].url);
    expect(url.searchParams.has("limit")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listFeatureFlags
// ---------------------------------------------------------------------------

describe("listFeatureFlags", () => {
  const projectId = 10;

  it("sends GET to /api/environments/{projectId}/feature_flags/", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listFeatureFlags(projectId);

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("GET");
    const url = new URL(captured[0].url);
    expect(url.pathname).toBe(`/api/environments/${projectId}/feature_flags/`);
  });

  it("includes active param when provided", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listFeatureFlags(projectId, { active: true });

    const url = new URL(captured[0].url);
    expect(url.searchParams.get("active")).toBe("true");
  });

  it("includes search param when provided", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listFeatureFlags(projectId, { search: "beta" });

    const url = new URL(captured[0].url);
    expect(url.searchParams.get("search")).toBe("beta");
  });

  it("includes both active and search params when provided", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listFeatureFlags(projectId, { active: false, search: "experiment" });

    const url = new URL(captured[0].url);
    expect(url.searchParams.get("active")).toBe("false");
    expect(url.searchParams.get("search")).toBe("experiment");
  });

  it("omits params when called with no FlagParams", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listFeatureFlags(projectId);

    const url = new URL(captured[0].url);
    expect(url.searchParams.has("active")).toBe(false);
    expect(url.searchParams.has("search")).toBe(false);
  });

  it("returns parsed PaginatedResponse on success", async () => {
    const flags = [
      {
        id: 1,
        key: "beta-feature",
        name: "Beta Feature",
        active: true,
        rollout_percentage: 50,
        filters: {},
      },
    ];
    const responseBody = { count: 1, results: flags, next: null };
    const fetcher = createMockFetcher(200, responseBody);
    const client = createPostHogClient(US_TOKEN, fetcher);

    const result = await client.listFeatureFlags(projectId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.count).toBe(1);
      expect(result.data.results).toEqual(flags);
    }
  });
});

// ---------------------------------------------------------------------------
// listDashboards
// ---------------------------------------------------------------------------

describe("listDashboards", () => {
  const projectId = 10;

  it("sends GET to /api/environments/{projectId}/dashboards/", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, {
      count: 0,
      results: [],
      next: null,
    });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listDashboards(projectId);

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("GET");
    const url = new URL(captured[0].url);
    expect(url.pathname).toBe(`/api/environments/${projectId}/dashboards/`);
  });

  it("returns parsed PaginatedResponse on success", async () => {
    const dashboards = [
      {
        id: 1,
        name: "Main Dashboard",
        description: "Overview",
        created_at: "2025-01-01T00:00:00Z",
        last_accessed_at: null,
      },
    ];
    const responseBody = { count: 1, results: dashboards, next: null };
    const fetcher = createMockFetcher(200, responseBody);
    const client = createPostHogClient(US_TOKEN, fetcher);

    const result = await client.listDashboards(projectId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.count).toBe(1);
      expect(result.data.results).toEqual(dashboards);
      expect(result.data.next).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Timeout handling
// ---------------------------------------------------------------------------

describe("timeout handling", () => {
  it("passes an AbortSignal to the fetcher", async () => {
    const { fetcher, captured } = createCapturingFetcher(200, { results: [] });
    const client = createPostHogClient(US_TOKEN, fetcher);

    await client.listProjects();

    expect(captured).toHaveLength(1);
    expect(captured[0].signal).toBeDefined();
    expect(captured[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("returns ok: false with 502 when fetch is aborted", async () => {
    const fetcher: typeof fetch = async () => {
      const abortError = new DOMException("The operation was aborted.", "AbortError");
      throw abortError;
    };
    const client = createPostHogClient(US_TOKEN, fetcher);

    const result = await client.listProjects();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.message).toBe("The operation was aborted.");
    }
  });
});
