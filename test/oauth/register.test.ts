import { describe, it, expect, beforeEach } from "vitest";
import { handleRegister } from "../../src/oauth/register";
import type { Env } from "../../src/types";
import { createMockEnv } from "../helpers";

describe("handleRegister", () => {
  let env: Env;

  beforeEach(() => {
    env = createMockEnv();
  });

  it("registers a client and returns credentials", async () => {
    const request = new Request("https://proxy.example.com/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "none",
      }),
    });

    const response = await handleRegister(request, env);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.client_id).toBeDefined();
    expect(body.client_name).toBe("Claude");
    expect(body.redirect_uris).toEqual(["https://claude.ai/api/mcp/auth_callback"]);
    expect(body.grant_types).toEqual(["authorization_code"]);
    expect(body.token_endpoint_auth_method).toBe("none");
  });

  it("stores the client in KV", async () => {
    const request = new Request("https://proxy.example.com/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "none",
      }),
    });

    const response = await handleRegister(request, env);
    const body = await response.json() as Record<string, unknown>;

    const stored = await env.CLIENTS.get(body.client_id as string);
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed.client_name).toBe("Claude");
  });

  it("rejects request without redirect_uris", async () => {
    const request = new Request("https://proxy.example.com/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        grant_types: ["authorization_code"],
      }),
    });

    const response = await handleRegister(request, env);
    expect(response.status).toBe(400);
  });
});
