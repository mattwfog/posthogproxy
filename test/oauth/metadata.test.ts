import { describe, it, expect } from "vitest";
import {
  handleProtectedResourceMetadata,
  handleAuthorizationServerMetadata,
} from "../../src/oauth/metadata";

const BASE_URL = "https://proxy.example.com";

describe("handleProtectedResourceMetadata", () => {
  it("returns resource metadata with correct structure", async () => {
    const response = handleProtectedResourceMetadata(BASE_URL);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toEqual({
      resource: "https://proxy.example.com",
      authorization_servers: ["https://proxy.example.com"],
    });
  });
});

describe("handleAuthorizationServerMetadata", () => {
  it("returns auth server metadata with all required fields", async () => {
    const response = handleAuthorizationServerMetadata(BASE_URL);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.issuer).toBe("https://proxy.example.com");
    expect(body.authorization_endpoint).toBe("https://proxy.example.com/authorize");
    expect(body.token_endpoint).toBe("https://proxy.example.com/token");
    expect(body.registration_endpoint).toBe("https://proxy.example.com/register");
    expect(body.response_types_supported).toEqual(["code"]);
    expect(body.grant_types_supported).toEqual(["authorization_code"]);
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });
});
