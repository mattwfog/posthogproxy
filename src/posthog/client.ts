import type { TokenData } from "../types";
import type {
  Project,
  Person,
  Event,
  FeatureFlag,
  Dashboard,
  QueryResult,
  PaginatedResponse,
} from "./types";

const POSTHOG_HOSTS: Readonly<Record<string, string>> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

const REQUEST_TIMEOUT_MS = 30_000;

export type PostHogResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly message: string };

export interface PropertyFilter {
  readonly key: string;
  readonly value: string;
  readonly operator?: string;
}

export interface EventParams {
  readonly event?: string;
  readonly date_from?: string;
  readonly properties?: readonly PropertyFilter[];
  readonly limit?: number;
}

export interface FlagParams {
  readonly active?: boolean;
  readonly search?: string;
}

export interface PostHogClient {
  listProjects(): Promise<PostHogResult<readonly Project[]>>;
  query(projectId: number, query: object): Promise<PostHogResult<QueryResult>>;
  listEvents(projectId: number, params: EventParams): Promise<PostHogResult<PaginatedResponse<Event>>>;
  searchPersons(projectId: number, search: string): Promise<PostHogResult<PaginatedResponse<Person>>>;
  getPersonEvents(projectId: number, distinctId: string, limit?: number): Promise<PostHogResult<PaginatedResponse<Event>>>;
  listFeatureFlags(projectId: number, params?: FlagParams): Promise<PostHogResult<PaginatedResponse<FeatureFlag>>>;
  listDashboards(projectId: number): Promise<PostHogResult<PaginatedResponse<Dashboard>>>;
}

function buildUrl(base: string, path: string, params?: Record<string, string>): string {
  const url = new URL(path, base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function createPostHogClient(
  tokenData: TokenData,
  fetcher: typeof fetch = fetch,
): PostHogClient {
  const baseUrl = POSTHOG_HOSTS[tokenData.posthog_region] ?? POSTHOG_HOSTS.us;
  const headers: Readonly<Record<string, string>> = {
    Authorization: `Bearer ${tokenData.posthog_api_key}`,
    "Content-Type": "application/json",
  };

  async function request<T>(
    method: "GET" | "POST",
    url: string,
    body?: object,
  ): Promise<PostHogResult<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetcher(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "Unknown error");
        return { ok: false, status: response.status, message: text };
      }

      const data = (await response.json()) as T;
      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      return { ok: false, status: 502, message };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function get<T>(path: string, params?: Record<string, string>): Promise<PostHogResult<T>> {
    return request<T>("GET", buildUrl(baseUrl, path, params));
  }

  async function post<T>(path: string, body: object): Promise<PostHogResult<T>> {
    return request<T>("POST", buildUrl(baseUrl, path), body);
  }

  return {
    async listProjects(): Promise<PostHogResult<readonly Project[]>> {
      const result = await get<{ results: readonly Project[] }>("/api/projects/");
      if (!result.ok) return result;
      return { ok: true, data: result.data.results };
    },

    query(projectId: number, query: object): Promise<PostHogResult<QueryResult>> {
      return post<QueryResult>(`/api/environments/${projectId}/query/`, { query });
    },

    listEvents(projectId: number, params: EventParams): Promise<PostHogResult<PaginatedResponse<Event>>> {
      const searchParams: Record<string, string> = {};
      if (params.event !== undefined) searchParams.event = params.event;
      if (params.date_from !== undefined) searchParams.after = params.date_from;
      if (params.limit !== undefined) searchParams.limit = String(params.limit);
      if (params.properties !== undefined) {
        searchParams.properties = JSON.stringify(params.properties);
      }
      return get<PaginatedResponse<Event>>(
        `/api/environments/${projectId}/events/`,
        searchParams,
      );
    },

    searchPersons(projectId: number, search: string): Promise<PostHogResult<PaginatedResponse<Person>>> {
      return get<PaginatedResponse<Person>>(
        `/api/environments/${projectId}/persons/`,
        { search },
      );
    },

    getPersonEvents(
      projectId: number,
      distinctId: string,
      limit?: number,
    ): Promise<PostHogResult<PaginatedResponse<Event>>> {
      const params: Record<string, string> = { distinct_id: distinctId };
      if (limit !== undefined) params.limit = String(limit);
      return get<PaginatedResponse<Event>>(
        `/api/environments/${projectId}/events/`,
        params,
      );
    },

    listFeatureFlags(
      projectId: number,
      params?: FlagParams,
    ): Promise<PostHogResult<PaginatedResponse<FeatureFlag>>> {
      const searchParams: Record<string, string> = {};
      if (params?.active !== undefined) searchParams.active = String(params.active);
      if (params?.search !== undefined) searchParams.search = params.search;
      return get<PaginatedResponse<FeatureFlag>>(
        `/api/environments/${projectId}/feature_flags/`,
        searchParams,
      );
    },

    listDashboards(projectId: number): Promise<PostHogResult<PaginatedResponse<Dashboard>>> {
      return get<PaginatedResponse<Dashboard>>(
        `/api/environments/${projectId}/dashboards/`,
      );
    },
  };
}
