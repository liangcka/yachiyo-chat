import type { ChatLocale } from "../validation";
import { fetchBingRss, parseBingRss } from "./bing-rss";
import { internationalMarket, localeMarket } from "./http";
import { shouldSearchWeb } from "./intent";
import { dedupeByDomain, mergeSearchResults } from "./merge";
import { enrichWithPageContent } from "./page-content";
import { extractPageText } from "./page-text";
import { buildSearchQuery } from "./query";
import type { EnrichedChatRequest, WebSearchResult } from "./types";

/** 智能搜索国际路的近因时间过滤（天）：排除过时内容 */
const smartRecencyDays = 30;

/**
 * 服务端必应 RSS 搜索（无需 Key）。
 * locale 用于锁定必应市场参数（mkt/setlang）与 Accept-Language，缺省 zh-CN。
 * smart=false：仅 locale 市场（现状行为）。
 * smart=true：双路并行——locale 市场无时间过滤 + en-US 市场限近 30 天，
 * 解决中文内容池索引滞后（如新模型发布信息缺失）；两路各自 8 秒超时、互不阻塞，
 * 失败静默降级；合并按 URL 去重、本地市场在前，上限 10 条。
 * 两种模式的结果最后均做同域名去重（每域名最多 2 条）。
 */
export async function searchWeb(
  query: string,
  locale: ChatLocale = "zh-CN",
  signal?: AbortSignal,
  smart = false,
): Promise<WebSearchResult[]> {
  if (!smart) {
    return dedupeByDomain(await fetchBingRss(query, localeMarket[locale], signal));
  }

  const [local, international] = await Promise.all([
    fetchBingRss(query, localeMarket[locale], signal),
    fetchBingRss(query, internationalMarket, signal, smartRecencyDays),
  ]);
  return dedupeByDomain(mergeSearchResults(local, international));
}

export { buildSearchQuery, shouldSearchWeb };
export { parseBingRss };
export { extractPageText };
export { enrichWithPageContent };
export type { EnrichedChatRequest, WebSearchResult };
