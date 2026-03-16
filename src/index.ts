import type { Env } from "./types";
import { handleProtectedResourceMetadata, handleAuthorizationServerMetadata } from "./oauth/metadata";
import { handleRegister } from "./oauth/register";
import { handleAuthorizeGet, handleAuthorizePost } from "./oauth/authorize";
import { handleToken } from "./oauth/token";
import { handleRevoke } from "./oauth/revoke";
import { handleMcpRequest } from "./mcp/handler";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const baseUrl = url.origin;
    const path = url.pathname;
    const method = request.method;

    // Health check
    if (path === "/health" && method === "GET") {
      return Response.json({ status: "ok" });
    }

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

    // Token revocation
    if (path === "/revoke" && method === "POST") {
      return handleRevoke(request, env);
    }

    // MCP server (handles JSON-RPC protocol, dispatches tool calls to PostHog API)
    // Claude.ai sends MCP requests to the root path, so handle both "/" and "/mcp"
    if (path === "/mcp" || path === "/") {
      return handleMcpRequest(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
