export interface Env {
  readonly CLIENTS: KVNamespace;
  readonly AUTH_CODES: KVNamespace;
  readonly TOKENS: KVNamespace;
}

export interface ClientRegistration {
  readonly client_id: string;
  readonly client_secret: string;
  readonly client_name: string;
  readonly redirect_uris: readonly string[];
  readonly grant_types: readonly string[];
  readonly token_endpoint_auth_method: string;
  readonly created_at: number;
}

export interface AuthCodeData {
  readonly posthog_api_key: string;
  readonly posthog_region: "us" | "eu";
  readonly client_id: string;
  readonly redirect_uri: string;
  readonly code_challenge: string;
  readonly code_challenge_method: string;
  readonly wordpress_site_url?: string;
  readonly wordpress_username?: string;
  readonly wordpress_app_password?: string;
}

export interface TokenData {
  readonly posthog_api_key: string;
  readonly posthog_region: "us" | "eu";
  readonly client_id: string;
  readonly created_at: number;
  readonly expires_at: number;
  readonly wordpress_site_url?: string;
  readonly wordpress_username?: string;
  readonly wordpress_app_password?: string;
}
