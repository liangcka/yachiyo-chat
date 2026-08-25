import type { ChatLocale } from "../validation";
import { browserUserAgent, fetchWithTimeout, localeMarket } from "./http";
import { extractPageText } from "./page-text";
import { truncateUnicode } from "./text";
import type { WebSearchResult } from "./types";

/** 页面正文抓取：仅对排名最前的若干条执行 */
const maximumPageFetches = 3;
const pageFetchTimeoutMs = 5_000;
const maximumContentCharacters = 1_500;
/** 原始 HTML 超过此长度先截断，保护 workerd CPU（正文大多在前部） */
const maximumHtmlCharacters = 300_000;

/**
 * 单条结果的页面正文抓取：仅接受 HTML 响应。
 * 5 秒超时、联动客户端断开；提取文本必须比 RSS 摘要更长才有信息量，
 * 否则保留摘要。任何失败（非 200、非 HTML、反爬、超时、网络错误）静默返回原结果。
 */
async function fetchPageContent(
  result: WebSearchResult,
  locale: ChatLocale,
  signal: AbortSignal | undefined,
): Promise<WebSearchResult> {
  try {
    const response = await fetchWithTimeout(
      result.url,
      {
        headers: {
          accept: "text/html,application/xhtml+xml,*/*",
          "accept-language": localeMarket[locale].acceptLanguage,
          "user-agent": browserUserAgent,
        },
      },
      pageFetchTimeoutMs,
      signal,
    );
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.includes("html")) {
      await response.body?.cancel().catch(() => undefined);
      return result;
    }
    const html = (await response.text()).slice(0, maximumHtmlCharacters);
    const text = extractPageText(html);
    return text.length > result.snippet.length
      ? { ...result, content: truncateUnicode(text, maximumContentCharacters) }
      : result;
  } catch {
    return result;
  }
}

/**
 * 页面正文增强：对排名最前的 3 条结果并行抓取页面正文（各 5 秒超时），
 * 其余结果保持摘要。抓取互不阻塞、失败静默降级，结果顺序保持不变。
 */
export async function enrichWithPageContent(
  results: readonly WebSearchResult[],
  locale: ChatLocale,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const targets = results.slice(0, maximumPageFetches);
  if (targets.length === 0) {
    return [...results];
  }
  const enriched = await Promise.all(
    targets.map((result) => fetchPageContent(result, locale, signal)),
  );
  return [...enriched, ...results.slice(maximumPageFetches)];
}
