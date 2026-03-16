import type { Env } from "../types";

function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

export async function handleRevoke(request: Request, env: Env): Promise<Response> {
  const token = extractBearerToken(request.headers.get("authorization"));

  if (!token) {
    return Response.json({ error: "Missing Bearer token" }, { status: 400 });
  }

  await env.TOKENS.delete(token);

  return Response.json({ revoked: true });
}
