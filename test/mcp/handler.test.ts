import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleMcpRequest } from "../../src/mcp/handler";
import type { Env, TokenData } from "../../src/types";
import { createMockEnv } from "../helpers";
import { JSON_RPC_ERRORS } from "../../src/mcp/protocol";

const TEST_TOKEN = "test-bearer-token-abc123";
const TEST_POSTHOG_KEY = "phx_test_posthog_api_key";

function validTokenData(overrides?: Partial<TokenData>): TokenData {
  return {
    posthog_api_key: TEST_POSTHOG_KEY,
    posthog_region: "us",
    client_id: "client-123",
    created_at: Date.now(),
    expires_at: Date.now() + 3600_000,
    ...overrides,
  };
}

function postRequest(
  body: unknown,
  token?: string,
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== undefined) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return new Request("https://proxy.example.com/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function jsonRpcBody(method: string, params?: Record<string, unknown>, id: string | number = 1) {
  return {
    jsonrpc: "2.0",
    method,
    id,
    ...(params !== undefined ? { params } : {}),
  };
}

async function seedToken(env: Env, token: string, data: TokenData): Promise<void> {
  await env.TOKENS.put(token, JSON.stringify(data));
}

describe("handleMcpRequest", () => {
  let env: Env;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    env = createMockEnv();
    originalFetch = globalThis.fetch;
    await seedToken(env, TEST_TOKEN, validTokenData());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ---------- Authentication ----------

  describe("authentication", () => {
    it("returns 401 when no Authorization header", async () => {
      const request = new Request("https://proxy.example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(jsonRpcBody("ping")),
      });

      const response = await handleMcpRequest(request, env);

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    });

    it("returns 401 when token is not found in KV", async () => {
      const request = postRequest(jsonRpcBody("ping"), "nonexistent-token");

      const response = await handleMcpRequest(request, env);

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    });

    it("returns 401 when token is expired", async () => {
      const expiredToken = "expired-token-xyz";
      await seedToken(env, expiredToken, validTokenData({
        expires_at: Date.now() - 60_000,
      }));

      const request = postRequest(jsonRpcBody("ping"), expiredToken);

      const response = await handleMcpRequest(request, env);

      expect(response.status).toBe(401);

      // Verify the expired token was deleted from KV
      const stored = await env.TOKENS.get(expiredToken);
      expect(stored).toBeNull();
    });
  });

  // ---------- HTTP Method Routing ----------

  describe("HTTP method routing", () => {
    it("returns 405 for GET requests with Allow header", async () => {
      const request = new Request("https://proxy.example.com/mcp", {
        method: "GET",
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });

      const response = await handleMcpRequest(request, env);

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST, DELETE");
    });

    it("returns 200 for DELETE requests (session termination)", async () => {
      const request = new Request("https://proxy.example.com/mcp", {
        method: "DELETE",
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });

      const response = await handleMcpRequest(request, env);

      expect(response.status).toBe(200);
    });
  });

  // ---------- JSON-RPC Methods ----------

  describe("initialize", () => {
    it("returns protocolVersion, capabilities, serverInfo, and Mcp-Session-Id header", async () => {
      const request = postRequest(jsonRpcBody("initialize"), TEST_TOKEN);

      const response = await handleMcpRequest(request, env);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");

      // Verify Mcp-Session-Id header is present and non-empty
      const sessionId = response.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe("string");
      expect(sessionId!.length).toBeGreaterThan(0);

      // Verify the result payload
      const result = body.result as Record<string, unknown>;
      expect(result.protocolVersion).toBe("2025-03-26");
      expect(result.capabilities).toEqual({ tools: {} });
      expect(result.serverInfo).toEqual({
        name: "posthog-mcp",
        version: "1.0.0",
      });
      expect(result.instructions).toBeDefined();
      expect(typeof result.instructions).toBe("string");
    });
  });

  describe("notifications/initialized", () => {
    it("returns 202 with no body", async () => {
      const request = postRequest(
        jsonRpcBody("notifications/initialized"),
        TEST_TOKEN,
      );

      const response = await handleMcpRequest(request, env);

      expect(response.status).toBe(202);
      // Body should be null/empty for notification
      const text = await response.text();
      expect(text).toBe("");
    });
  });

  describe("ping", () => {
    it("returns empty object as result", async () => {
      const request = postRequest(jsonRpcBody("ping"), TEST_TOKEN);

      const response = await handleMcpRequest(request, env);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe(1);
      expect(body.result).toEqual({});
    });
  });

  describe("tools/list", () => {
    it("returns array of tool definitions with correct structure", async () => {
      const request = postRequest(jsonRpcBody("tools/list"), TEST_TOKEN);

      const response = await handleMcpRequest(request, env);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe(1);

      const result = body.result as { tools: readonly Record<string, unknown>[] };
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBeGreaterThan(0);

      // Every tool should have name, description, and inputSchema
      for (const tool of result.tools) {
        expect(typeof tool.name).toBe("string");
        expect((tool.name as string).length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe("string");
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe("object");
      }

      // Verify known tool names are present
      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain("list_projects");
    });
  });

  describe("tools/call", () => {
    it("calls a valid tool and returns the result", async () => {
      // Mock global fetch to intercept the PostHog API call for list_projects
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                id: 1,
                name: "Test Project",
                organization: "Test Org",
                created_at: "2025-01-01T00:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const request = postRequest(
        jsonRpcBody("tools/call", { name: "list_projects", arguments: {} }),
        TEST_TOKEN,
      );

      const response = await handleMcpRequest(request, env);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe(1);
      expect(body.error).toBeUndefined();

      // The result should contain content array with text entries
      const result = body.result as { content: ReadonlyArray<{ type: string; text: string }> };
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Test Project");

      // Verify the PostHog API was called with correct auth
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const fetchUrl = fetchCall[0] as string;
      expect(fetchUrl).toContain("us.posthog.com");
      expect(fetchUrl).toContain("/api/projects/");
      const fetchOpts = fetchCall[1] as RequestInit;
      expect(fetchOpts.headers).toBeDefined();
      expect((fetchOpts.headers as Record<string, string>)["Authorization"]).toBe(
        `Bearer ${TEST_POSTHOG_KEY}`,
      );
    });

    it("returns error result for unknown tool", async () => {
      const request = postRequest(
        jsonRpcBody("tools/call", { name: "nonexistent_tool", arguments: {} }),
        TEST_TOKEN,
      );

      const response = await handleMcpRequest(request, env);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe(1);

      // dispatchToolCall returns a ToolResult with isError: true for unknown tools,
      // which gets wrapped in a jsonRpcResult (not jsonRpcError)
      const result = body.result as {
        content: ReadonlyArray<{ type: string; text: string }>;
        isError: boolean;
      };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown tool");
      expect(result.content[0].text).toContain("nonexistent_tool");
    });
  });

  // ---------- Error Handling ----------

  describe("error handling", () => {
    it("returns JSON-RPC error -32601 for unknown method", async () => {
      const request = postRequest(
        jsonRpcBody("some/unknown/method"),
        TEST_TOKEN,
      );

      const response = await handleMcpRequest(request, env);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe(1);

      const error = body.error as { code: number; message: string };
      expect(error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND);
      expect(error.message).toContain("some/unknown/method");
    });

    it("returns JSON-RPC error -32700 for invalid JSON body", async () => {
      const request = new Request("https://proxy.example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TEST_TOKEN}`,
        },
        body: "this is not valid json {{{",
      });

      const response = await handleMcpRequest(request, env);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBeNull();

      const error = body.error as { code: number; message: string };
      expect(error.code).toBe(JSON_RPC_ERRORS.PARSE_ERROR);
      expect(error.message).toContain("Parse error");
    });
  });
});
