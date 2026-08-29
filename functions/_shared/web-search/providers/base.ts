import { decodeHtmlEntities, truncateUnicode } from "../text";
import type { WebSearchResult } from "../types";
import { sieveSearchResults } from "./search-sieve";
import type { WebSearchProvider, WebSearchRequest } from "./types";

export const DEFAULT_SEARCH_TIMEOUT_MS = 8_000;
export const MAX_TITLE_CHARACTERS = 120;
export const MAX_SNIPPET_CHARACTERS = 300;
export const MAX_URL_CHARACTERS = 512;

/**
 * 搜索引擎 Provider 抽象基类：
 * 提供通用的查询词归一化、结果项格式化与清洗、Unicode 截断及异常兜底能力。
 */
export abstract class BaseWebSearchProvider implements WebSearchProvider {
  abstract readonly id: string;
  abstract readonly name: string;

  /** 快速可用性检测 */
  abstract available(env?: Record<string, unknown>): boolean;

  /** 抽象搜索实现 */
  abstract search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    env?: Record<string, unknown>,
  ): Promise<WebSearchResult[]>;

  /**
   * 将 string | readonly string[] 标准化为非空去重查询词列表
   */
  protected normalizeQueries(query: string | readonly string[]): string[] {
    const rawList = typeof query === "string" ? [query] : query;
    return [...new Set(rawList.map((q) => q.trim()).filter((q) => q.length > 0))];
  }

  /**
   * 获取合并后的单一主查询字符串
   */
  protected resolveQueryString(query: string | readonly string[]): string {
    const list = this.normalizeQueries(query);
    return list.join(" ");
  }

  /**
   * 格式化并验证单条结果项（严格检查 URL 合法性与长度裁剪）
   */
  protected formatResultItem(item: {
    title?: string;
    url?: string;
    snippet?: string;
    publishedAt?: string;
  }): WebSearchResult | null {
    if (!item.url) {
      return null;
    }
    const cleanUrl = item.url.trim();
    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      return null;
    }

    const titleText = decodeHtmlEntities(item.title || cleanUrl).trim();
    const snippetText = decodeHtmlEntities(item.snippet || item.title || "").trim();

    let publishedAt: string | undefined = undefined;
    if (item.publishedAt && /^\d{4}-\d{2}-\d{2}/.test(item.publishedAt)) {
      publishedAt = item.publishedAt.slice(0, 10);
    }

    return {
      title: truncateUnicode(titleText, MAX_TITLE_CHARACTERS),
      url: truncateUnicode(cleanUrl, MAX_URL_CHARACTERS),
      snippet: truncateUnicode(snippetText, MAX_SNIPPET_CHARACTERS),
      ...(publishedAt ? { publishedAt } : {}),
    };
  }

  /**
   * 通过 SearchSieve 过滤结果列表并截取最大结果数
   */
  protected sieveAndLimit(
    results: readonly (WebSearchResult | null)[],
    query: string,
    locale?: WebSearchRequest["locale"],
    maxResults = 5,
  ): WebSearchResult[] {
    const valid = results.filter((r): r is WebSearchResult => r !== null);
    return sieveSearchResults(valid, query, locale).slice(0, maxResults);
  }
}
