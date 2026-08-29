import { fetchWithTimeout } from "../http";
import type { WebSearchResult } from "../types";
import { BaseWebSearchProvider, DEFAULT_SEARCH_TIMEOUT_MS } from "./base";
import type { WebSearchRequest } from "./types";

interface PerplexityApiResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  citations?: string[];
}

/**
 * 对齐 DeepSeek Harness (DSH) packages/web/web-search-perplexity
 * 基于 Perplexity Sonar API 的高时效性搜索与引用提取。
 */
export class PerplexityWebSearchProvider extends BaseWebSearchProvider {
  readonly id = "perplexity";
  readonly name = "Perplexity Search";

  available(env?: Record<string, unknown>): boolean {
    return (
      typeof env?.PERPLEXITY_API_KEY === "string" && env.PERPLEXITY_API_KEY.length > 0
    );
  }

  async search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    env?: Record<string, unknown>,
  ): Promise<WebSearchResult[]> {
    const apiKey =
      request.apiKey || (env?.PERPLEXITY_API_KEY as string | undefined);
    if (!apiKey) {
      return [];
    }

    const queryStr = this.resolveQueryString(request.query);
    if (!queryStr) {
      return [];
    }

    const model =
      (env?.PERPLEXITY_SEARCH_MODEL as string | undefined) || "sonar";
    const maxResults = request.maxResults ?? 5;

    try {
      const response = await fetchWithTimeout(
        "https://api.perplexity.ai/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: queryStr }],
          }),
        },
        DEFAULT_SEARCH_TIMEOUT_MS,
        signal,
      );

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as PerplexityApiResponse;
      const content = data.choices?.[0]?.message?.content || "";
      const citations = data.citations ?? [];

      const rawResults: (WebSearchResult | null)[] = citations.map((url) => {
        let hostname = url;
        try {
          hostname = new URL(url).hostname;
        } catch {
          // fallback
        }
        return this.formatResultItem({
          title: `${hostname} - 搜索证据`,
          url,
          snippet: content.slice(0, 300),
        });
      });

      return this.sieveAndLimit(rawResults, queryStr, request.locale, maxResults);
    } catch {
      return [];
    }
  }
}
