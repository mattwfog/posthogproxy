import type { TokenData } from "../types";
import type { WPPost, WPPage, PostUpdate, PageUpdate } from "./types";

const REQUEST_TIMEOUT_MS = 30_000;

export type WPResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly message: string };

export interface WordPressClient {
  listPosts(params?: { readonly search?: string; readonly status?: string; readonly per_page?: number }): Promise<WPResult<readonly WPPost[]>>;
  getPost(postId: number): Promise<WPResult<WPPost>>;
  updatePost(postId: number, data: PostUpdate): Promise<WPResult<WPPost>>;
  listPages(params?: { readonly search?: string; readonly status?: string; readonly per_page?: number }): Promise<WPResult<readonly WPPage[]>>;
  getPage(pageId: number): Promise<WPResult<WPPage>>;
  updatePage(pageId: number, data: PageUpdate): Promise<WPResult<WPPage>>;
}

function buildUrl(base: string, path: string, params?: Readonly<Record<string, string>>): string {
  const url = new URL(path, base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function createWordPressClient(
  tokenData: TokenData,
  fetcher: typeof fetch = fetch,
): WordPressClient | null {
  if (!tokenData.wordpress_site_url || !tokenData.wordpress_username || !tokenData.wordpress_app_password) {
    return null;
  }

  const baseUrl = `${tokenData.wordpress_site_url.replace(/\/+$/, "")}/wp-json/wp/v2`;
  const credentials = btoa(`${tokenData.wordpress_username}:${tokenData.wordpress_app_password}`);
  const headers: Readonly<Record<string, string>> = {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/json",
  };

  async function request<T>(
    method: "GET" | "POST",
    url: string,
    body?: object,
  ): Promise<WPResult<T>> {
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

  async function get<T>(path: string, params?: Readonly<Record<string, string>>): Promise<WPResult<T>> {
    return request<T>("GET", buildUrl(baseUrl, path, params));
  }

  async function post<T>(path: string, body: object): Promise<WPResult<T>> {
    return request<T>("POST", buildUrl(baseUrl, path), body);
  }

  return {
    listPosts(params?: { readonly search?: string; readonly status?: string; readonly per_page?: number }): Promise<WPResult<readonly WPPost[]>> {
      const searchParams: Record<string, string> = {};
      if (params?.search !== undefined) searchParams.search = params.search;
      if (params?.status !== undefined) searchParams.status = params.status;
      if (params?.per_page !== undefined) searchParams.per_page = String(params.per_page);
      return get<readonly WPPost[]>("/posts", searchParams);
    },

    getPost(postId: number): Promise<WPResult<WPPost>> {
      return get<WPPost>(`/posts/${postId}`);
    },

    updatePost(postId: number, data: PostUpdate): Promise<WPResult<WPPost>> {
      return post<WPPost>(`/posts/${postId}`, data);
    },

    listPages(params?: { readonly search?: string; readonly status?: string; readonly per_page?: number }): Promise<WPResult<readonly WPPage[]>> {
      const searchParams: Record<string, string> = {};
      if (params?.search !== undefined) searchParams.search = params.search;
      if (params?.status !== undefined) searchParams.status = params.status;
      if (params?.per_page !== undefined) searchParams.per_page = String(params.per_page);
      return get<readonly WPPage[]>("/pages", searchParams);
    },

    getPage(pageId: number): Promise<WPResult<WPPage>> {
      return get<WPPage>(`/pages/${pageId}`);
    },

    updatePage(pageId: number, data: PageUpdate): Promise<WPResult<WPPage>> {
      return post<WPPage>(`/pages/${pageId}`, data);
    },
  };
}
