import { describe, it, expect, beforeEach } from "vitest";
import { handleToken } from "../../src/oauth/token";
import type { Env, ClientRegistration, AuthCodeData } from "../../src/types";
import { createMockEnv } from "../helpers";

// Known PKCE test vector
const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const VALID_CLIENT: ClientRegistration = {
  client_id: "test-client-id",
  client_secret: "",
  client_name: "TestClient",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  grant_types: ["authorization_code"],
  token_endpoint_auth_method: "none",
  created_at: Date.now(),
};

const VALID_AUTH_CODE: AuthCodeData = {
  posthog_api_key: "phx_test_key_123",
  posthog_region: "us",
  client_id: "test-client-id",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  code_challenge: CODE_CHALLENGE,
  code_challenge_method: "S256",
};

describe("handleToken", () => {
  let env: Env;

  beforeEach(async () => {
    env = createMockEnv();
    await env.CLIENTS.put("test-client-id", JSON.stringify(VALID_CLIENT));
    await env.AUTH_CODES.put("valid-code", JSON.stringify(VALID_AUTH_CODE));
  });

  it("exchanges valid code for access token", async () => {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", "valid-code");
    body.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
    body.set("client_id", "test-client-id");
    body.set("code_verifier", CODE_VERIFIER);

    const request = new Request("https://proxy.example.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const response = await handleToken(request, env);
    const result = await response.json() as { access_token: string; token_type: string; expires_in: number };

    expect(response.status).toBe(200);
    expect(result.access_token).toBeDefined();
    expect(result.token_type).toBe("Bearer");
    expect(result.expires_in).toBe(2592000); // 30 days
  });

  it("rejects invalid auth code", async () => {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", "nonexistent-code");
    body.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
    body.set("client_id", "test-client-id");
    body.set("code_verifier", CODE_VERIFIER);

    const request = new Request("https://proxy.example.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const response = await handleToken(request, env);
    expect(response.status).toBe(400);
  });

  it("rejects wrong PKCE verifier", async () => {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", "valid-code");
    body.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
    body.set("client_id", "test-client-id");
    body.set("code_verifier", "wrong-verifier-value-here");

    const request = new Request("https://proxy.example.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const response = await handleToken(request, env);
    expect(response.status).toBe(400);
  });

  it("rejects mismatched redirect_uri", async () => {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", "valid-code");
    body.set("redirect_uri", "https://evil.com/callback");
    body.set("client_id", "test-client-id");
    body.set("code_verifier", CODE_VERIFIER);

    const request = new Request("https://proxy.example.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const response = await handleToken(request, env);
    expect(response.status).toBe(400);
  });

  it("rejects request with missing parameters", async () => {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    // Missing code, redirect_uri, client_id, code_verifier

    const request = new Request("https://proxy.example.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const response = await handleToken(request, env);
    expect(response.status).toBe(400);
    const result = await response.json() as { error: string };
    expect(result.error).toBe("invalid_request");
  });

  it("deletes auth code after use (single-use)", async () => {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", "valid-code");
    body.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
    body.set("client_id", "test-client-id");
    body.set("code_verifier", CODE_VERIFIER);

    const request1 = new Request("https://proxy.example.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const response1 = await handleToken(request1, env);
    expect(response1.status).toBe(200);

    // Second attempt should fail
    const request2 = new Request("https://proxy.example.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const response2 = await handleToken(request2, env);
    expect(response2.status).toBe(400);
  });
});
