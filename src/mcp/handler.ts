import type { Env, TokenData } from "../types";
import { generateId } from "../crypto";
import {
  parseJsonRpcRequest,
  jsonRpcResult,
  jsonRpcError,
  JSON_RPC_ERRORS,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol";
import { getToolDefinitions, dispatchToolCall } from "../tools/registry";

const SERVER_INFO = {
  protocolVersion: "2025-03-26",
  capabilities: { tools: {} },
  serverInfo: { name: "posthog-mcp", version: "1.0.0" },
  instructions: "Query your PostHog analytics. Use the available tools to list projects, query trends, search events, find persons, and run HogQL queries.",
} as const;

function extractBearerToken(header: string | null): string | null {
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

function jsonResponse(
  body: JsonRpcResponse,
  status: number = 200,
  extraHeaders?: Record<string, string>,
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...extraHeaders,
  };
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Authenticates the request by extracting the bearer token, looking it up
 * in KV, and verifying expiry.
 * Returns the TokenData on success, or a 401 Response on failure.
 */
async function authenticateRequest(
  request: Request,
  env: Env,
): Promise<TokenData | Response> {
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

  return tokenData;
}

/**
 * Checks if a parsed result is a JSON-RPC error response
 * (meaning parseJsonRpcRequest failed validation).
 */
function isErrorResponse(
  parsed: JsonRpcRequest | JsonRpcResponse,
): parsed is JsonRpcResponse {
  return "error" in parsed;
}

/**
 * Dispatches a validated JSON-RPC request to the appropriate handler.
 * Returns the JSON-RPC response and optional extra headers.
 */
async function dispatch(
  rpcRequest: JsonRpcRequest,
  tokenData: TokenData,
): Promise<{ readonly response: JsonRpcResponse; readonly headers?: Record<string, string>; readonly status?: number }> {
  const id = rpcRequest.id ?? null;

  switch (rpcRequest.method) {
    case "initialize": {
      const sessionId = generateId();
      return {
        response: jsonRpcResult(id, SERVER_INFO),
        headers: { "mcp-session-id": sessionId },
      };
    }

    case "notifications/initialized": {
      // Notification -- no response body, 202 Accepted
      return {
        response: jsonRpcResult(id, null),
        status: 202,
      };
    }

    case "ping": {
      return { response: jsonRpcResult(id, {}) };
    }

    case "tools/list": {
      const definitions = getToolDefinitions();
      return { response: jsonRpcResult(id, { tools: definitions }) };
    }

    case "tools/call": {
      return handleToolsCall(id, rpcRequest.params, tokenData);
    }

    default: {
      return {
        response: jsonRpcError(
          id,
          JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          `Method not found: ${rpcRequest.method}`,
        ),
      };
    }
  }
}

async function handleToolsCall(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  tokenData: TokenData,
): Promise<{ readonly response: JsonRpcResponse }> {
  if (!params || typeof params.name !== "string") {
    return {
      response: jsonRpcError(
        id,
        JSON_RPC_ERRORS.INVALID_PARAMS,
        'Missing required parameter "name"',
      ),
    };
  }

  const toolName = params.name;
  const toolArgs =
    params.arguments !== undefined &&
    typeof params.arguments === "object" &&
    params.arguments !== null &&
    !Array.isArray(params.arguments)
      ? (params.arguments as Record<string, unknown>)
      : {};

  try {
    const result = await dispatchToolCall(toolName, toolArgs, tokenData);
    return { response: jsonRpcResult(id, result) };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal error during tool execution";
    return {
      response: jsonRpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, message),
    };
  }
}

/**
 * Main MCP HTTP handler. Replaces the old proxy/mcp.ts handleMcp function.
 * Handles POST (JSON-RPC requests) and DELETE (session termination) on /mcp and /.
 */
export async function handleMcpRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  // Authenticate
  const authResult = await authenticateRequest(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }
  const tokenData = authResult;

  // Route by HTTP method
  switch (request.method) {
    case "POST":
      return handlePost(request, tokenData);

    case "DELETE":
      // Session termination -- acknowledge
      return new Response(null, { status: 200 });

    default:
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "POST, DELETE" },
      });
  }
}

async function handlePost(
  request: Request,
  tokenData: TokenData,
): Promise<Response> {
  // Parse raw JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      jsonRpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, "Parse error: invalid JSON"),
      200,
    );
  }

  // Validate JSON-RPC structure
  const parsed = parseJsonRpcRequest(body);
  if (isErrorResponse(parsed)) {
    return jsonResponse(parsed);
  }

  // Handle notifications/initialized specially -- 202 with no body
  if (parsed.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  // Dispatch the request
  const { response, headers, status } = await dispatch(parsed, tokenData);
  return jsonResponse(response, status ?? 200, headers);
}
