import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import { createMockEnv } from "./helpers";

describe("router", () => {
  let env: Env;
  let ctx: ExecutionContext;

  beforeEach(() => {
    env = createMockEnv();
    ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
  });

  it("serves protected resource metadata", async () => {
    const request = new Request("https://proxy.example.com/.well-known/oauth-protected-resource");
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.resource).toBeDefined();
    expect(body.authorization_servers).toBeDefined();
  });

  it("serves authorization server metadata", async () => {
    const request = new Request("https://proxy.example.com/.well-known/oauth-authorization-server");
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.issuer).toBeDefined();
    expect(body.registration_endpoint).toBeDefined();
  });

  it("routes POST /register to DCR", async () => {
    const request = new Request("https://proxy.example.com/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test",
        redirect_uris: ["https://example.com/cb"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "none",
      }),
    });
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(201);
  });

  it("routes GET /authorize to auth form", async () => {
    await env.CLIENTS.put("cid", JSON.stringify({
      client_id: "cid",
      client_secret: "",
      client_name: "Test",
      redirect_uris: ["https://example.com/cb"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "none",
      created_at: Date.now(),
    }));

    const url = "https://proxy.example.com/authorize?client_id=cid&redirect_uri=https://example.com/cb&response_type=code&state=s&code_challenge=c&code_challenge_method=S256";
    const request = new Request(url);
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("routes POST /mcp to proxy (returns 401 without token)", async () => {
    const request = new Request("https://proxy.example.com/mcp", {
      method: "POST",
      body: "{}",
    });
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(401);
  });

  it("routes POST / to proxy (Claude.ai sends MCP to root)", async () => {
    const request = new Request("https://proxy.example.com/", {
      method: "POST",
      body: "{}",
    });
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(401);
  });

  it("returns 404 for unknown routes", async () => {
    const request = new Request("https://proxy.example.com/unknown");
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(404);
  });
});
