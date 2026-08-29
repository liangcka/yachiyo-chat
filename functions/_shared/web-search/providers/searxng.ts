import { fetchWithTimeout } from "../http";
import type { WebSearchResult } from "../types";
import { BaseWebSearchProvider, DEFAULT_SEARCH_TIMEOUT_MS } from "./base";
import type { WebSearchRequest } from "./types";

interface SearxngResultItem {
  title?: string;
  url?: string;
  content?: string;
  publishedDate?: string;
}

interface SearxngResponse {
  results?: SearxngResultItem[];
}

/**
 * SearXNG / Searx 开源元搜索引擎提供商
 * 支持配置自建或公共 SearXNG 实例 (SEARXNG_BASE_URL)
 */
export class SearXNGWebSearchProvider extends BaseWebSearchProvider {
  readonly id = "searxng";
  readonly name = "SearXNG Metasearch";

  available(env?: Record<string, unknown>): boolean {
    return (
      typeof env?.SEARXNG_BASE_URL === "string" &&
      env.SEARXNG_BASE_URL.length > 0 &&
      env.SEARXNG_BASE_URL.startsWith("http")
    );
  }

  async search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    env?: Record<string, unknown>,
  ): Promise<WebSearchResult[]> {
    const rawBaseUrl = env?.SEARXNG_BASE_URL as string | undefined;
    if (!rawBaseUrl) {
      return [];
    }

    const queryStr = this.resolveQueryString(request.query);
    if (!queryStr) {
      return [];
    }

    const baseUrl = rawBaseUrl.replace(/\/+$/, "");
    const apiKey = request.apiKey || (env?.SEARXNG_API_KEY as string | undefined);
    const maxResults = request.maxResults ?? 5;
    const url = `${baseUrl}/search?q=${encodeURIComponent(queryStr)}&format=json`;

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers,
        },
        DEFAULT_SEARCH_TIMEOUT_MS,
        signal,
      );

      if (!response.ok) {
        return [];
      }

      const body = (await response.json()) as SearxngResponse;
      const items = Array.isArray(body.results) ? body.results : [];

      const rawResults = items.map((item) =>
        this.formatResultItem({
          title: item.title,
          url: item.url,
          snippet: item.content,
          publishedAt: item.publishedDate,
        }),
      );

      return this.sieveAndLimit(rawResults, queryStr, request.locale, maxResults);
    } catch {
      return [];
    }
  }
}
