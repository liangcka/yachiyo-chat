import { fetchWithTimeout, browserUserAgent } from "../http";
import { mergeRoundRobin } from "../merge";
import { decodeHtmlEntities } from "../text";
import type { WebSearchResult } from "../types";
import { BaseWebSearchProvider, DEFAULT_SEARCH_TIMEOUT_MS } from "./base";
import type { WebSearchRequest } from "./types";

/**
 * DuckDuckGo 免 Key 网页搜索提供商：
 * 抓取 DuckDuckGo HTML 页面并解析真实搜索结果（支持百度百科、知乎、B站、Steam、各大新闻媒体）。
 */
export class DuckDuckGoWebSearchProvider extends BaseWebSearchProvider {
  readonly id = "duckduckgo";
  readonly name = "DuckDuckGo Web Search";

  available(env?: Record<string, unknown>): boolean {
    return env?.DSH_WEB_SEARCH_PROVIDER === "duckduckgo" || env?.ENABLE_DUCKDUCKGO === "true";
  }

  async search(
    request: WebSearchRequest,
    signal?: AbortSignal,
  ): Promise<WebSearchResult[]> {
    const queries = this.normalizeQueries(request.query);
    if (queries.length === 0) {
      return [];
    }

    const locale = request.locale ?? "zh-CN";
    const maxResults = request.maxResults ?? 5;

    if (queries.length === 1 && queries[0] !== undefined) {
      return this.fetchSingleQuery(queries[0], locale, maxResults, signal);
    }

    const lists = await Promise.all(
      queries.map((q) => this.fetchSingleQuery(q, locale, maxResults, signal)),
    );
    const merged = mergeRoundRobin(lists, maxResults);
    return this.sieveAndLimit(merged, queries.join(" "), locale, maxResults);
  }

  private async fetchSingleQuery(
    queryStr: string,
    locale: "zh-CN" | "ja-JP",
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<WebSearchResult[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryStr)}`;
      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            "User-Agent": browserUserAgent,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": locale === "ja-JP" ? "ja-JP,ja;q=0.9" : "zh-CN,zh;q=0.9,en;q=0.8",
          },
        },
        DEFAULT_SEARCH_TIMEOUT_MS,
        signal,
      );

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      const titleMatches = [
        ...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
      ];
      const snippetMatches = [
        ...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g),
      ];

      const rawResults: (WebSearchResult | null)[] = [];
      for (let i = 0; i < Math.min(maxResults * 2, titleMatches.length); i++) {
        const titleMatch = titleMatches[i];
        if (!titleMatch) continue;

        const rawUrl = titleMatch[1];
        const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
        const finalUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]) : rawUrl;

        const rawTitle = titleMatch[2].replace(/<[^>]+>/g, "").trim();
        const rawSnippet = snippetMatches[i]
          ? snippetMatches[i][1].replace(/<[^>]+>/g, "").trim()
          : rawTitle;

        rawResults.push(
          this.formatResultItem({
            title: decodeHtmlEntities(rawTitle),
            url: finalUrl,
            snippet: decodeHtmlEntities(rawSnippet),
          }),
        );
      }

      return this.sieveAndLimit(rawResults, queryStr, locale, maxResults);
    } catch {
      return [];
    }
  }
}
