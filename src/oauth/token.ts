import type { Env, AuthCodeData, TokenData } from "../types";
import { verifyPkceS256, generateSecret } from "../crypto";

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function handleToken(request: Request, env: Env): Promise<Response> {
  let body: FormData;
  try {
    body = await request.formData();
  } catch {
    return Response.json(
      { error: "invalid_request", error_description: "Invalid request body" },
      { status: 400 },
    );
  }

  const grantType = body.get("grant_type");

  if (typeof grantType !== "string" || grantType !== "authorization_code") {
    return Response.json(
      { error: "unsupported_grant_type", error_description: "Only authorization_code is supported" },
      { status: 400 },
    );
  }

  const code = body.get("code");
  const redirectUri = body.get("redirect_uri");
  const clientId = body.get("client_id");
  const codeVerifier = body.get("code_verifier");

  if (
    typeof code !== "string" || !code ||
    typeof redirectUri !== "string" || !redirectUri ||
    typeof clientId !== "string" || !clientId ||
    typeof codeVerifier !== "string" || !codeVerifier
  ) {
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
    ...(authCodeData.wordpress_site_url ? {
      wordpress_site_url: authCodeData.wordpress_site_url,
      wordpress_username: authCodeData.wordpress_username,
      wordpress_app_password: authCodeData.wordpress_app_password,
    } : {}),
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
