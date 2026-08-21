import type { ChatLocale, ClientChatRequest, ClientHistoryMessage } from "./validation";

/** 单条网页搜索结果（来自必应 RSS 的一个 item） */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** 发布日期（YYYY-MM-DD，UTC）；RSS 缺失或解析失败时省略 */
  publishedAt?: string;
}

/**
 * 服务端校验后才允许附加的聊天请求类型。
 * searchResults 不在校验白名单内，客户端 JSON 无法伪造注入。
 */
export type EnrichedChatRequest = ClientChatRequest & {
  searchResults?: readonly WebSearchResult[];
};

const maximumQueryCharacters = 100;
const maximumResults = 5;
/** 智能搜索模式：双市场合并去重后的结果上限 */
const maximumSmartResults = 10;
const maximumTitleCharacters = 120;
const maximumSnippetCharacters = 300;
const maximumUrlCharacters = 512;
const searchTimeoutMs = 8_000;
/** 智能搜索国际路的近因时间过滤（天）：排除过时内容 */
const smartRecencyDays = 30;
const bingSearchOrigin = "https://www.bing.com/search";
const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** 按界面语言锁定必应市场与请求语言，避免出口网络被误判为其他市场（如日语） */
const localeMarket: Record<ChatLocale, { mkt: string; setlang: string; acceptLanguage: string }> = {
  "zh-CN": { mkt: "zh-CN", setlang: "zh-hans", acceptLanguage: "zh-CN,zh;q=0.9" },
  "ja-JP": { mkt: "ja-JP", setlang: "ja", acceptLanguage: "ja-JP,ja;q=0.9" },
};

/** 智能搜索的国际路市场：中文内容池索引滞后（SEO 镜像站多），en-US 市场能命中权威新信息 */
const internationalMarket = {
  mkt: "en-US",
  setlang: "en",
  acceptLanguage: "en-US,en;q=0.9",
} as const;

/** 按 Unicode 码点截断，避免切开代理对 */
function truncateUnicode(value: string, maximum: number): string {
  return [...value].slice(0, maximum).join("");
}

/**
 * 查询词噪声词表：疑问/请求短语、时间填充词、语气词与结构助词、纠错反驳用语、日语助词。
 * 实测必应对口语化整句（含"今天/最近/的/怎么样"等）极易跑偏（返回黄历/日历/百科页），
 * 去除后可把消息压缩为高相关关键词（如"今天上海的天气怎么样"→"上海天气"）。
 * 注意：仅收录经实测必要且不易破坏词内字符的词，按长度降序应用。
 */
const queryNoiseWords: readonly string[] = [
  "怎么样", "怎样", "怎么", "如何", "为什么", "有什么", "是什么", "有没有", "是不是",
  "在哪里", "在哪", "哪些", "什么", "哪里", "哪儿", "多少",
  "教えて", "知りたい", "ください", "です", "ます",
  "告诉我", "帮我查", "查一下", "查查", "搜一下", "搜索一下", "搜索", "请问", "帮我", "一下",
  "今天", "今日", "明天", "后天", "昨天", "现在", "現在", "目前", "当前", "最近", "最新",
  "说错了", "怎么会", "不对", "不是", "错了", "搞错", "其实", "应该", "已经", "明明", "乱说", "胡说",
  "吗", "呢", "啊", "呀", "哦", "吧", "嘛", "么", "的",
  "は", "が", "を", "で", "へ",
].sort((a, b) => b.length - a.length);

/**
 * 纯寒暄问候不作为搜索上文（如首条消息"你好"之后再提问，
 * 组合"上海天气 你好"没有意义，直接只用当前问题）。
 */
const greetingKeywords: ReadonlySet<string> = new Set([
  "你好", "您好", "嗨", "哈喽", "哈罗", "早上好", "中午好", "下午好", "晚上好", "晚安",
  "hello", "hi", "hey",
  "こんにちは", "こんばんは", "おはよう", "おやすみ",
]);

/** 去除噪声词、标点，并合并中日文之间的空格（"上海 天气"→"上海天气"）；数字间的小数点保留（如 3.7） */
function stripQueryNoise(value: string): string {
  let result = value;
  for (const word of queryNoiseWords) {
    result = result.split(word).join("");
  }
  return result
    .replace(/[\p{P}\p{S}]+/gu, (match, offset: number, whole: string) => {
      if (match === "." || match === "．") {
        const before = whole.charCodeAt(offset - 1);
        const after = whole.charCodeAt(offset + 1);
        if (before >= 0x30 && before <= 0x39 && after >= 0x30 && after <= 0x39) {
          return ".";
        }
      }
      return " ";
    })
    .replace(
      /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]) +(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
      "",
    )
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * 客户端注入的技能指令与前情摘要消息都以"【"开头，不是真实提问，
 * 不能作为搜索上文（避免把整段技能指令拼进查询词）。
 */
function isInjectedContextMessage(text: string): boolean {
  return text.startsWith("【");
}

/**
 * 以最后一条 user 消息文本构造搜索词：
 * trim、把换行/制表符压成空格、按 Unicode 字符截断到 100，再做噪声词归一化。
 * 追问/纠错类消息（如"不对，3.7 flash已经出来了"、"那北京呢"）单独作为查询词缺乏主题，
 * 会拼上上一轮真实提问的关键词作为上下文（跳过问候语、客户端注入消息与重复内容）。
 * 归一化与上文均为空时回退原文；最后一条 user 消息为空文本（纯图片）返回 null。
 */
