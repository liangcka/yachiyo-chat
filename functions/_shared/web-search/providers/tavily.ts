import { fetchWithTimeout } from "../http";
import type { WebSearchResult } from "../types";
import { BaseWebSearchProvider, DEFAULT_SEARCH_TIMEOUT_MS } from "./base";
import type { WebSearchRequest } from "./types";

interface TavilyApiResult {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

interface TavilyApiResponse {
  results?: TavilyApiResult[];
}

/**
 * 对齐 DSH packages/web/web-search-tavily
 * Tavily 针对大模型优化的实时事实与研究搜索引擎。
 */
export class TavilyWebSearchProvider extends BaseWebSearchProvider {
  readonly id = "tavily";
  readonly name = "Tavily Search";

  available(env?: Record<string, unknown>): boolean {
    return typeof env?.TAVILY_API_KEY === "string" && env.TAVILY_API_KEY.length > 0;
  }

  async search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    env?: Record<string, unknown>,
  ): Promise<WebSearchResult[]> {
    const apiKey = request.apiKey || (env?.TAVILY_API_KEY as string | undefined);
    if (!apiKey) {
      return [];
    }

    const queryStr = this.resolveQueryString(request.query);
    if (!queryStr) {
      return [];
    }
    const maxResults = request.maxResults ?? 5;

    try {
      const response = await fetchWithTimeout(
        "https://api.tavily.com/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query: queryStr,
            search_depth: "basic",
            max_results: maxResults,
          }),
        },
        DEFAULT_SEARCH_TIMEOUT_MS,
        signal,
      );

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as TavilyApiResponse;
      const rawResults = (data.results ?? []).map((item) =>
        this.formatResultItem({
          title: item.title,
          url: item.url,
          snippet: item.content,
          publishedAt: item.published_date ? item.published_date.slice(0, 10) : undefined,
        }),
      );

      return this.sieveAndLimit(rawResults, queryStr, request.locale, maxResults);
    } catch {
      return [];
    }
  }
}
