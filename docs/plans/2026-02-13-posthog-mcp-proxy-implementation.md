# PostHog MCP Proxy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an OAuth-enabled Cloudflare Worker that proxies MCP requests from Claude.ai to PostHog's MCP server, bridging the authentication gap.

**Architecture:** Cloudflare Worker acts as both an OAuth 2.0 authorization server and an MCP Streamable HTTP proxy. Users authenticate via OAuth (entering their PostHog API key), and the proxy injects that key when forwarding to PostHog.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare KV, Wrangler, Vitest with @cloudflare/vitest-pool-workers

---

### Task 1: Initialize Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `vitest.config.ts`
- Create: `test/env.d.ts`
- Create: `.gitignore`

**Step 1: Initialize the project with wrangler**

Run: `npm create cloudflare@latest . -- --type worker --lang ts --no-deploy --no-git`
Expected: Project scaffolded with basic Worker files

**Step 2: Install test dependencies**

Run: `npm install -D vitest@~3.2.0 @cloudflare/vitest-pool-workers`
Expected: Dependencies installed

**Step 3: Configure wrangler.toml**

Replace `wrangler.toml` (or `wrangler.jsonc`) with:

```toml
name = "posthog-mcp-proxy"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

# KV namespaces - create with:
#   npx wrangler kv namespace create CLIENTS
#   npx wrangler kv namespace create AUTH_CODES
#   npx wrangler kv namespace create TOKENS
# Then paste the IDs below.

[[kv_namespaces]]
binding = "CLIENTS"
id = "PLACEHOLDER_CLIENTS"

[[kv_namespaces]]
binding = "AUTH_CODES"
id = "PLACEHOLDER_AUTH_CODES"

[[kv_namespaces]]
binding = "TOKENS"
id = "PLACEHOLDER_TOKENS"
```

**Step 4: Configure vitest**

Create `vitest.config.ts`:

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

**Step 5: Create test type declarations**

Create `test/env.d.ts`:

```typescript
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
```

**Step 6: Create .gitignore**

```
node_modules/
dist/
.wrangler/
.dev.vars
```

**Step 7: Verify setup compiles**

Run: `npx tsc --noEmit`
Expected: No errors (or only expected ones from scaffolded code)

**Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.toml vitest.config.ts test/env.d.ts .gitignore src/
git commit -m "chore: initialize cloudflare worker project with vitest"
```

---

### Task 2: Define Types

**Files:**
- Create: `src/types.ts`

**Step 1: Write the types file**

```typescript
export interface Env {
  readonly CLIENTS: KVNamespace;
  readonly AUTH_CODES: KVNamespace;
  readonly TOKENS: KVNamespace;
}

export interface ClientRegistration {
  readonly client_id: string;
  readonly client_secret: string;
  readonly client_name: string;
  readonly redirect_uris: readonly string[];
  readonly grant_types: readonly string[];
  readonly token_endpoint_auth_method: string;
  readonly created_at: number;
}

export interface AuthCodeData {
  readonly posthog_api_key: string;
  readonly posthog_region: "us" | "eu";
  readonly client_id: string;
  readonly redirect_uri: string;
  readonly code_challenge: string;
  readonly code_challenge_method: string;
}

