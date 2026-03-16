# PostHog MCP Proxy Design

## Problem

Claude.ai supports remote MCP servers via Streamable HTTP but requires OAuth or authless authentication. PostHog's MCP server (`mcp.posthog.com/mcp`) uses Bearer token (personal API key) authentication. This mismatch prevents direct connection.

## Solution

A Cloudflare Worker that acts as an OAuth-enabled MCP proxy. It accepts OAuth-authenticated requests from Claude.ai, looks up the user's PostHog API key, and forwards MCP requests to PostHog with the correct Bearer token.

## Architecture

```
Claude.ai  ──Streamable HTTP + OAuth──▶  CF Worker (proxy)
                                              │
                                              │ Bearer token (user's PH API key)
                                              ▼
                                        mcp.posthog.com/mcp
```

### Components

1. **OAuth 2.0 Authorization Server** — built into the Worker
   - `/.well-known/oauth-authorization-server` — metadata discovery
   - `/register` — Dynamic Client Registration (DCR)
   - `/authorize` — HTML form where user enters their PostHog personal API key
   - `/token` — exchanges auth code for access token

2. **MCP Proxy** — `/mcp` endpoint
   - Validates OAuth access token
   - Looks up PostHog API key from KV
   - Proxies request to PostHog with Bearer auth
   - Streams response back to Claude.ai

3. **Cloudflare KV** — three namespaces:
   - `CLIENTS` — DCR client registrations (client_id → client metadata)
   - `AUTH_CODES` — temporary authorization codes (TTL: 5 min, single-use)
   - `TOKENS` — access tokens (token → {posthog_api_key, client_id, region}, TTL: 30 days)

### Tech Stack

TypeScript, Wrangler, Cloudflare Workers, Cloudflare KV, Vitest.

## OAuth / DCR Flow

1. **Discovery** — Claude.ai fetches `/.well-known/oauth-authorization-server`, gets endpoints and supported grant types.

2. **Dynamic Client Registration** — Claude.ai POSTs to `/register` with client metadata. Proxy generates `client_id` + `client_secret`, stores in KV, returns them.

3. **Authorization** — Claude.ai redirects user to `/authorize?client_id=...&redirect_uri=...&state=...&code_challenge=...`. Proxy serves HTML form:
   - User enters PostHog Personal API Key and selects region (US/EU)
   - Proxy validates key by calling PostHog API
   - If valid: generates auth code, stores `{posthog_api_key, client_id, region}` in KV with 5-min TTL, redirects to Claude.ai callback with code + state

4. **Token Exchange** — Claude.ai POSTs to `/token` with auth code + PKCE verifier. Proxy validates, generates access token, stores mapping in KV with 30-day TTL.

5. **MCP Requests** — Claude.ai sends `Authorization: Bearer <access_token>` to `/mcp`. Proxy looks up token, gets PostHog API key + region, proxies to correct PostHog endpoint.

## Security

- PKCE (S256) required — prevents auth code interception
- Auth codes are single-use, expire in 5 minutes
- Access tokens expire in 30 days
- PostHog API key validated before issuing auth code
- No refresh tokens — user re-authorizes on expiry

## MCP Proxy Logic

1. Extract Bearer token from incoming request
2. Look up in KV `TOKENS` → get `posthog_api_key` + `region`
3. If invalid → 401
4. Replace Authorization header with `Bearer <posthog_api_key>`
5. Forward to `mcp.posthog.com/mcp` (US) or `mcp-eu.posthog.com/mcp` (EU)
6. Stream response back as-is (preserving SSE chunks)
7. If PostHog returns 401 → return 401 to trigger re-auth

## Project Structure

```
posthogproxy/
├── src/
│   ├── index.ts              # Worker entry point, request router
│   ├── oauth/
│   │   ├── metadata.ts       # /.well-known/oauth-authorization-server
│   │   ├── register.ts       # /register (DCR)
│   │   ├── authorize.ts      # /authorize (HTML form + validation)
│   │   └── token.ts          # /token (code → access token exchange)
│   ├── proxy/
│   │   └── mcp.ts            # /mcp (proxy to PostHog)
│   ├── auth/
│   │   └── pkce.ts           # PKCE S256 verification
│   └── types.ts              # Shared types
├── test/
│   ├── oauth/
│   │   ├── register.test.ts
│   │   ├── authorize.test.ts
│   │   └── token.test.ts
│   ├── proxy/
│   │   └── mcp.test.ts
│   └── auth/
│       └── pkce.test.ts
├── wrangler.toml
├── package.json
└── tsconfig.json
```

## Testing

- Unit tests with Vitest + miniflare for KV mocks
- Integration test: full OAuth flow (register → authorize → token → proxy)
- Manual E2E: connect from Claude.ai after deploying
