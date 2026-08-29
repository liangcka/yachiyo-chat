import { fetchWithTimeout } from "../http";
import type { WebSearchResult } from "../types";
import { BaseWebSearchProvider, DEFAULT_SEARCH_TIMEOUT_MS } from "./base";
import type { WebSearchRequest } from "./types";

interface BraveResultItem {
  title?: string;
  url?: string;
  description?: string;
  page_age?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveResultItem[];
  };
}

/**
 * Brave Search API 提供商 (https://brave.com/search/api/)
 * 隐私优先、高吞吐的全球独立网络索引。
 */
export class BraveWebSearchProvider extends BaseWebSearchProvider {
  readonly id = "brave";
  readonly name = "Brave Search";

  available(env?: Record<string, unknown>): boolean {
    return typeof env?.BRAVE_API_KEY === "string" && env.BRAVE_API_KEY.length > 0;
  }

  async search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    env?: Record<string, unknown>,
  ): Promise<WebSearchResult[]> {
    const apiKey = request.apiKey || (env?.BRAVE_API_KEY as string | undefined);
    if (!apiKey) {
      return [];
    }

    const queryStr = this.resolveQueryString(request.query);
    if (!queryStr) {
      return [];
    }

    const maxResults = request.maxResults ?? 5;
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(queryStr)}&count=${maxResults}`;

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": apiKey,
          },
        },
        DEFAULT_SEARCH_TIMEOUT_MS,
        signal,
      );

      if (!response.ok) {
        return [];
      }

      const body = (await response.json()) as BraveSearchResponse;
      const items = Array.isArray(body.web?.results) ? body.web.results : [];

      const rawResults = items.map((item) =>
        this.formatResultItem({
          title: item.title,
          url: item.url,
          snippet: item.description,
          publishedAt: item.page_age,
        }),
      );

      return this.sieveAndLimit(rawResults, queryStr, request.locale, maxResults);
    } catch {
      return [];
    }
  }
}
