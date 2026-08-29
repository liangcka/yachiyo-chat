import { fetchWithTimeout } from "../http";
import type { WebSearchResult } from "../types";
import { BaseWebSearchProvider, DEFAULT_SEARCH_TIMEOUT_MS } from "./base";
import type { WebSearchRequest } from "./types";

interface ExaApiResult {
  title?: string;
  url: string;
  text?: string;
  publishedDate?: string;
  highlights?: string[];
}

interface ExaApiResponse {
  results?: ExaApiResult[];
}

/**
 * 对齐 DSH packages/web/web-search-exa
 * Exa 专为 LLM 设计的神经语义搜索引擎，能够理解网络梗、冷门概念及复合词定义。
 */
export class ExaWebSearchProvider extends BaseWebSearchProvider {
  readonly id = "exa";
  readonly name = "Exa Neural Search";

  available(env?: Record<string, unknown>): boolean {
    return typeof env?.EXA_API_KEY === "string" && env.EXA_API_KEY.length > 0;
  }

  async search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    env?: Record<string, unknown>,
  ): Promise<WebSearchResult[]> {
    const apiKey = request.apiKey || (env?.EXA_API_KEY as string | undefined);
    if (!apiKey) {
      return [];
    }

    const queryStr = this.resolveQueryString(request.query);
    if (!queryStr) {
      return [];
    }
    const numResults = request.maxResults ?? 5;

    try {
      const response = await fetchWithTimeout(
        "https://api.exa.ai/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            query: queryStr,
            numResults,
            type: "auto",
            contents: {
              highlights: { numSentences: 3 },
              text: { maxCharacters: 500 },
            },
          }),
        },
        DEFAULT_SEARCH_TIMEOUT_MS,
        signal,
      );

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as ExaApiResponse;
      const rawResults = (data.results ?? []).map((item) => {
        const snippetText = item.highlights?.[0] || item.text || "";
        const publishedAt = item.publishedDate ? item.publishedDate.slice(0, 10) : undefined;
        return this.formatResultItem({
          title: item.title || item.url,
          url: item.url,
          snippet: snippetText,
          publishedAt,
        });
      });

      return this.sieveAndLimit(rawResults, queryStr, request.locale, numResults);
    } catch {
      return [];
    }
  }
}
