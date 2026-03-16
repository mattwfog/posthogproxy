import { describe, it, expect, beforeEach } from "vitest";
import { handleAuthorizeGet, handleAuthorizePost } from "../../src/oauth/authorize";
import type { Env, ClientRegistration } from "../../src/types";
import { createMockEnv } from "../helpers";

const VALID_CLIENT: ClientRegistration = {
  client_id: "test-client-id",
  client_secret: "",
  client_name: "TestClient",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  grant_types: ["authorization_code"],
  token_endpoint_auth_method: "none",
  created_at: Date.now(),
};

describe("handleAuthorizeGet", () => {
  let env: Env;

  beforeEach(async () => {
    env = createMockEnv();
    await env.CLIENTS.put("test-client-id", JSON.stringify(VALID_CLIENT));
  });

  it("returns HTML form for valid request", async () => {
    const url = new URL("https://proxy.example.com/authorize");
    url.searchParams.set("client_id", "test-client-id");
    url.searchParams.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", "abc123");
    url.searchParams.set("code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    url.searchParams.set("code_challenge_method", "S256");

    const request = new Request(url.toString());
    const response = await handleAuthorizeGet(request, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("PostHog");
    expect(html).toContain("api_key");
  });

  it("returns 400 for unknown client_id", async () => {
    const url = new URL("https://proxy.example.com/authorize");
    url.searchParams.set("client_id", "unknown");
    url.searchParams.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", "abc123");
    url.searchParams.set("code_challenge", "challenge");
    url.searchParams.set("code_challenge_method", "S256");

    const request = new Request(url.toString());
    const response = await handleAuthorizeGet(request, env);
    expect(response.status).toBe(400);
  });

  it("returns 400 for mismatched redirect_uri", async () => {
    const url = new URL("https://proxy.example.com/authorize");
    url.searchParams.set("client_id", "test-client-id");
    url.searchParams.set("redirect_uri", "https://evil.com/callback");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", "abc123");
    url.searchParams.set("code_challenge", "challenge");
    url.searchParams.set("code_challenge_method", "S256");

    const request = new Request(url.toString());
    const response = await handleAuthorizeGet(request, env);
    expect(response.status).toBe(400);
  });
});

describe("handleAuthorizePost", () => {
  let env: Env;

  beforeEach(async () => {
    env = createMockEnv();
    await env.CLIENTS.put("test-client-id", JSON.stringify(VALID_CLIENT));
  });

  it("redirects with auth code on valid PostHog key", async () => {
    const formData = new URLSearchParams();
    formData.set("api_key", "phx_fake_valid_key");
    formData.set("region", "us");
    formData.set("client_id", "test-client-id");
    formData.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
    formData.set("state", "abc123");
    formData.set("code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    formData.set("code_challenge_method", "S256");

    const request = new Request("https://proxy.example.com/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    // Mock validator that always returns true
    const response = await handleAuthorizePost(request, env, async () => true);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(location.searchParams.get("state")).toBe("abc123");
    expect(location.searchParams.get("code")).toBeDefined();
    expect(location.searchParams.get("code")!.length).toBeGreaterThan(0);
  });

  it("returns error page when PostHog key is invalid", async () => {
    const formData = new URLSearchParams();
    formData.set("api_key", "phx_invalid_key");
    formData.set("region", "us");
    formData.set("client_id", "test-client-id");
    formData.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
    formData.set("state", "abc123");
    formData.set("code_challenge", "challenge");
    formData.set("code_challenge_method", "S256");

    const request = new Request("https://proxy.example.com/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    // Mock validator that always returns false
    const response = await handleAuthorizePost(request, env, async () => false);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("invalid");
  });
});
