import { describe, it, expect } from "vitest";
import {
  parseJsonRpcRequest,
  jsonRpcResult,
  jsonRpcError,
  JSON_RPC_ERRORS,
} from "../../src/mcp/protocol";

describe("parseJsonRpcRequest", () => {
  it("parses a valid request with all fields", () => {
    const input = {
      jsonrpc: "2.0",
      method: "tools/call",
      id: 1,
      params: { name: "list_projects" },
    };

    const result = parseJsonRpcRequest(input);

    expect(result).toEqual({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 1,
      params: { name: "list_projects" },
    });
    expect("error" in result).toBe(false);
  });

  it("parses a valid request with no id (notification)", () => {
    const input = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };

    const result = parseJsonRpcRequest(input);

    expect(result).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect("error" in result).toBe(false);
    expect("id" in result).toBe(false);
  });

  it("parses a valid request with no params", () => {
    const input = {
      jsonrpc: "2.0",
      method: "ping",
      id: "abc-123",
    };

    const result = parseJsonRpcRequest(input);

    expect(result).toEqual({
      jsonrpc: "2.0",
      method: "ping",
      id: "abc-123",
    });
    expect("error" in result).toBe(false);
    expect("params" in result).toBe(false);
  });

  it("returns error when jsonrpc field is missing", () => {
    const input = { method: "ping", id: 1 };

    const result = parseJsonRpcRequest(input);

    expect("error" in result).toBe(true);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSON_RPC_ERRORS.INVALID_REQUEST,
        message: 'Missing or invalid "jsonrpc" field (must be "2.0")',
      },
    });
  });

  it("returns error when jsonrpc version is wrong", () => {
    const input = { jsonrpc: "1.0", method: "ping", id: 1 };

    const result = parseJsonRpcRequest(input);

    expect("error" in result).toBe(true);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSON_RPC_ERRORS.INVALID_REQUEST,
      },
    });
  });

  it("returns error when method is missing", () => {
    const input = { jsonrpc: "2.0", id: 1 };

    const result = parseJsonRpcRequest(input);

    expect("error" in result).toBe(true);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: JSON_RPC_ERRORS.INVALID_REQUEST,
        message: 'Missing or invalid "method" field',
      },
    });
  });

  it("returns error when method is not a string", () => {
    const input = { jsonrpc: "2.0", method: 42, id: 1 };

    const result = parseJsonRpcRequest(input);

    expect("error" in result).toBe(true);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: JSON_RPC_ERRORS.INVALID_REQUEST,
        message: 'Missing or invalid "method" field',
      },
    });
  });

  it("returns error when params is an array", () => {
    const input = {
      jsonrpc: "2.0",
      method: "ping",
      id: 1,
      params: [1, 2, 3],
    };

    const result = parseJsonRpcRequest(input);

    expect("error" in result).toBe(true);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: '"params" must be an object if present',
      },
    });
  });

  it("returns error when params is a string", () => {
    const input = {
      jsonrpc: "2.0",
      method: "ping",
      id: 1,
      params: "not-an-object",
    };

    const result = parseJsonRpcRequest(input);

    expect("error" in result).toBe(true);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
        message: '"params" must be an object if present',
      },
    });
  });

  it("returns error when id is a boolean", () => {
    const input = {
      jsonrpc: "2.0",
      method: "ping",
      id: true,
    };

    const result = parseJsonRpcRequest(input);

    expect("error" in result).toBe(true);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSON_RPC_ERRORS.INVALID_REQUEST,
        message: '"id" must be a string or number if present',
      },
    });
  });

  it("returns error when input is a string", () => {
    const result = parseJsonRpcRequest("not an object");

    expect("error" in result).toBe(true);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSON_RPC_ERRORS.INVALID_REQUEST,
        message: "Request body must be a JSON object",
      },
    });
  });

  it("returns error when input is null", () => {
    const result = parseJsonRpcRequest(null);

    expect("error" in result).toBe(true);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSON_RPC_ERRORS.INVALID_REQUEST,
        message: "Request body must be a JSON object",
      },
    });
  });

  it("returns error when input is a number", () => {
    const result = parseJsonRpcRequest(42);

    expect("error" in result).toBe(true);
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSON_RPC_ERRORS.INVALID_REQUEST,
        message: "Request body must be a JSON object",
      },
    });
  });
});

describe("jsonRpcResult", () => {
  it("returns correct structure with id and result", () => {
    const result = jsonRpcResult(42, { tools: [] });

    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { tools: [] },
    });
  });

  it("supports null id", () => {
    const result = jsonRpcResult(null, "pong");

    expect(result).toEqual({
      jsonrpc: "2.0",
      id: null,
      result: "pong",
    });
  });

  it("supports string id", () => {
    const result = jsonRpcResult("req-1", { ok: true });

    expect(result).toEqual({
      jsonrpc: "2.0",
      id: "req-1",
      result: { ok: true },
    });
  });
});

describe("jsonRpcError", () => {
  it("returns correct structure with error code and message", () => {
    const result = jsonRpcError(1, JSON_RPC_ERRORS.METHOD_NOT_FOUND, "Method not found: foo");

    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32601,
        message: "Method not found: foo",
      },
    });
  });

  it("includes data field when provided", () => {
    const result = jsonRpcError(
      "req-2",
      JSON_RPC_ERRORS.INTERNAL_ERROR,
      "Something went wrong",
      { detail: "stack trace here" },
    );

    expect(result).toEqual({
      jsonrpc: "2.0",
      id: "req-2",
      error: {
        code: -32603,
        message: "Something went wrong",
        data: { detail: "stack trace here" },
      },
    });
  });

  it("omits data field when not provided", () => {
    const result = jsonRpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, "Parse error");

    expect(result).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
      },
    });
    expect("data" in result.error!).toBe(false);
  });
});
