import { fetchWithTimeout } from "../http";
import type { WebSearchResult } from "../types";
import { BaseWebSearchProvider, DEFAULT_SEARCH_TIMEOUT_MS } from "./base";
import type { WebSearchRequest } from "./types";

interface JinaSearchItem {
  title?: string;
  url?: string;
  description?: string;
  content?: string;
  publishedTime?: string;
}

interface JinaSearchResponse {
  code?: number;
  status?: number;
  data?: JinaSearchItem[];
}

/**
 * Jina AI Reader & Search Provider (https://s.jina.ai)
 * 专为大模型设计的高质量开源/开放语义搜索引擎，支持在 Cloudflare Edge 环境下免 Key / 带 Key 直接调用，
 * 深刻理解游戏黑话、网络热梗与长尾概念，并返回清洗后的纯净 Markdown / JSON 证据。
 */
export class JinaWebSearchProvider extends BaseWebSearchProvider {
  readonly id = "jina";
  readonly name = "Jina AI Search";

  available(env?: Record<string, unknown>): boolean {
    return (
      (typeof env?.JINA_API_KEY === "string" && env.JINA_API_KEY.length > 0) ||
      env?.DSH_WEB_SEARCH_PROVIDER === "jina" ||
      env?.ENABLE_JINA === "true"
    );
  }

  async search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    env?: Record<string, unknown>,
  ): Promise<WebSearchResult[]> {
    const queryStr = this.resolveQueryString(request.query);
    if (!queryStr) {
      return [];
    }

    const apiKey = request.apiKey || (env?.JINA_API_KEY as string | undefined);
    const maxResults = request.maxResults ?? 5;

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Retain-Images": "none",
        "User-Agent": "YachiyoChat-EdgeSearch/1.0",
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const url = `https://s.jina.ai/${encodeURIComponent(queryStr)}`;
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

      const body = (await response.json()) as JinaSearchResponse;
      const items = Array.isArray(body.data) ? body.data : [];

      const rawResults = items.map((item) =>
        this.formatResultItem({
          title: item.title,
          url: item.url,
          snippet: item.description || item.content || item.title,
          publishedAt: item.publishedTime,
        }),
      );

      return this.sieveAndLimit(rawResults, queryStr, request.locale, maxResults);
    } catch {
      return [];
    }
  }
}
