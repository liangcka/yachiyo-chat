import {
  browserUserAgent,
  fetchWithTimeout,
  type BingMarket,
} from "./http";
import { decodeHtmlEntities, truncateUnicode } from "./text";
import type { WebSearchResult } from "./types";

const maximumResults = 5;
const maximumTitleCharacters = 120;
const maximumSnippetCharacters = 300;
const maximumUrlCharacters = 512;
const searchTimeoutMs = 8_000;
const bingSearchOrigin = "https://www.bing.com/search";

function extractTagText(item: string, tag: "title" | "link" | "description"): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "u").exec(item);
  const content = match?.[1];
  return content === undefined ? null : content;
}

function extractPubDate(item: string): string | null {
  const match = /<pubDate>([\s\S]*?)<\/pubDate>/u.exec(item);
  return match?.[1] ?? null;
}

/** 日期统一输出 YYYY-MM-DD（UTC） */
function formatUtcDate(date: Date): string {
  const year = `${date.getUTCFullYear()}`.padStart(4, "0");
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 解析必应 RSS pubDate 为 YYYY-MM-DD。
 * 英文 RFC 822（"Fri, 21 Aug 2026 06:19:00 GMT"）直接走 Date；
 * 中文本地化格式（"周五, 21 8月 2026 08:42:00 GMT"）Date 解析失败，用正则提取字段。
 * 任何失败返回 undefined（结果照常保留，只是不带日期）。
 */
function parseRssPubDate(value: string): string | undefined {
  const trimmed = value.trim();
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return formatUtcDate(direct);
  }
  const match = /(\d{1,2})\s*(\d{1,2})月\s*(\d{4})\s+\d{1,2}:\d{2}:\d{2}/u.exec(trimmed);
  if (match === null) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== year) return undefined;
  return formatUtcDate(date);
}

/** 过滤低质/目录广告/无用登录页 */
function isLowQualitySearchResult(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (
      host.endsWith(".zikao.com.cn") ||
      host === "zikao.com.cn" ||
      host.endsWith(".58.com") ||
      host.endsWith(".baixing.com")
    ) {
      return true;
    }
    if (parsed.pathname === "/login" || parsed.pathname === "/signin") {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

/**
 * 校验搜索结果相关度：
 * 1. 排除低质、外文SEO垃圾域名与登录页；
 * 2. 中文市场下排除无汉字且无英文字符的纯外文垃圾。
 */
export function isRelevantSearchResult(
  result: WebSearchResult,
  _query?: string,
  marketLang?: string,
): boolean {
  const title = result.title.toLowerCase();
  const snippet = (result.snippet ?? "").toLowerCase();
  const combined = `${title} ${snippet}`;

  try {
    const parsed = new URL(result.url);
    const host = parsed.hostname.toLowerCase();
    if (
      host.endsWith(".vn") ||
      host.endsWith(".ru") ||
      host.endsWith(".trunsweb.com.tw") ||
      host.endsWith(".zikao.com.cn") ||
      host === "zikao.com.cn" ||
      host.endsWith(".58.com") ||
      host.endsWith(".baixing.com") ||
      host === "cellphones.com.vn" ||
      host === "dpg.danawa.com" ||
      host === "y8.com" ||
      host.endsWith(".y8.com")
    ) {
      return false;
    }
    if (parsed.pathname === "/login" || parsed.pathname === "/signin") {
      return false;
    }
  } catch {
    return false;
  }

  if (marketLang?.startsWith("zh")) {
    if (!/\p{Script=Han}/u.test(combined) && !/[a-z]/i.test(combined)) {
      return false;
    }
  }

  return true;
}

/**
 * 纯函数：解析必应 RSS XML。
 * 提取每个 item 的 title/link/description/pubDate，实体解码后裁剪长度
 * （title ≤120、snippet ≤300、url ≤512，均按 Unicode 字符），
 * 仅保留 http/https 链接，不完整或非法条目整体丢弃，最多取前 5 条。
 */
export function parseBingRss(xml: string, query?: string, marketLang?: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/gu) ?? [];

  for (const item of items) {
    if (results.length >= maximumResults) {
      break;
    }
    const rawTitle = extractTagText(item, "title");
    const rawLink = extractTagText(item, "link");
    const rawSnippet = extractTagText(item, "description");
    if (rawTitle === null || rawLink === null || rawSnippet === null) {
      continue;
    }

    const url = truncateUnicode(decodeHtmlEntities(rawLink).trim(), maximumUrlCharacters);
    if (!/^https?:\/\//u.test(url) || isLowQualitySearchResult(url)) {
      continue;
    }

    const rawPubDate = extractPubDate(item);
    const publishedAt =
      rawPubDate === null ? undefined : parseRssPubDate(decodeHtmlEntities(rawPubDate));

    const resultItem: WebSearchResult = {
      title: truncateUnicode(decodeHtmlEntities(rawTitle).trim(), maximumTitleCharacters),
      url,
      snippet: truncateUnicode(decodeHtmlEntities(rawSnippet).trim(), maximumSnippetCharacters),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    };

    if (!isRelevantSearchResult(resultItem, query, marketLang)) {
      continue;
    }

    results.push(resultItem);
  }

  return results;
}

/**
 * 单路必应 RSS 请求（无需 Key）。
 * 内部 8 秒超时；传入的 signal 联动客户端断开。
 * recencyDays 用于国际路的近因过滤（qft=interval）。
 * 任何失败（非 200、无 body、解析异常、空结果、超时、外部中断）一律静默返回 []，绝不向上抛。
 */
export async function fetchBingRss(
  query: string,
  market: BingMarket,
  signal: AbortSignal | undefined,
  recencyDays?: number,
): Promise<WebSearchResult[]> {
  const recencyParameter =
    recencyDays === undefined ? "" : `&qft=${encodeURIComponent(`interval="${recencyDays}"`)}`;

  try {
    const response = await fetchWithTimeout(
      `${bingSearchOrigin}?q=${encodeURIComponent(query)}&format=rss&mkt=${market.mkt}&setlang=${market.setlang}${recencyParameter}`,
      {
        headers: {
          accept: "application/rss+xml, application/xml, text/xml, */*",
          "accept-language": market.acceptLanguage,
          "user-agent": browserUserAgent,
        },
      },
      searchTimeoutMs,
      signal,
    );
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return [];
    }
    if (response.body === null) {
      return [];
    }
    return parseBingRss(await response.text(), query, market.setlang);
  } catch {
    return [];
  }
}