export interface TokenData {
  readonly posthog_api_key: string;
  readonly posthog_region: "us" | "eu";
  readonly client_id: string;
  readonly created_at: number;
  readonly expires_at: number;
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add type definitions for OAuth and proxy data"
```

---

### Task 3: Crypto Utilities (PKCE + Token Generation)

**Files:**
- Create: `src/crypto.ts`
- Create: `test/crypto.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { verifyPkceS256, generateId, generateSecret } from "../src/crypto";

describe("verifyPkceS256", () => {
  it("returns true for valid code_verifier matching code_challenge", async () => {
    // Known test vector: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // SHA-256 → base64url = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(await verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("returns false for mismatched verifier", async () => {
    const verifier = "wrong-verifier-value";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(await verifyPkceS256(verifier, challenge)).toBe(false);
  });
});

describe("generateId", () => {
  it("returns a hex string of expected length", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns unique values", () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });
});

describe("generateSecret", () => {
  it("returns a hex string of expected length", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/crypto.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
export async function verifyPkceS256(
  codeVerifier: string,
  codeChallenge: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
  const base64url = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return base64url === codeChallenge;
}

export function generateId(): string {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateSecret(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/crypto.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/crypto.ts test/crypto.test.ts
git commit -m "feat: add PKCE S256 verification and token generation"
```

---

### Task 4: OAuth Discovery Endpoints

**Files:**
- Create: `src/oauth/metadata.ts`
- Create: `test/oauth/metadata.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  handleProtectedResourceMetadata,
  handleAuthorizationServerMetadata,
} from "../../src/oauth/metadata";

const BASE_URL = "https://proxy.example.com";

describe("handleProtectedResourceMetadata", () => {
  it("returns resource metadata with correct structure", async () => {
    const response = handleProtectedResourceMetadata(BASE_URL);
    const body = await response.json();

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
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.issuer).toBe("https://proxy.example.com");
    expect(body.authorization_endpoint).toBe("https://proxy.example.com/authorize");
    expect(body.token_endpoint).toBe("https://proxy.example.com/token");
    expect(body.registration_endpoint).toBe("https://proxy.example.com/register");
    expect(body.response_types_supported).toEqual(["code"]);
    expect(body.grant_types_supported).toEqual(["authorization_code"]);
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.token_endpoint_auth_methods_supported).toEqual(["client_secret_post", "none"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/oauth/metadata.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
export function handleProtectedResourceMetadata(baseUrl: string): Response {
  return Response.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
  });
}

export function handleAuthorizationServerMetadata(baseUrl: string): Response {
  return Response.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/oauth/metadata.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/oauth/metadata.ts test/oauth/metadata.test.ts
git commit -m "feat: add OAuth discovery metadata endpoints"
```

---

### Task 5: Dynamic Client Registration

**Files:**
- Create: `src/oauth/register.ts`
- Create: `test/oauth/register.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { handleRegister } from "../../src/oauth/register";
import type { Env } from "../../src/types";

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

describe("handleRegister", () => {
  let env: Env;

  beforeEach(() => {
    env = {
      CLIENTS: createMockKV(),
      AUTH_CODES: createMockKV(),
      TOKENS: createMockKV(),
    };
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
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.client_id).toBeDefined();
    expect(body.client_name).toBe("Claude");
    expect(body.redirect_uris).toEqual(["https://claude.ai/api/mcp/auth_callback"]);
    expect(body.grant_types).toEqual(["authorization_code"]);
    expect(body.token_endpoint_auth_method).toBe("none");
  });

  it("returns client_secret when auth method is client_secret_post", async () => {
    const request = new Request("https://proxy.example.com/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "TestClient",
        redirect_uris: ["https://example.com/callback"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });

    const response = await handleRegister(request, env);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.client_secret).toBeDefined();
    expect(body.client_secret.length).toBeGreaterThan(0);
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
    const body = await response.json();

    const stored = await env.CLIENTS.get(body.client_id);
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/oauth/register.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
import type { Env, ClientRegistration } from "../types";
import { generateId, generateSecret } from "../crypto";

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return Response.json({ error: "invalid_client_metadata", error_description: "redirect_uris is required" }, { status: 400 });
  }

  const clientName = typeof body.client_name === "string" ? body.client_name : "Unknown";
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types as string[] : ["authorization_code"];
  const authMethod = typeof body.token_endpoint_auth_method === "string"
    ? body.token_endpoint_auth_method
    : "none";

  const clientId = generateId();
  const clientSecret = authMethod === "client_secret_post" ? generateSecret() : "";

  const registration: ClientRegistration = {
    client_id: clientId,
    client_secret: clientSecret,
    client_name: clientName,
    redirect_uris: redirectUris as string[],
    grant_types: grantTypes,
    token_endpoint_auth_method: authMethod,
    created_at: Date.now(),
  };

  await env.CLIENTS.put(clientId, JSON.stringify(registration));

  const responseBody: Record<string, unknown> = {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    token_endpoint_auth_method: authMethod,
  };

  if (authMethod === "client_secret_post") {
    responseBody.client_secret = clientSecret;
  }

  return Response.json(responseBody, { status: 201 });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/oauth/register.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/oauth/register.ts test/oauth/register.test.ts
git commit -m "feat: add dynamic client registration endpoint"
```

---

### Task 6: Authorization Endpoint

**Files:**
- Create: `src/oauth/authorize.ts`
- Create: `test/oauth/authorize.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { handleAuthorizeGet, handleAuthorizePost } from "../../src/oauth/authorize";
import type { Env, ClientRegistration } from "../../src/types";

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, value);
    },
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

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
    env = {
      CLIENTS: createMockKV(),
      AUTH_CODES: createMockKV(),
      TOKENS: createMockKV(),
    };
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
    env = {
      CLIENTS: createMockKV(),
      AUTH_CODES: createMockKV(),
      TOKENS: createMockKV(),
    };
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

    // Note: this test will need PostHog API validation mocked.
    // For unit testing, we'll test the redirect logic with a mock validator.
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

    const response = await handleAuthorizePost(request, env, async () => false);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("invalid");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/oauth/authorize.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
import type { Env, ClientRegistration, AuthCodeData } from "../types";
import { generateId } from "../crypto";

const POSTHOG_ENDPOINTS: Record<string, string> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

type ApiKeyValidator = (apiKey: string, region: string) => Promise<boolean>;

export async function validatePosthogKey(apiKey: string, region: string): Promise<boolean> {
  const endpoint = POSTHOG_ENDPOINTS[region] ?? POSTHOG_ENDPOINTS.us;
  try {
    const response = await fetch(`${endpoint}/api/projects/`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function lookupClient(clientId: string, env: Env): Promise<ClientRegistration | null> {
  const raw = await env.CLIENTS.get(clientId);
  if (!raw) return null;
  return JSON.parse(raw) as ClientRegistration;
}

function validateAuthorizeParams(
  params: URLSearchParams,
  client: ClientRegistration,
): string | null {
  const redirectUri = params.get("redirect_uri");
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return "Invalid redirect_uri";
  }
  if (params.get("response_type") !== "code") {
    return "Unsupported response_type";
  }
  if (!params.get("code_challenge") || params.get("code_challenge_method") !== "S256") {
    return "PKCE S256 is required";
  }
  return null;
}

function renderAuthForm(params: URLSearchParams, error?: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect PostHog</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; background: #f8f9fa; }
    .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 1.5rem; margin: 0 0 8px; }
    p { color: #666; margin: 0 0 24px; font-size: 0.9rem; }
    label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.9rem; }
    input, select { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 0.9rem; box-sizing: border-box; margin-bottom: 16px; }
    button { width: 100%; padding: 12px; background: #1d4aff; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:hover { background: #1538cc; }
    .error { background: #fee; color: #c00; padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect to PostHog</h1>
    <p>Enter your PostHog Personal API Key to authorize this connection.</p>
    ${error ? `<div class="error">${error}</div>` : ""}
    <form method="POST" action="/authorize">
      <label for="api_key">Personal API Key</label>
      <input type="password" id="api_key" name="api_key" placeholder="phx_..." required />
      <label for="region">Region</label>
      <select id="region" name="region">
        <option value="us">US (us.posthog.com)</option>
        <option value="eu">EU (eu.posthog.com)</option>
      </select>
      <input type="hidden" name="client_id" value="${params.get("client_id") ?? ""}" />
      <input type="hidden" name="redirect_uri" value="${params.get("redirect_uri") ?? ""}" />
      <input type="hidden" name="state" value="${params.get("state") ?? ""}" />
      <input type="hidden" name="code_challenge" value="${params.get("code_challenge") ?? ""}" />
      <input type="hidden" name="code_challenge_method" value="${params.get("code_challenge_method") ?? ""}" />
      <button type="submit">Connect</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function handleAuthorizeGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;
  const clientId = params.get("client_id");

  if (!clientId) {
    return Response.json({ error: "client_id is required" }, { status: 400 });
  }

  const client = await lookupClient(clientId, env);
  if (!client) {
    return Response.json({ error: "Unknown client_id" }, { status: 400 });
  }

  const validationError = validateAuthorizeParams(params, client);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  return renderAuthForm(params);
}

export async function handleAuthorizePost(
  request: Request,
  env: Env,
  validator: ApiKeyValidator = validatePosthogKey,
): Promise<Response> {
  const formData = await request.formData();
  const apiKey = formData.get("api_key") as string;
  const region = (formData.get("region") as string) ?? "us";
  const clientId = formData.get("client_id") as string;
  const redirectUri = formData.get("redirect_uri") as string;
  const state = formData.get("state") as string;
  const codeChallenge = formData.get("code_challenge") as string;
  const codeChallengeMethod = formData.get("code_challenge_method") as string;

  if (!apiKey || !clientId || !redirectUri) {
    return renderAuthForm(new URLSearchParams(), "Missing required fields");
  }

  const client = await lookupClient(clientId, env);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return Response.json({ error: "Invalid client or redirect_uri" }, { status: 400 });
  }

  const isValid = await validator(apiKey, region);
  if (!isValid) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state: state ?? "",
      code_challenge: codeChallenge ?? "",
      code_challenge_method: codeChallengeMethod ?? "",
      response_type: "code",
    });
    return renderAuthForm(params, "Invalid PostHog API key. Please check and try again.");
  }

  const code = generateId();
  const authCodeData: AuthCodeData = {
    posthog_api_key: apiKey,
    posthog_region: region === "eu" ? "eu" : "us",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  };

  await env.AUTH_CODES.put(code, JSON.stringify(authCodeData), { expirationTtl: 300 });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) {
    redirect.searchParams.set("state", state);
  }

  return Response.redirect(redirect.toString(), 302);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/oauth/authorize.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/oauth/authorize.ts test/oauth/authorize.test.ts
git commit -m "feat: add authorization endpoint with PostHog key validation form"
```

---

### Task 7: Token Exchange Endpoint

**Files:**
- Create: `src/oauth/token.ts`
- Create: `test/oauth/token.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { handleToken } from "../../src/oauth/token";
import type { Env, ClientRegistration, AuthCodeData } from "../../src/types";
import { verifyPkceS256 } from "../../src/crypto";

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, value);
    },
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

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
    env = {
      CLIENTS: createMockKV(),
      AUTH_CODES: createMockKV(),
      TOKENS: createMockKV(),
    };
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
    const result = await response.json();

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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/oauth/token.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
import type { Env, AuthCodeData, TokenData } from "../types";
import { verifyPkceS256, generateSecret } from "../crypto";

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function handleToken(request: Request, env: Env): Promise<Response> {
  const body = await request.formData();
  const grantType = body.get("grant_type") as string;

  if (grantType !== "authorization_code") {
    return Response.json(
      { error: "unsupported_grant_type", error_description: "Only authorization_code is supported" },
      { status: 400 },
    );
  }

  const code = body.get("code") as string;
  const redirectUri = body.get("redirect_uri") as string;
  const clientId = body.get("client_id") as string;
  const codeVerifier = body.get("code_verifier") as string;

  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return Response.json(
      { error: "invalid_request", error_description: "Missing required parameters" },
      { status: 400 },
    );
  }

  const raw = await env.AUTH_CODES.get(code);
  if (!raw) {
    return Response.json(
      { error: "invalid_grant", error_description: "Invalid or expired authorization code" },
      { status: 400 },
    );
  }

  // Delete immediately to prevent reuse
  await env.AUTH_CODES.delete(code);

  const authCodeData: AuthCodeData = JSON.parse(raw);

  if (authCodeData.client_id !== clientId) {
    return Response.json(
      { error: "invalid_grant", error_description: "Client ID mismatch" },
      { status: 400 },
    );
  }

  if (authCodeData.redirect_uri !== redirectUri) {
    return Response.json(
      { error: "invalid_grant", error_description: "Redirect URI mismatch" },
      { status: 400 },
    );
  }

  const pkceValid = await verifyPkceS256(codeVerifier, authCodeData.code_challenge);
  if (!pkceValid) {
    return Response.json(
      { error: "invalid_grant", error_description: "PKCE verification failed" },
      { status: 400 },
    );
  }

  const accessToken = generateSecret();
  const now = Date.now();
  const tokenData: TokenData = {
    posthog_api_key: authCodeData.posthog_api_key,
    posthog_region: authCodeData.posthog_region,
    client_id: clientId,
    created_at: now,
    expires_at: now + TOKEN_TTL_SECONDS * 1000,
  };

  await env.TOKENS.put(accessToken, JSON.stringify(tokenData), {
    expirationTtl: TOKEN_TTL_SECONDS,
  });

  return Response.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/oauth/token.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/oauth/token.ts test/oauth/token.test.ts
git commit -m "feat: add token exchange endpoint with PKCE verification"
```

---

### Task 8: MCP Proxy Endpoint

**Files:**
- Create: `src/proxy/mcp.ts`
- Create: `test/proxy/mcp.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { handleMcp, extractBearerToken } from "../../src/proxy/mcp";
import type { Env, TokenData } from "../../src/types";

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, value);
    },
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

const VALID_TOKEN_DATA: TokenData = {
  posthog_api_key: "phx_test_key_123",
  posthog_region: "us",
  client_id: "test-client",
  created_at: Date.now(),
  expires_at: Date.now() + 86400000,
};

describe("extractBearerToken", () => {
  it("extracts token from Authorization header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("returns null for missing header", () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it("returns null for non-Bearer scheme", () => {
    expect(extractBearerToken("Basic abc123")).toBeNull();
  });
});

describe("handleMcp", () => {
  let env: Env;

  beforeEach(async () => {
    env = {
      CLIENTS: createMockKV(),
      AUTH_CODES: createMockKV(),
      TOKENS: createMockKV(),
    };
    await env.TOKENS.put("valid-token", JSON.stringify(VALID_TOKEN_DATA));
  });

  it("returns 401 without Authorization header", async () => {
    const request = new Request("https://proxy.example.com/mcp", {
      method: "POST",
      body: "{}",
    });

    const response = await handleMcp(request, env);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("returns 401 for invalid token", async () => {
    const request = new Request("https://proxy.example.com/mcp", {
      method: "POST",
      headers: { authorization: "Bearer bad-token" },
      body: "{}",
    });

    const response = await handleMcp(request, env);
    expect(response.status).toBe(401);
  });

  it("proxies request to PostHog with correct auth for valid token", async () => {
    // We can't actually call PostHog in unit tests,
    // so we test with a mock fetcher.
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const req = new Request(input, init);
      expect(req.url).toBe("https://mcp.posthog.com/mcp");
      expect(req.headers.get("authorization")).toBe("Bearer phx_test_key_123");
      return new Response('{"result":"ok"}', {
        headers: { "content-type": "application/json" },
      });
    };

    const request = new Request("https://proxy.example.com/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: '{"jsonrpc":"2.0","method":"initialize","id":1}',
    });

    const response = await handleMcp(request, env, mockFetch);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBe("ok");
  });

  it("uses EU endpoint for EU region tokens", async () => {
    const euTokenData: TokenData = {
      ...VALID_TOKEN_DATA,
      posthog_region: "eu",
    };
    await env.TOKENS.put("eu-token", JSON.stringify(euTokenData));

    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const req = new Request(input);
      expect(req.url).toBe("https://mcp-eu.posthog.com/mcp");
      return new Response("ok");
    };

    const request = new Request("https://proxy.example.com/mcp", {
      method: "POST",
      headers: { authorization: "Bearer eu-token" },
      body: "{}",
    });

    const response = await handleMcp(request, env, mockFetch);
    expect(response.status).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/proxy/mcp.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
import type { Env, TokenData } from "../types";

const POSTHOG_MCP_ENDPOINTS: Record<string, string> = {
  us: "https://mcp.posthog.com/mcp",
  eu: "https://mcp-eu.posthog.com/mcp",
};

type Fetcher = typeof fetch;

export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

function unauthorizedResponse(baseUrl: string): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "www-authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
    },
  });
}

export async function handleMcp(
  request: Request,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const baseUrl = new URL(request.url).origin;
  const token = extractBearerToken(request.headers.get("authorization"));

  if (!token) {
    return unauthorizedResponse(baseUrl);
  }

  const raw = await env.TOKENS.get(token);
  if (!raw) {
    return unauthorizedResponse(baseUrl);
  }

  const tokenData: TokenData = JSON.parse(raw);

  if (tokenData.expires_at < Date.now()) {
    await env.TOKENS.delete(token);
    return unauthorizedResponse(baseUrl);
  }

  const posthogUrl = POSTHOG_MCP_ENDPOINTS[tokenData.posthog_region] ?? POSTHOG_MCP_ENDPOINTS.us;

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${tokenData.posthog_api_key}`);
  headers.delete("host");

  const posthogRequest = new Request(posthogUrl, {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
    // @ts-expect-error -- duplex needed for streaming body
    duplex: "half",
  });

  const posthogResponse = await fetcher(posthogRequest);

  // If PostHog returns 401, the API key is invalid/expired
  if (posthogResponse.status === 401) {
    await env.TOKENS.delete(token);
    return unauthorizedResponse(baseUrl);
  }

  // Stream the response back as-is
  return new Response(posthogResponse.body, {
    status: posthogResponse.status,
    headers: posthogResponse.headers,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/proxy/mcp.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/proxy/mcp.ts test/proxy/mcp.test.ts
git commit -m "feat: add MCP proxy endpoint with auth bridging"
```

---

### Task 9: Request Router (Worker Entry Point)

**Files:**
- Modify: `src/index.ts`
- Create: `test/index.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, value);
    },
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

describe("router", () => {
  let env: Env;
  let ctx: ExecutionContext;

  beforeEach(() => {
    env = {
      CLIENTS: createMockKV(),
      AUTH_CODES: createMockKV(),
      TOKENS: createMockKV(),
    };
    ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
  });

  it("serves protected resource metadata", async () => {
    const request = new Request("https://proxy.example.com/.well-known/oauth-protected-resource");
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resource).toBeDefined();
    expect(body.authorization_servers).toBeDefined();
  });

  it("serves authorization server metadata", async () => {
    const request = new Request("https://proxy.example.com/.well-known/oauth-authorization-server");
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const body = await response.json();
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
    // Register a client first
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

  it("returns 404 for unknown routes", async () => {
    const request = new Request("https://proxy.example.com/unknown");
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL — worker doesn't route correctly yet

**Step 3: Write the router implementation**

Replace `src/index.ts`:

```typescript
import type { Env } from "./types";
import { handleProtectedResourceMetadata, handleAuthorizationServerMetadata } from "./oauth/metadata";
import { handleRegister } from "./oauth/register";
import { handleAuthorizeGet, handleAuthorizePost } from "./oauth/authorize";
import { handleToken } from "./oauth/token";
import { handleMcp } from "./proxy/mcp";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const baseUrl = url.origin;
    const path = url.pathname;
    const method = request.method;

    // OAuth discovery
    if (path === "/.well-known/oauth-protected-resource" && method === "GET") {
      return handleProtectedResourceMetadata(baseUrl);
    }
    if (path === "/.well-known/oauth-authorization-server" && method === "GET") {
      return handleAuthorizationServerMetadata(baseUrl);
    }

    // Dynamic Client Registration
    if (path === "/register" && method === "POST") {
      return handleRegister(request, env);
    }

    // Authorization
    if (path === "/authorize" && method === "GET") {
      return handleAuthorizeGet(request, env);
    }
    if (path === "/authorize" && method === "POST") {
      return handleAuthorizePost(request, env);
    }

    // Token exchange
    if (path === "/token" && method === "POST") {
      return handleToken(request, env);
    }

    // MCP proxy (all methods — POST for requests, GET for SSE, DELETE for session close)
    if (path === "/mcp") {
      return handleMcp(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/index.test.ts`
Expected: All 6 tests PASS

**Step 5: Run ALL tests**

Run: `npx vitest run`
Expected: All tests across all files PASS

**Step 6: Commit**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: add request router connecting all endpoints"
```

---

### Task 10: Create KV Namespaces and Deploy

**Step 1: Create KV namespaces**

Run these commands and note the IDs:

```bash
npx wrangler kv namespace create CLIENTS
npx wrangler kv namespace create AUTH_CODES
npx wrangler kv namespace create TOKENS
```

Expected: Each command outputs `{ binding = "...", id = "..." }`

**Step 2: Update wrangler.toml with real KV IDs**

Replace the `PLACEHOLDER_*` values in `wrangler.toml` with the real IDs from step 1.

**Step 3: Deploy**

Run: `npx wrangler deploy`
Expected: Worker deployed, URL printed (e.g., `https://posthog-mcp-proxy.<account>.workers.dev`)

**Step 4: Verify discovery endpoints**

Run:
```bash
curl https://posthog-mcp-proxy.<account>.workers.dev/.well-known/oauth-protected-resource
curl https://posthog-mcp-proxy.<account>.workers.dev/.well-known/oauth-authorization-server
```
Expected: Valid JSON with correct URLs

**Step 5: Commit**

```bash
git add wrangler.toml
git commit -m "chore: add KV namespace IDs and deploy config"
```

---

### Task 11: Manual E2E Test with Claude.ai

**Step 1: Add the connector in Claude.ai**

1. Go to Claude.ai Settings > Connectors
2. Add a new connector
3. Enter your Worker URL: `https://posthog-mcp-proxy.<account>.workers.dev/mcp`
4. Claude.ai should discover OAuth metadata and initiate the flow

**Step 2: Complete the OAuth flow**

1. Claude.ai should redirect you to the authorization page
2. Enter your PostHog Personal API Key
3. Select your region (US/EU)
4. Click Connect
5. Should redirect back to Claude.ai

**Step 3: Test MCP tools**

1. Ask Claude.ai to list your PostHog projects
2. Verify it can access PostHog data through the proxy

**Step 4: Verify error cases**

1. Try with an invalid PostHog API key — should show error on auth form
2. Check that subsequent requests work after successful auth
