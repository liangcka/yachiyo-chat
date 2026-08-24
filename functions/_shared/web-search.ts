import type { ChatLocale, ClientChatRequest, ClientHistoryMessage } from "./validation";

/** 单条网页搜索结果（来自必应 RSS 的一个 item） */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** 发布日期（YYYY-MM-DD，UTC）；RSS 缺失或解析失败时省略 */
  publishedAt?: string;
  /** 页面正文摘录（抓取成功且比摘要更有信息量时存在，替代 snippet 注入） */
  content?: string;
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
/** 每个可注册域名最多保留的结果数，避免同站点堆积压窄信息面 */
const maximumResultsPerDomain = 2;
const maximumTitleCharacters = 120;
const maximumSnippetCharacters = 300;
const maximumUrlCharacters = 512;
const searchTimeoutMs = 8_000;
/** 智能搜索国际路的近因时间过滤（天）：排除过时内容 */
const smartRecencyDays = 30;
/** 页面正文抓取：仅对排名最前的若干条执行 */
const maximumPageFetches = 3;
const pageFetchTimeoutMs = 5_000;
const maximumContentCharacters = 1_500;
/** 原始 HTML 超过此长度先截断，保护 workerd CPU（正文大多在前部） */
const maximumHtmlCharacters = 300_000;
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

/**
 * 闲聊回应词表：整条消息（去标点、小写化后）仅由这些词组合时视为无信息量闲聊，
 * 跳过联网搜索。含问候、应答、感谢、告别、情绪回应、对话流程控制与语气尾词；
 * 单字词可重复匹配，覆盖"哈哈哈""嗯嗯嗯"等叠音。
 * 注意：仅收录整词匹配安全的词，任何含实质名词/疑问/时效词的句子都不会命中。
 */
const chatReplyWords: readonly string[] = [
  ...greetingKeywords,
  // 应答确认
  "好的", "好滴", "好呀", "好吧", "好嘞", "好耶", "可以的", "没问题", "没错", "是的", "确实",
  "嗯", "哦", "噢", "唉", "欸", "诶", "哼", "对", "ok",
  // 感谢与告别
  "谢谢", "多谢", "感谢", "thx", "ありがとう", "拜拜", "再见", "またね",
  // 情绪与认知回应
  "太好了", "原来如此", "原来是这样", "我知道了", "我明白了", "我懂了", "我了解了",
  "明白了", "懂了", "知道了", "涨知识了", "学到了", "厉害", "不错", "挺好", "真好",
  "哈", "嘿", "呵", "呜", "耶", "哇",
  // 对话流程控制
  "继续", "继续说", "接着说", "说下去", "然后呢", "再说一遍", "重复一下", "别说了",
  // 语气尾词
  "呀", "啊", "呢", "啦", "嘛", "哟", "嘞",
  // 日语回应
  "なるほど", "わかった", "そうだね",
].sort((a, b) => b.length - a.length);

/** 纯闲聊消息匹配：整条消息去标点后可完全由闲聊词序列组成 */
const chatReplyPattern = new RegExp(`^(?:${chatReplyWords.join("|")})+$`, "u");

/**
 * 联网搜索意图门控：判断最新 user 消息是否值得发起搜索。
 * 对消息原文（而非去噪后的查询词）判定——"今天/最新"等时效词虽被查询清洗剔除，
 * 却是搜索强信号，门控必须能看到它们。规则：
 * 1. 无文本（纯图片/无 user 消息）→ 不搜；
 * 2. 去标点符号后为空（纯表情/颜文字）→ 不搜；
 * 3. 整条消息仅由闲聊回应词组成（问候/应答/感谢/告别/情绪/流程控制）→ 不搜；
 * 4. 其余一律搜索（宁多搜不漏搜：联网开关由用户主动开启，模糊地带保留搜索能力）。
 */
export function shouldSearchWeb(messages: readonly ClientHistoryMessage[]): boolean {
  let lastText: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "user") {
      continue;
    }
    const normalized = message.text.trim().replace(/[\r\n\t]/gu, " ");
    lastText = normalized.length === 0 ? null : normalized;
    break;
  }
  if (lastText === null) {
    return false;
  }

  const compact = lastText.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
  if (compact.length === 0) {
    return false;
  }
  return !chatReplyPattern.test(compact);
}

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
 * 原文含"最新/最近"等求新意图时，查询词末尾追加当前年份提升必应新鲜度排序
 * （"今天/现在"等实时语境不加：天气类查询必应本就返回当前信息，年份反而引入噪声）。
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

  const freshnessYear = /最新|最近/u.test(lastText) ? `${new Date().getUTCFullYear()}` : null;
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

  const withFreshness = (query: string): string =>
    freshnessYear === null ? query : truncateUnicode(`${query} ${freshnessYear}`, maximumQueryCharacters);

  if (currentKeywords.length > 0) {
    return withFreshness(
      usablePrevious === null
        ? currentKeywords
        : truncateUnicode(`${currentKeywords} ${usablePrevious}`, maximumQueryCharacters),
    );
  }
  const fallback = truncateUnicode(lastText, maximumQueryCharacters);
  return withFreshness(
    usablePrevious === null
      ? fallback
      : truncateUnicode(`${fallback} ${usablePrevious}`, maximumQueryCharacters),
  );
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
    .replace(/&nbsp;/gu, " ")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

/**
 * 从 HTML 提取可读正文文本（纯正则实现，保证 vitest node 环境可测，不依赖 HTMLRewriter）：
 * 去注释、脚本/样式/模板块与语义性非正文区（nav/header/footer/aside/form），
 * 块级闭合标签与 <br> 转换行，剥其余标签，解码实体后压缩空白。
 */
export function extractPageText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/giu, " ")
      .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/giu, " ")
      .replace(/<br\s*\/?\s*>/giu, "\n")
      .replace(
        /<\/(?:p|div|li|ul|ol|tr|td|th|section|article|main|h[1-6]|blockquote|pre|figure|figcaption|dl|dt|dd)\s*>/giu,
        "\n",
      )
      .replace(/<[^>]*>/gu, " "),
  )
    .replace(/[ \t\f\v\u00a0]+/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
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

/** 常见二级后缀（co.jp / com.cn 等）：可注册域名需取三段 */
const secondLevelSuffixes: ReadonlySet<string> = new Set([
  "co", "com", "net", "org", "gov", "edu", "ac",
]);

/** 提取 URL 的可注册域名（如 a.b.example.co.jp → example.co.jp）；解析失败返回 null */
function registrableDomain(url: string): string | null {
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
function dedupeByDomain(results: readonly WebSearchResult[]): WebSearchResult[] {
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
 * 单条结果的页面正文抓取：仅接受 HTML 响应。
 * 5 秒超时、联动客户端断开；提取文本必须比 RSS 摘要更长才有信息量，
 * 否则保留摘要。任何失败（非 200、非 HTML、反爬、超时、网络错误）静默返回原结果。
 */
async function fetchPageContent(
  result: WebSearchResult,
  locale: ChatLocale,
  signal: AbortSignal | undefined,
): Promise<WebSearchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), pageFetchTimeoutMs);
  const forwardAbort = () => controller.abort();

  if (signal !== undefined && signal.aborted) {
    controller.abort();
  }
  signal?.addEventListener("abort", forwardAbort);

  try {
    const response = await fetch(result.url, {
      headers: {
        accept: "text/html,application/xhtml+xml,*/*",
        "accept-language": localeMarket[locale].acceptLanguage,
        "user-agent": browserUserAgent,
      },
      signal: controller.signal,
    });
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
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
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
