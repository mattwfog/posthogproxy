import type { Env, ClientRegistration } from "../types";
import { generateId } from "../crypto";

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: "invalid_request", error_description: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return Response.json(
      { error: "invalid_client_metadata", error_description: "redirect_uris is required" },
      { status: 400 },
    );
  }

  for (const uri of redirectUris) {
    if (typeof uri !== "string" || (!uri.startsWith("https://") && !uri.startsWith("http://localhost"))) {
      return Response.json(
        { error: "invalid_client_metadata", error_description: "Each redirect_uri must be an HTTPS URL or http://localhost" },
        { status: 400 },
      );
    }
  }

  const clientName = typeof body.client_name === "string" ? body.client_name : "Unknown";
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types as string[] : ["authorization_code"];

  const clientId = generateId();

  const registration: ClientRegistration = {
    client_id: clientId,
    client_secret: "",
    client_name: clientName,
    redirect_uris: redirectUris as string[],
    grant_types: grantTypes,
    token_endpoint_auth_method: "none",
    created_at: Date.now(),
  };

  await env.CLIENTS.put(clientId, JSON.stringify(registration));

  return Response.json({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    token_endpoint_auth_method: "none",
  }, { status: 201 });
}
