import { fetchBingRss } from "../bing-rss";
import { type BingMarket, internationalMarket, localeMarket } from "../http";
import {
  dedupeByDomain,
  maximumSmartResults,
  maximumStandardResults,
  mergeRoundRobin,
} from "../merge";
import type { WebSearchResult } from "../types";
import { BaseWebSearchProvider } from "./base";
import { sieveSearchResults } from "./search-sieve";
import type { WebSearchRequest } from "./types";

const smartRecencyDays = 30;

/**
 * DSH 风格的免 Key 兜底聚合提供商（基于经过 SearchSieve 过滤的多路 Bing 搜索与 Round-Robin 算法）
 * 包含智能市场级联降级：当本地市场（如 zh-CN）返回结果且全部因敏感词/时政置顶被 SearchSieve 过滤时，自动无缝降级至全球索引市场。
 */
export class BingWebSearchProvider extends BaseWebSearchProvider {
  readonly id = "bing";
  readonly name = "Bing Multi-Route Search";

  available(): boolean {
    return true; // 始终可用作为兜底
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
    const smart = request.smart ?? false;
    const globalMarket: BingMarket = {
      mkt: "en-US",
      setlang: locale === "ja-JP" ? "ja" : "zh-hans",
      acceptLanguage: localeMarket[locale].acceptLanguage,
    };

    if (!smart) {
      if (queries.length === 1 && queries[0] !== undefined) {
        const results = await fetchBingRss(queries[0], localeMarket[locale], signal);
        const filtered = dedupeByDomain(sieveSearchResults(results, queries[0], locale));
        if (filtered.length > 0) {
          return filtered;
        }
        // 本地市场有返回但被全部过滤（如敏感词/政策置顶），且未被中断时，降级至全球索引
        if (results.length > 0 && !signal?.aborted) {
          const fallbackResults = await fetchBingRss(queries[0], globalMarket, signal);
          return dedupeByDomain(sieveSearchResults(fallbackResults, queries[0], locale));
        }
        return [];
      }

      const lists = await Promise.all(
        queries.map((q) => fetchBingRss(q, localeMarket[locale], signal)),
      );
      const rawTotal = lists.reduce((sum, l) => sum + l.length, 0);
      const merged = mergeRoundRobin(lists, request.maxResults ?? maximumStandardResults);
      const filtered = dedupeByDomain(sieveSearchResults(merged, queries.join(" "), locale));
      if (filtered.length > 0) {
        return filtered;
      }
      if (rawTotal > 0 && !signal?.aborted) {
        const fallbackLists = await Promise.all(
          queries.map((q) => fetchBingRss(q, globalMarket, signal)),
        );
        const fallbackMerged = mergeRoundRobin(fallbackLists, request.maxResults ?? maximumStandardResults);
        return dedupeByDomain(sieveSearchResults(fallbackMerged, queries.join(" "), locale));
      }
      return [];
    }

    const lists: WebSearchResult[][] = [];
    for (const q of queries) {
      const [localResults, intlResults] = await Promise.all([
        fetchBingRss(q, localeMarket[locale], signal),
        fetchBingRss(q, internationalMarket, signal, smartRecencyDays),
      ]);
      const filteredLocal = sieveSearchResults(localResults, q, locale);
      const filteredIntl = sieveSearchResults(intlResults, q, "intl");

      if (filteredLocal.length > 0 || filteredIntl.length > 0) {
        lists.push(filteredLocal, filteredIntl);
      } else if (localResults.length > 0 && !signal?.aborted) {
        // 本地有返回但被全部过滤时，尝试全球通用索引
        const globalResults = await fetchBingRss(q, globalMarket, signal);
        lists.push(sieveSearchResults(globalResults, q, locale));
      }
    }
    const merged = mergeRoundRobin(lists, request.maxResults ?? maximumSmartResults);
    return dedupeByDomain(merged);
  }
}
