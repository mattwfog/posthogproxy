import type { Env, ClientRegistration, AuthCodeData } from "../types";
import { generateId } from "../crypto";

const POSTHOG_ENDPOINTS: Record<string, string> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

type ApiKeyValidator = (apiKey: string, region: string) => Promise<boolean>;
type WordPressValidator = (siteUrl: string, username: string, appPassword: string) => Promise<boolean>;

export async function validateWordPressCredentials(
  siteUrl: string,
  username: string,
  appPassword: string,
): Promise<boolean> {
  try {
    const credentials = btoa(`${username}:${appPassword}`);
    const response = await fetch(
      `${siteUrl.replace(/\/+$/, "")}/wp-json/wp/v2/posts?per_page=1`,
      { headers: { Authorization: `Basic ${credentials}` } },
    );
    return response.ok;
  } catch {
    return false;
  }
}

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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAuthForm(params: URLSearchParams, error?: string): Response {
  const clientId = escapeHtml(params.get("client_id") ?? "");
  const redirectUri = escapeHtml(params.get("redirect_uri") ?? "");
  const state = escapeHtml(params.get("state") ?? "");
  const codeChallenge = escapeHtml(params.get("code_challenge") ?? "");
  const codeChallengeMethod = escapeHtml(params.get("code_challenge_method") ?? "");
  const errorHtml = error ? `<div class="error">${escapeHtml(error)}</div>` : "";

  const html = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "  <title>Connect PostHog</title>",
    "  <style>",
    "    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; background: #f8f9fa; }",
    "    .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }",
    "    h1 { font-size: 1.5rem; margin: 0 0 8px; }",
    "    p { color: #666; margin: 0 0 24px; font-size: 0.9rem; }",
    "    label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.9rem; }",
    "    input, select { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 0.9rem; box-sizing: border-box; margin-bottom: 16px; }",
    "    button { width: 100%; padding: 12px; background: #1d4aff; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; }",
    "    button:hover { background: #1538cc; }",
    "    .error { background: #fee; color: #c00; padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; font-size: 0.85rem; }",
    "  </style>",
    "</head>",
    "<body>",
    '  <div class="card">',
    "    <h1>Connect to PostHog</h1>",
    "    <p>Enter your PostHog Personal API Key to authorize this connection.</p>",
    `    ${errorHtml}`,
    '    <form method="POST" action="/authorize">',
    '      <label for="api_key">Personal API Key</label>',
    '      <input type="password" id="api_key" name="api_key" placeholder="phx_..." required />',
    '      <label for="region">Region</label>',
    '      <select id="region" name="region">',
    '        <option value="us">US (us.posthog.com)</option>',
    '        <option value="eu">EU (eu.posthog.com)</option>',
    "      </select>",
    `      <input type="hidden" name="client_id" value="${clientId}" />`,
    `      <input type="hidden" name="redirect_uri" value="${redirectUri}" />`,
    `      <input type="hidden" name="state" value="${state}" />`,
    `      <input type="hidden" name="code_challenge" value="${codeChallenge}" />`,
    `      <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod}" />`,
    '      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0 16px;" />',
    '      <h2 style="font-size: 1.2rem; margin: 0 0 4px;">WordPress (Optional)</h2>',
    '      <p style="color: #888; font-size: 0.82rem; margin: 0 0 16px;">Connect a WordPress site to enable content management tools.</p>',
    '      <label for="wordpress_site_url">Site URL</label>',
    '      <input type="text" id="wordpress_site_url" name="wordpress_site_url" placeholder="https://yoursite.com" />',
    '      <label for="wordpress_username">Username</label>',
    '      <input type="text" id="wordpress_username" name="wordpress_username" />',
    '      <label for="wordpress_app_password">Application Password</label>',
    '      <input type="password" id="wordpress_app_password" name="wordpress_app_password" />',
    '      <p style="color: #888; font-size: 0.78rem; margin: -10px 0 16px;">Generate at WordPress &gt; Users &gt; Your Profile &gt; Application Passwords</p>',
    '      <button type="submit">Connect</button>',
    "    </form>",
    "  </div>",
    "</body>",
    "</html>",
  ].join("\n");

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
  wpValidator: WordPressValidator = validateWordPressCredentials,
): Promise<Response> {
  const formData = await request.formData();
  const apiKey = formData.get("api_key");
  const region = formData.get("region");
  const clientId = formData.get("client_id");
  const redirectUri = formData.get("redirect_uri");
  const state = formData.get("state");
  const codeChallenge = formData.get("code_challenge");
  const codeChallengeMethod = formData.get("code_challenge_method");

  if (
    typeof apiKey !== "string" || !apiKey ||
    typeof clientId !== "string" || !clientId ||
    typeof redirectUri !== "string" || !redirectUri
  ) {
    return renderAuthForm(new URLSearchParams(), "Missing required fields");
  }

  const regionStr = typeof region === "string" ? region : "us";
  const stateStr = typeof state === "string" ? state : "";
  const codeChallengeStr = typeof codeChallenge === "string" ? codeChallenge : "";
  const codeChallengeMethodStr = typeof codeChallengeMethod === "string" ? codeChallengeMethod : "";

  const client = await lookupClient(clientId, env);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return Response.json({ error: "Invalid client or redirect_uri" }, { status: 400 });
  }

  const isValid = await validator(apiKey, regionStr);
  const formParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state: stateStr,
    code_challenge: codeChallengeStr,
    code_challenge_method: codeChallengeMethodStr,
    response_type: "code",
  });

  if (!isValid) {
    return renderAuthForm(formParams, "Your PostHog API key appears to be invalid. Please check and try again.");
  }

  const wpSiteUrl = formData.get("wordpress_site_url");
  const wpUsername = formData.get("wordpress_username");
  const wpAppPassword = formData.get("wordpress_app_password");

  const wpSiteUrlStr = typeof wpSiteUrl === "string" ? wpSiteUrl.trim() : "";
  const wpUsernameStr = typeof wpUsername === "string" ? wpUsername.trim() : "";
  const wpAppPasswordStr = typeof wpAppPassword === "string" ? wpAppPassword.trim() : "";

  const wpFieldsProvided = [wpSiteUrlStr, wpUsernameStr, wpAppPasswordStr].filter(Boolean);
  const hasAllWp = wpFieldsProvided.length === 3;
  const hasNoWp = wpFieldsProvided.length === 0;

  if (!hasAllWp && !hasNoWp) {
    return renderAuthForm(formParams, "Please fill in all WordPress fields or leave them all empty.");
  }

  if (hasAllWp) {
    const wpValid = await wpValidator(wpSiteUrlStr, wpUsernameStr, wpAppPasswordStr);
    if (!wpValid) {
      return renderAuthForm(formParams, "WordPress connection failed. Please verify your site URL, username, and application password.");
    }
  }

  const code = generateId();
  const authCodeData: AuthCodeData = {
    posthog_api_key: apiKey,
    posthog_region: regionStr === "eu" ? "eu" : "us",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallengeStr,
    code_challenge_method: codeChallengeMethodStr,
    ...(hasAllWp ? {
      wordpress_site_url: wpSiteUrlStr,
      wordpress_username: wpUsernameStr,
      wordpress_app_password: wpAppPasswordStr,
    } : {}),
  };

  await env.AUTH_CODES.put(code, JSON.stringify(authCodeData), { expirationTtl: 300 });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (stateStr) {
    redirect.searchParams.set("state", stateStr);
  }

  return Response.redirect(redirect.toString(), 302);
}
