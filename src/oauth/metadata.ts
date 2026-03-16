export function handleProtectedResourceMetadata(baseUrl: string): Response {
  return Response.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
  });
}

export function handleAuthorizationServerMetadata(baseUrl: string): Response {
  return Response.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
