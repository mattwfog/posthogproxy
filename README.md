# PostHog MCP Server

An MCP server that connects Claude.ai to PostHog and WordPress — with cross-service A/B testing built in.

I use PostHog and Claude daily. I wanted to ask Claude questions about my analytics data and have it pull answers directly. Then I wanted it to act on what it found — update content, run experiments, apply winners — without leaving the conversation.

Three problems stood in the way:

**1. Auth mismatch.** Claude.ai requires OAuth for remote MCP servers. PostHog's MCP server only accepts a personal API key as a Bearer token. They're incompatible.

**2. Project/org scoping.** PostHog's native MCP integration locks you into a single project per connection. I work across multiple projects — I just want to ask questions and have it figure out where to look.

**3. No cross-service actions.** Analytics and content live in different systems. To A/B test a headline, you'd manually create a PostHog experiment, update WordPress, check results, and apply the winner. Four tools, zero automation.

This MCP server fixes all three. It handles OAuth, accesses all your PostHog projects with a personal API key, optionally connects to WordPress, and exposes 19 tools including cross-service A/B testing that lets you run experiments on WordPress content tracked by PostHog — all from a conversation with Claude.

## How It Works

```
                                  ┌──REST API──> PostHog
Claude.ai ──OAuth──> MCP Server ──┤
                                  └──REST API──> WordPress (optional)
```

1. Claude.ai connects via a standard OAuth flow
2. You paste your PostHog personal API key and pick your region (US/EU)
3. Optionally add your WordPress site URL and application password
4. Claude sends MCP tool calls to the server, which translates them into REST API queries
5. Results come back formatted for natural conversation — not raw JSON

## Tools

### PostHog (10 tools)

| Tool | Description |
| --- | --- |
| `list_projects` | List all projects and organizations you have access to |
| `get_trends` | Event trends over time — "how many signups this week?" |
| `get_funnel` | Conversion funnel analysis with step-by-step drop-off |
| `find_person` | Look up a user by email, name, or distinct ID |
| `get_person_events` | Recent activity timeline for a specific user |
| `search_events` | Search events with property filters |
| `list_feature_flags` | Feature flag status, rollout, and type |
| `list_dashboards` | Dashboard overview with last accessed dates |
| `list_errors` | Error tracking groups sorted by occurrence |
| `run_query` | Raw HogQL queries for anything the other tools can't answer |

### WordPress (6 tools)

| Tool | Description |
| --- | --- |
| `wp_list_posts` | List posts with search and status filters |
| `wp_get_post` | Get a post's full content |
| `wp_update_post` | Update a post's title, content, or status |
| `wp_list_pages` | List pages with search and status filters |
| `wp_get_page` | Get a page's full content |
| `wp_update_page` | Update a page's title, content, or status |

### Cross-Service A/B Testing (3 tools)

| Tool | Description |
| --- | --- |
| `create_ab_test` | Create a PostHog experiment with feature flag and variant content for a WordPress post |
| `check_ab_test` | Check experiment results — which variant is winning |
| `apply_winner` | Apply the winning content to WordPress and disable the feature flag |

## Example Conversations

**"How many users signed up this week?"**
Claude uses `list_projects` to find the project, then `get_trends` with event `user_signed_up`.

**"What's our conversion from signup to first purchase?"**
Claude uses `get_funnel` with steps `['user_signed_up', 'purchase']`.

**"Test two headlines on the homepage"**
Claude uses `wp_get_post` to see the current content, then `create_ab_test` to create a PostHog experiment with both headline variants. Later, `check_ab_test` shows which is winning, and `apply_winner` makes it permanent.

**"What's breaking in production?"**
Claude uses `list_errors` to show top error groups by occurrence count.

**"What has user@example.com been doing?"**
Claude uses `find_person` then `get_person_events` to show their activity timeline.

## Self-Host This

During the OAuth flow, you paste your PostHog API key (and optionally WordPress credentials) into the Worker. These are stored in Cloudflare KV (encrypted at rest).

If you use someone else's instance, you're handing them your credentials with no way to verify the deployed code matches this repo. Don't do that.

**Deploy your own.** It takes about 2 minutes and runs on Cloudflare's free tier.

### Steps

1. Clone and install:

```bash
git clone https://github.com/mattwfog/posthogproxy.git
cd posthogproxy
npm install
```

2. Create three KV namespaces:

```bash
npx wrangler kv namespace create CLIENTS
npx wrangler kv namespace create AUTH_CODES
npx wrangler kv namespace create TOKENS
```

3. Paste the namespace IDs into `wrangler.toml`.

4. Deploy:

```bash
npm run deploy
```

5. In Claude.ai, add your Worker URL as a remote MCP server. The OAuth flow will ask for your PostHog API key and optionally your WordPress credentials.

## Security

- **PKCE S256** enforced — prevents auth code interception
- **Auth codes** are single-use, 5-minute TTL
- **Access tokens** expire after 30 days, no refresh tokens
- **Credentials validated** against both PostHog and WordPress before issuing tokens
- **WordPress is optional** — the server works with PostHog alone
- **No secrets in code** — credentials only live in KV at runtime

## Architecture

```
src/
├── oauth/
│   ├── metadata.ts          # .well-known discovery endpoints
│   ├── register.ts          # Dynamic Client Registration
│   ├── authorize.ts         # Auth form (PostHog + optional WordPress)
│   ├── token.ts             # Code-to-token exchange with PKCE
│   └── revoke.ts            # Token revocation
├── mcp/
│   ├── handler.ts           # MCP Streamable HTTP handler
│   └── protocol.ts          # JSON-RPC parsing and response builders
├── posthog/
│   ├── client.ts            # PostHog REST API client
│   └── types.ts             # PostHog response types
├── wordpress/
│   ├── client.ts            # WordPress REST API client
│   └── types.ts             # WordPress response types
├── tools/
│   ├── registry.ts          # Tool registration and dispatch
│   ├── format.ts            # Markdown formatting helpers
│   ├── [10 PostHog tools]
│   ├── [6 WordPress tools]
│   └── [3 cross-service tools]
├── crypto.ts                # PKCE S256, ID/secret generation
├── types.ts                 # Shared types
└── index.ts                 # Request router
```

## Development

```bash
npm run dev          # wrangler dev server
npm test             # vitest (156 tests)
npm run typecheck    # tsc --noEmit
```

## What PostHog Could Do Instead

This server wouldn't need to exist if PostHog's MCP server supported OAuth natively, or if Claude.ai supported Bearer token auth for remote MCP servers. The more interesting fix is on PostHog's side — the MCP server could offer an OAuth flow that issues a scoped token during authorization, removing the need for users to manage personal API keys entirely. The project/org scoping could be handled at the OAuth consent screen rather than baked into the connection itself.

The cross-service A/B testing shows what's possible when you treat MCP as an orchestration layer across multiple products — something PostHog could build natively for its most common integration partners.
