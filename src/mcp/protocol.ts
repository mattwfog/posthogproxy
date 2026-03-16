export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly id?: string | number;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

/** Standard JSON-RPC error codes */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * Validates and parses a raw JSON body into a JsonRpcRequest.
 * Returns a JsonRpcResponse error if the body is malformed.
 */
export function parseJsonRpcRequest(
  body: unknown,
): JsonRpcRequest | JsonRpcResponse {
  if (body === null || body === undefined || typeof body !== "object") {
    return jsonRpcError(
      null,
      JSON_RPC_ERRORS.INVALID_REQUEST,
      "Request body must be a JSON object",
    );
  }

  const obj = body as Record<string, unknown>;

  if (obj.jsonrpc !== "2.0") {
    return jsonRpcError(
      null,
      JSON_RPC_ERRORS.INVALID_REQUEST,
      'Missing or invalid "jsonrpc" field (must be "2.0")',
    );
  }

  if (typeof obj.method !== "string" || obj.method.length === 0) {
    return jsonRpcError(
      extractId(obj),
      JSON_RPC_ERRORS.INVALID_REQUEST,
      'Missing or invalid "method" field',
    );
  }

  if (
    obj.id !== undefined &&
    typeof obj.id !== "string" &&
    typeof obj.id !== "number"
  ) {
    return jsonRpcError(
      null,
      JSON_RPC_ERRORS.INVALID_REQUEST,
      '"id" must be a string or number if present',
    );
  }

  if (
    obj.params !== undefined &&
    (typeof obj.params !== "object" || obj.params === null || Array.isArray(obj.params))
  ) {
    return jsonRpcError(
      extractId(obj),
      JSON_RPC_ERRORS.INVALID_PARAMS,
      '"params" must be an object if present',
    );
  }

  return {
    jsonrpc: "2.0",
    method: obj.method,
    ...(obj.id !== undefined ? { id: obj.id as string | number } : {}),
    ...(obj.params !== undefined
      ? { params: obj.params as Record<string, unknown> }
      : {}),
  };
}

/** Creates a successful JSON-RPC response. */
export function jsonRpcResult(
  id: string | number | null,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

/** Creates a JSON-RPC error response. */
export function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data !== undefined ? { code, message, data } : { code, message },
  };
}

function extractId(obj: Record<string, unknown>): string | number | null {
  if (typeof obj.id === "string" || typeof obj.id === "number") {
    return obj.id;
  }
  return null;
}
