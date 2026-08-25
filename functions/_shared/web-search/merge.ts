import type { WebSearchResult } from "./types";

/** 智能搜索模式：双市场合并去重后的结果上限 */
const maximumSmartResults = 10;
/** 每个可注册域名最多保留的结果数，避免同站点堆积压窄信息面 */
const maximumResultsPerDomain = 2;

/** 智能搜索：双市场结果按 URL 去重合并，本地市场在前（保持本地化优先级），上限 10 条 */
export function mergeSearchResults(
  primary: readonly WebSearchResult[],
  secondary: readonly WebSearchResult[],
): WebSearchResult[] {
  const seen = new Set<string>();
  const merged: WebSearchResult[] = [];
  for (const result of [...primary, ...secondary]) {
    if (merged.length >= maximumSmartResults) break;
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    merged.push(result);
  }
  return merged;
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
