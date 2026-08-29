import type { WebSearchResult } from "./types";

/** 智能搜索模式：双市场/多Query合并去重后的结果上限 */
export const maximumSmartResults = 10;
/** 普通单市场搜索模式：合并去重后的结果上限 */
export const maximumStandardResults = 5;
/** 每个可注册域名最多保留的结果数，避免同站点堆积压窄信息面 */
const maximumResultsPerDomain = 2;

/**
 * Round-Robin 轮询交错合并算法（借鉴 DeepSeek Harness）：
 * 从多个 Query / 市场的搜索结果列表中，按排名（Rank 0, 1, 2...）依次轮流各取 1 条，
 * 全局按 URL 严格去重，直到填满 maxResults 条数上限。
 */
export function mergeRoundRobin(
  resultLists: readonly (readonly WebSearchResult[])[],
  maxResults: number = maximumSmartResults,
): WebSearchResult[] {
  const seen = new Set<string>();
  const merged: WebSearchResult[] = [];
  if (resultLists.length === 0 || maxResults <= 0) {
    return merged;
  }

  const maxRank = Math.max(0, ...resultLists.map((list) => list.length));
  for (let rank = 0; rank < maxRank; rank += 1) {
    for (const list of resultLists) {
      if (merged.length >= maxResults) {
        return merged;
      }
      const item = list[rank];
      if (item === undefined) {
        continue;
      }
      if (seen.has(item.url)) {
        continue;
      }
      seen.add(item.url);
      merged.push(item);
    }
  }
  return merged;
}

/** 智能搜索：双市场结果按 Round-Robin 轮询交错合并，上限 10 条（保持导出兼容） */
export function mergeSearchResults(
  primary: readonly WebSearchResult[],
  secondary: readonly WebSearchResult[],
): WebSearchResult[] {
  return mergeRoundRobin([primary, secondary], maximumSmartResults);
}

/** 常见二级后缀（co.jp / com.cn 等）：可注册域名需取三段 */
const secondLevelSuffixes: ReadonlySet<string> = new Set([
  "co", "com", "net", "org", "gov", "edu", "ac",
]);

/** 提取 URL 的可注册域名（如 a.b.example.co.jp → example.co.jp）；解析失败返回 null */
export function registrableDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const labels = hostname.split(".");
    if (labels.length <= 2) {
      return hostname;
    }
    const secondLevel = labels[labels.length - 2];
    return secondLevelSuffixes.has(secondLevel) ? labels.slice(-3).join(".") : labels.slice(-2).join(".");
  } catch {
    return null;
  }
}

/** 同一可注册域名最多保留 2 条，避免单一站点堆积压窄信息面（保持原排序） */
export function dedupeByDomain(results: readonly WebSearchResult[]): WebSearchResult[] {
  const counts = new Map<string, number>();
  const kept: WebSearchResult[] = [];
  for (const result of results) {
    const domain = registrableDomain(result.url);
    if (domain === null) {
      kept.push(result);
      continue;
    }
    const count = counts.get(domain) ?? 0;
    if (count >= maximumResultsPerDomain) {
      continue;
    }
    counts.set(domain, count + 1);
    kept.push(result);
  }
  return kept;
}
