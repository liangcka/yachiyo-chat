import { fetchWithTimeout } from "../http";
import type { WebSearchResult } from "../types";
import { BaseWebSearchProvider, DEFAULT_SEARCH_TIMEOUT_MS } from "./base";
import type { WebSearchRequest } from "./types";

interface BochaPageItem {
  name?: string;
  url?: string;
  snippet?: string;
  summary?: string;
  datePublished?: string;
  dateLastCrawled?: string;
}

interface BochaSearchResponse {
  code?: number;
  data?: {
    webPages?: {
      value?: BochaPageItem[];
    };
  };
}

/**
 * 博查 (Bocha AI) 专为中文与大模型设计的高性能搜索 API
 * (https://bochaai.com/)
 */
export class BochaWebSearchProvider extends BaseWebSearchProvider {
  readonly id = "bocha";
  readonly name = "Bocha AI Search";

  available(env?: Record<string, unknown>): boolean {
    return typeof env?.BOCHA_API_KEY === "string" && env.BOCHA_API_KEY.length > 0;
  }

  async search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    env?: Record<string, unknown>,
  ): Promise<WebSearchResult[]> {
    const apiKey = request.apiKey || (env?.BOCHA_API_KEY as string | undefined);
    if (!apiKey) {
      return [];
    }

    const queryStr = this.resolveQueryString(request.query);
    if (!queryStr) {
      return [];
    }

    const maxResults = request.maxResults ?? 5;
    const url = "https://api.bochaai.com/v1/web-search";

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query: queryStr,
            freshness: "noLimit",
            summary: true,
            count: maxResults,
          }),
        },
        DEFAULT_SEARCH_TIMEOUT_MS,
        signal,
      );

      if (!response.ok) {
        return [];
      }

      const body = (await response.json()) as BochaSearchResponse;
      const items = body.data?.webPages?.value || [];

      const rawResults = items.map((item) =>
        this.formatResultItem({
          title: item.name,
          url: item.url,
          snippet: item.summary || item.snippet,
          publishedAt: item.datePublished || item.dateLastCrawled,
        }),
      );

      return this.sieveAndLimit(rawResults, queryStr, request.locale, maxResults);
    } catch {
      return [];
    }
  }
}
