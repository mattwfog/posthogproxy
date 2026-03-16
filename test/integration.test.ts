import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import worker from "../src/index";
import type { Env, AuthCodeData, ClientRegistration } from "../src/types";
import { createMockEnv } from "./helpers";

const BASE_URL = "https://proxy.example.com";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

/**
 * Compute S256 code_challenge from a code_verifier, matching the logic
 * in src/crypto.ts verifyPkceS256.
 */
async function computeS256Challenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function createMockCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

describe("integration: full OAuth flow", () => {
  let env: Env;
  let ctx: ExecutionContext;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockCtx();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("completes the full OAuth flow: register -> authorize -> token -> mcp proxy", async () => {
    // ---------------------------------------------------------------
    // Step 1: POST /register -- get a client_id
    // ---------------------------------------------------------------
    const registerRequest = new Request(`${BASE_URL}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Integration Test Client",
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "none",
      }),
    });

    const registerResponse = await worker.fetch(registerRequest, env, ctx);
    expect(registerResponse.status).toBe(201);

    const registerBody = await registerResponse.json() as {
      client_id: string;
      client_name: string;
      redirect_uris: readonly string[];
    };
    expect(registerBody.client_id).toBeDefined();
    expect(registerBody.client_id.length).toBeGreaterThan(0);
    expect(registerBody.client_name).toBe("Integration Test Client");
    expect(registerBody.redirect_uris).toEqual([REDIRECT_URI]);

    const clientId = registerBody.client_id;

    // ---------------------------------------------------------------
    // Step 2: Generate PKCE code_verifier and code_challenge
    // ---------------------------------------------------------------
    const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const codeChallenge = await computeS256Challenge(codeVerifier);

    // ---------------------------------------------------------------
    // Step 3: GET /authorize -- verify it returns the HTML form
    // ---------------------------------------------------------------
    const authorizeGetUrl = new URL(`${BASE_URL}/authorize`);
    authorizeGetUrl.searchParams.set("client_id", clientId);
    authorizeGetUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authorizeGetUrl.searchParams.set("response_type", "code");
    authorizeGetUrl.searchParams.set("state", "integration-test-state");
    authorizeGetUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeGetUrl.searchParams.set("code_challenge_method", "S256");

    const authorizeGetRequest = new Request(authorizeGetUrl.toString());
    const authorizeGetResponse = await worker.fetch(authorizeGetRequest, env, ctx);

    expect(authorizeGetResponse.status).toBe(200);
    expect(authorizeGetResponse.headers.get("content-type")).toContain("text/html");
    const authorizeHtml = await authorizeGetResponse.text();
    expect(authorizeHtml).toContain("PostHog");
    expect(authorizeHtml).toContain("api_key");
    expect(authorizeHtml).toContain(clientId);
    expect(authorizeHtml).toContain("S256");

    // ---------------------------------------------------------------
    // Step 4: POST /authorize -- submit the form with a fake API key
    //
    // The Worker's router calls handleAuthorizePost without injecting
    // a validator, so validatePosthogKey will call global fetch to
    // verify the key against PostHog. We mock global fetch to return
    // a successful response so the validation passes.
    // ---------------------------------------------------------------
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const req = new Request(input);
      // The validator calls POST https://us.posthog.com/api/projects/
      if (req.url.includes("posthog.com/api/projects")) {
        return new Response(JSON.stringify([{ id: 1 }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input);
    };

    const authorizeFormData = new URLSearchParams();
    authorizeFormData.set("api_key", "phx_integration_test_key");
    authorizeFormData.set("region", "us");
    authorizeFormData.set("client_id", clientId);
    authorizeFormData.set("redirect_uri", REDIRECT_URI);
    authorizeFormData.set("state", "integration-test-state");
    authorizeFormData.set("code_challenge", codeChallenge);
    authorizeFormData.set("code_challenge_method", "S256");

    const authorizePostRequest = new Request(`${BASE_URL}/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: authorizeFormData.toString(),
    });

    const authorizePostResponse = await worker.fetch(authorizePostRequest, env, ctx);

    expect(authorizePostResponse.status).toBe(302);
    const locationHeader = authorizePostResponse.headers.get("location");
    expect(locationHeader).toBeDefined();

    const redirectUrl = new URL(locationHeader!);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(REDIRECT_URI);
    expect(redirectUrl.searchParams.get("state")).toBe("integration-test-state");

    const authCode = redirectUrl.searchParams.get("code");
    expect(authCode).toBeDefined();
    expect(authCode!.length).toBeGreaterThan(0);

    // ---------------------------------------------------------------
    // Step 5: POST /token -- exchange the auth code for an access token
    // ---------------------------------------------------------------
    const tokenFormData = new URLSearchParams();
    tokenFormData.set("grant_type", "authorization_code");
    tokenFormData.set("code", authCode!);
    tokenFormData.set("redirect_uri", REDIRECT_URI);
    tokenFormData.set("client_id", clientId);
    tokenFormData.set("code_verifier", codeVerifier);

    const tokenRequest = new Request(`${BASE_URL}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenFormData.toString(),
    });

    const tokenResponse = await worker.fetch(tokenRequest, env, ctx);
    expect(tokenResponse.status).toBe(200);

    const tokenBody = await tokenResponse.json() as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(tokenBody.access_token).toBeDefined();
    expect(tokenBody.access_token.length).toBeGreaterThan(0);
    expect(tokenBody.token_type).toBe("Bearer");
    expect(tokenBody.expires_in).toBe(2592000);

    const accessToken = tokenBody.access_token;

    // ---------------------------------------------------------------
    // Step 6: POST /mcp -- initialize the MCP session
    // ---------------------------------------------------------------
    const initPayload = JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      id: 1,
    });

    const initRequest = new Request(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: initPayload,
    });

    const initResponse = await worker.fetch(initRequest, env, ctx);
    expect(initResponse.status).toBe(200);

    const initBody = await initResponse.json() as {
      jsonrpc: string;
      id: number;
      result: { protocolVersion: string; capabilities: object; serverInfo: { name: string } };
    };
    expect(initBody.jsonrpc).toBe("2.0");
    expect(initBody.result.protocolVersion).toBe("2025-03-26");
    expect(initBody.result.serverInfo.name).toBe("posthog-mcp");
    expect(initResponse.headers.get("mcp-session-id")).toBeDefined();

    // ---------------------------------------------------------------
    // Step 7: POST /mcp -- list available tools
    // ---------------------------------------------------------------
    const listPayload = JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/list",
      id: 2,
    });

    const listRequest = new Request(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: listPayload,
    });

    const listResponse = await worker.fetch(listRequest, env, ctx);
    expect(listResponse.status).toBe(200);

    const listBody = await listResponse.json() as {
      jsonrpc: string;
      id: number;
      result: { tools: Array<{ name: string }> };
    };
    expect(listBody.jsonrpc).toBe("2.0");
    expect(listBody.result.tools.length).toBeGreaterThanOrEqual(5);

    const toolNames = listBody.result.tools.map(t => t.name);
    expect(toolNames).toContain("list_projects");
    expect(toolNames).toContain("get_trends");
    expect(toolNames).toContain("find_person");
    expect(toolNames).toContain("search_events");
    expect(toolNames).toContain("run_query");

    // ---------------------------------------------------------------
    // Step 8: POST /mcp -- call a tool (list_projects)
    // Mock fetch to return a PostHog API response
    // ---------------------------------------------------------------
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const req = new Request(input, init);
      if (req.url.includes("posthog.com/api/projects")) {
        // Verify the client sends the stored API key
        expect(req.headers.get("authorization")).toBe("Bearer phx_integration_test_key");
        return new Response(
          JSON.stringify({
            count: 1,
            results: [{ id: 1, name: "My Project", organization: "My Org", created_at: "2025-01-01T00:00:00Z" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input);
    };

    const callPayload = JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 3,
      params: { name: "list_projects", arguments: {} },
    });

    const callRequest = new Request(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: callPayload,
    });

    const callResponse = await worker.fetch(callRequest, env, ctx);
    expect(callResponse.status).toBe(200);

    const callBody = await callResponse.json() as {
      jsonrpc: string;
      id: number;
      result: { content: Array<{ type: string; text: string }> };
    };
    expect(callBody.jsonrpc).toBe("2.0");
    expect(callBody.result.content[0].type).toBe("text");
    expect(callBody.result.content[0].text).toContain("My Project");
  });

  it("rejects token exchange with wrong PKCE verifier", async () => {
    // Seed a client and auth code directly for this focused test
    const codeVerifier = "correct-verifier-for-this-test-which-is-long-enough";
    const codeChallenge = await computeS256Challenge(codeVerifier);
    const clientId = "pkce-test-client";

    const client: ClientRegistration = {
      client_id: clientId,
      client_secret: "",
      client_name: "PKCE Test",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "none",
      created_at: Date.now(),
    };

    const authCodeData: AuthCodeData = {
      posthog_api_key: "phx_pkce_test",
      posthog_region: "us",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    };

    await env.CLIENTS.put(clientId, JSON.stringify(client));
    await env.AUTH_CODES.put("pkce-test-code", JSON.stringify(authCodeData));

    const tokenFormData = new URLSearchParams();
    tokenFormData.set("grant_type", "authorization_code");
    tokenFormData.set("code", "pkce-test-code");
    tokenFormData.set("redirect_uri", REDIRECT_URI);
    tokenFormData.set("client_id", clientId);
    tokenFormData.set("code_verifier", "wrong-verifier-should-fail-pkce-check");

    const tokenRequest = new Request(`${BASE_URL}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenFormData.toString(),
    });

    const tokenResponse = await worker.fetch(tokenRequest, env, ctx);
    expect(tokenResponse.status).toBe(400);

    const body = await tokenResponse.json() as { error: string; error_description: string };
    expect(body.error).toBe("invalid_grant");
    expect(body.error_description).toContain("PKCE");
  });

  it("returns 401 for MCP request without a valid token", async () => {
    const mcpRequest = new Request(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer nonexistent-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });

    const mcpResponse = await worker.fetch(mcpRequest, env, ctx);
    expect(mcpResponse.status).toBe(401);
    expect(mcpResponse.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("auth code is single-use -- second token exchange fails", async () => {
    const codeVerifier = "single-use-code-verifier-test-value-long-enough";
    const codeChallenge = await computeS256Challenge(codeVerifier);
    const clientId = "single-use-client";

    const client: ClientRegistration = {
      client_id: clientId,
      client_secret: "",
      client_name: "Single Use Test",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "none",
      created_at: Date.now(),
    };

    const authCodeData: AuthCodeData = {
      posthog_api_key: "phx_single_use_test",
      posthog_region: "us",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    };

    await env.CLIENTS.put(clientId, JSON.stringify(client));
    await env.AUTH_CODES.put("single-use-code", JSON.stringify(authCodeData));

    const makeTokenRequest = () => {
      const formData = new URLSearchParams();
      formData.set("grant_type", "authorization_code");
      formData.set("code", "single-use-code");
      formData.set("redirect_uri", REDIRECT_URI);
      formData.set("client_id", clientId);
      formData.set("code_verifier", codeVerifier);

      return new Request(`${BASE_URL}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });
    };

    const firstResponse = await worker.fetch(makeTokenRequest(), env, ctx);
    expect(firstResponse.status).toBe(200);

    const secondResponse = await worker.fetch(makeTokenRequest(), env, ctx);
    expect(secondResponse.status).toBe(400);

    const body = await secondResponse.json() as { error: string };
    expect(body.error).toBe("invalid_grant");
  });

  it("proxies to EU endpoint for EU region tokens", async () => {
    const codeVerifier = "eu-region-verifier-test-value-long-enough-here";
    const codeChallenge = await computeS256Challenge(codeVerifier);
    const clientId = "eu-client";

    const client: ClientRegistration = {
      client_id: clientId,
      client_secret: "",
      client_name: "EU Test",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "none",
      created_at: Date.now(),
    };

    const authCodeData: AuthCodeData = {
      posthog_api_key: "phx_eu_key",
      posthog_region: "eu",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    };

    await env.CLIENTS.put(clientId, JSON.stringify(client));
    await env.AUTH_CODES.put("eu-code", JSON.stringify(authCodeData));

    // Exchange code for token
    const tokenFormData = new URLSearchParams();
    tokenFormData.set("grant_type", "authorization_code");
    tokenFormData.set("code", "eu-code");
    tokenFormData.set("redirect_uri", REDIRECT_URI);
    tokenFormData.set("client_id", clientId);
    tokenFormData.set("code_verifier", codeVerifier);

    const tokenRequest = new Request(`${BASE_URL}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenFormData.toString(),
    });

    const tokenResponse = await worker.fetch(tokenRequest, env, ctx);
    expect(tokenResponse.status).toBe(200);

    const tokenBody = await tokenResponse.json() as { access_token: string };
    const accessToken = tokenBody.access_token;

    // Mock fetch to capture the EU API call when a tool is invoked
    let capturedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const req = new Request(input, init);
      capturedUrl = req.url;
      return new Response(
        JSON.stringify({ count: 0, results: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const mcpRequest = new Request(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: { name: "list_projects", arguments: {} },
      }),
    });

    const mcpResponse = await worker.fetch(mcpRequest, env, ctx);
    expect(mcpResponse.status).toBe(200);
    expect(capturedUrl).toContain("eu.posthog.com");
  });
});