export function buildSearchQuery(messages: readonly ClientHistoryMessage[]): string | null {
  let lastText: string | null = null;
  let previousText: string | null = null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "user") {
      continue;
    }
    const normalized = message.text.trim().replace(/[\r\n\t]/gu, " ");
    if (lastText === null) {
      if (normalized.length === 0) {
        return null;
      }
      lastText = normalized;
      continue;
    }
    if (normalized.length === 0 || isInjectedContextMessage(normalized)) {
      continue;
    }
    previousText = normalized;
    break;
  }

  if (lastText === null) {
    return null;
  }

  const currentKeywords = stripQueryNoise(truncateUnicode(lastText, maximumQueryCharacters));
  const previousKeywords =
    previousText === null ? null : stripQueryNoise(truncateUnicode(previousText, maximumQueryCharacters));
  // 上文需非空、非问候、且与当前关键词不重复才有价值
  const usablePrevious =
    previousKeywords !== null &&
    previousKeywords.length > 0 &&
    !greetingKeywords.has(previousKeywords.toLowerCase()) &&
    previousKeywords !== currentKeywords
      ? previousKeywords
      : null;

  if (currentKeywords.length > 0) {
    return usablePrevious === null
      ? currentKeywords
      : truncateUnicode(`${currentKeywords} ${usablePrevious}`, maximumQueryCharacters);
  }
  const fallback = truncateUnicode(lastText, maximumQueryCharacters);
  return usablePrevious === null
    ? fallback
    : truncateUnicode(`${fallback} ${usablePrevious}`, maximumQueryCharacters);
}

function codePointText(codePoint: number): string {
  return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : "";
}

/** 解码常见命名实体与十进制/十六进制数字实体；&amp; 必须放在最后，避免二次解码 */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) =>
      codePointText(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_match, decimal: string) =>
      codePointText(Number.parseInt(decimal, 10)),
    )
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

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

/**
 * 纯函数：解析必应 RSS XML。
 * 提取每个 item 的 title/link/description/pubDate，实体解码后裁剪长度
 * （title ≤120、snippet ≤300、url ≤512，均按 Unicode 字符），
 * 仅保留 http/https 链接，不完整或非法条目整体丢弃，最多取前 5 条。
 */
export function parseBingRss(xml: string): WebSearchResult[] {
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
    if (!/^https?:\/\//u.test(url)) {
      continue;
    }

    const rawPubDate = extractPubDate(item);
    const publishedAt =
      rawPubDate === null ? undefined : parseRssPubDate(decodeHtmlEntities(rawPubDate));

    results.push({
      title: truncateUnicode(decodeHtmlEntities(rawTitle).trim(), maximumTitleCharacters),
      url,
      snippet: truncateUnicode(decodeHtmlEntities(rawSnippet).trim(), maximumSnippetCharacters),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    });
  }

  return results;
}

/** 智能搜索：双市场结果按 URL 去重合并，本地市场在前（保持本地化优先级），上限 10 条 */
function mergeSearchResults(
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

interface BingMarket {
  readonly mkt: string;
  readonly setlang: string;
  readonly acceptLanguage: string;
}

/**
 * 单路必应 RSS 请求（无需 Key）。
 * 内部 8 秒超时；传入的 signal 联动客户端断开。
 * recencyDays 用于国际路的近因过滤（qft=interval）。
 * 任何失败（非 200、无 body、解析异常、空结果、超时、外部中断）一律静默返回 []，绝不向上抛。
 */
async function fetchBingRss(
  query: string,
  market: BingMarket,
  signal: AbortSignal | undefined,
  recencyDays?: number,
): Promise<WebSearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), searchTimeoutMs);
  const forwardAbort = () => controller.abort();

  if (signal !== undefined && signal.aborted) {
    controller.abort();
  }
  signal?.addEventListener("abort", forwardAbort);

  const recencyParameter =
    recencyDays === undefined ? "" : `&qft=${encodeURIComponent(`interval="${recencyDays}"`)}`;

  try {
    const response = await fetch(
      `${bingSearchOrigin}?q=${encodeURIComponent(query)}&format=rss&mkt=${market.mkt}&setlang=${market.setlang}${recencyParameter}`,
      {
        headers: {
          accept: "application/rss+xml, application/xml, text/xml, */*",
          "accept-language": market.acceptLanguage,
          "user-agent": browserUserAgent,
        },
        signal: controller.signal,
      },
    );
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return [];
    }
    if (response.body === null) {
      return [];
    }
    return parseBingRss(await response.text());
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * 服务端必应 RSS 搜索（无需 Key）。
 * locale 用于锁定必应市场参数（mkt/setlang）与 Accept-Language，缺省 zh-CN。
 * smart=false：仅 locale 市场（现状行为）。
 * smart=true：双路并行——locale 市场无时间过滤 + en-US 市场限近 30 天，
 * 解决中文内容池索引滞后（如新模型发布信息缺失）；两路各自 8 秒超时、互不阻塞，
 * 失败静默降级；合并按 URL 去重、本地市场在前，上限 10 条。
 */
export async function searchWeb(
  query: string,
  locale: ChatLocale = "zh-CN",
  signal?: AbortSignal,
  smart = false,
): Promise<WebSearchResult[]> {
  if (!smart) {
    return fetchBingRss(query, localeMarket[locale], signal);
  }

  const [local, international] = await Promise.all([
    fetchBingRss(query, localeMarket[locale], signal),
    fetchBingRss(query, internationalMarket, signal, smartRecencyDays),
  ]);
  return mergeSearchResults(local, international);
}
