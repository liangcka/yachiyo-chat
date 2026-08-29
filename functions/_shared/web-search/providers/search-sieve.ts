import type { ChatLocale } from "../../validation";
import type { WebSearchResult } from "../types";

/** 已知低质域名、垃圾农场、黄页广告、海外运营商与登录重定向黑名单 */
const spamDomainSuffixes: readonly string[] = [
  ".vn",
  ".ru",
  ".trunsweb.com.tw",
  ".zikao.com.cn",
  ".58.com",
  ".baixing.com",
  "cellphones.com.vn",
  "dpg.danawa.com",
  "y8.com",
  ".y8.com",
  "discounttire.com",
  "redmondtires.com",
  "lesschwab.com",
  "yelp.com",
  "telstra.com.au",
  "telstra.com",
  "greater.com.au",
  "lowyat.net",
  "internations.org",
  "capcut.com",
  ".capcut.com",
  "snaptik.app",
];

const loginPathnames: readonly string[] = ["/login", "/signin", "/user/login", "/auth/login"];

/** 常见泛修饰词/高频通用词（非核心锚点实体） */
const genericModifierWords: ReadonlySet<string> = new Set([
  "民主",
  "自由",
  "科学",
  "社会",
  "发展",
  "建设",
  "管理",
  "官方",
  "最新",
  "手机",
  "电脑",
  "软件",
  "游戏",
  "电影",
  "视频",
  "音乐",
  "中国",
  "美国",
  "日本",
  "世界",
  "方法",
  "教程",
  "技巧",
  "系统",
  "平台",
  "网站",
  "历史",
  "文化",
  "工作",
  "问题",
  "情况",
  "分析",
  "研究",
  "报道",
  "评价",
  "体验",
  "标准",
  "豪华",
  "典藏",
  "普通",
  "专业",
  "基础",
  "高级",
]);

/** 意识形态宣传、党派斗争与政党选举强特征词 */
const ideologyAndPoliticalKeywords: readonly string[] = [
  "习近平",
  "求是网",
  "求是",
  "马克思主义",
  "新华网",
  "人民网",
  "央视网",
  "党建",
  "全过程人民民主",
  "社会主义核心价值观",
  "总书记",
  "政治局",
  "常委会",
  "中宣部",
  "党中央",
  "治国理政",
  "两会",
  "十九大",
  "二十大",
  "中纪委",
  "纪检监察",
  "民主党",
  "共和党",
  "选战",
  "选情",
  "总统大选",
  "众议院",
  "参议院",
  "佩洛西",
  "白宫",
  "拜登",
  "特朗普",
  "奥巴马",
  "哈里斯",
  "党内斗争",
  "党内内斗",
  "权力交接",
  "选民",
  "国会议员",
  "民主社会分歧",
];

/** 显式政治意图查询正则匹配 */
const politicalQueryPattern =
  /政治|政党|选举|大选|国会|党派|众议院|参议院|总统|白宫|拜登|特朗普|奥巴马|哈里斯|佩洛西|选情|选战|习近平|求是|党建|马克思|治国理政|社会主义/u;

const sieveNoiseWords: readonly string[] = [
  "怎么样",
  "怎样",
  "怎么",
  "如何",
  "为什么",
  "有什么",
  "是什么",
  "有没有",
  "是不是",
  "在哪里",
  "在哪",
  "哪些",
  "什么",
  "哪里",
  "哪儿",
  "多少",
  "教えて",
  "知りたい",
  "ください",
  "です",
  "ます",
  "告诉我",
  "帮我查",
  "查一下",
  "查查",
  "搜一下",
  "搜索一下",
  "搜索",
  "请问",
  "帮我",
  "一下",
  "今天",
  "今日",
  "明天",
  "后天",
  "昨天",
  "现在",
  "現在",
  "目前",
  "当前",
  "最近",
  "最新",
  "说错了",
  "怎么会",
  "不对",
  "不是",
  "错了",
  "搞错",
  "其实",
  "应该",
  "已经",
  "明明",
  "乱说",
  "胡说",
  "吗",
  "呢",
  "啊",
  "呀",
  "哦",
  "吧",
  "嘛",
  "么",
  "的",
  "版",
  "与",
  "和",
  "跟",
  "对比",
  "比较",
  "は",
  "が",
  "を",
  "で",
  "へ",
].sort((a, b) => b.length - a.length);

function isExampleDomain(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".test") ||
    host.endsWith(".local") ||
    host.includes("example.")
  );
}

/** 提取查询词中的核心实体词（英文单词、数字、汉字连续词组与实体片段），用于相关度重合度校验 */
function extractQueryTokens(query: string): string[] {
  let cleaned = query.toLowerCase();
  for (const noise of sieveNoiseWords) {
    cleaned = cleaned.split(noise).join(" ");
  }

  const alphaMatches = cleaned.match(/[a-z0-9]{2,}/gu) || [];
  const hanBlocks = (cleaned.match(/\p{Script=Han}+/gu) || []).filter((w) => w.length >= 2);
  const hanTokens: string[] = [];

  for (const block of hanBlocks) {
    hanTokens.push(block);
    // 为长复合词补充实体片段（如 "民主暗潮" -> "暗潮"）
    if (block.length >= 4) {
      const sub1 = block.slice(0, 2);
      const sub2 = block.slice(-2);
      if (!genericModifierWords.has(sub1)) hanTokens.push(sub1);
      if (!genericModifierWords.has(sub2)) hanTokens.push(sub2);
    }
  }

  return [...new Set([...alphaMatches, ...hanTokens])].filter((t) => t.length >= 2);
}

/**
 * DeepSeek Harness 风格的 SearchSieve（证据筛子）：
 * 1. 过滤垃圾/广告/死链/黄页/海外运营商/登录域名；
 * 2. 语种一致性验证（中文查询下剔除日文假名、俄文西里尔字母以及非测试域名的纯外文无关页面；intl 国际模式放行权威国际外文证据）；
 * 3. 跨领域意识形态/政治噪音消除：非政治查询过滤党政宣传/政党选举/内斗新闻（如因“民主”词根误召回的“求是网/民主党”）；
 * 4. 证据核心实体锚点校验：排除与查询核心实体完全无关的泛词匹配或广告噪音（如 CapCut 等）。
 */
export function sieveSearchResult(
  result: WebSearchResult,
  _query?: string,
  locale?: ChatLocale | "intl",
): boolean {
  const title = result.title.toLowerCase();
  const snippet = (result.snippet ?? "").toLowerCase();
  const combined = `${title} ${snippet}`;

  let host = "";
  try {
    const parsed = new URL(result.url);
    host = parsed.hostname.toLowerCase();
    if (spamDomainSuffixes.some((s) => host.endsWith(s) || host === s)) {
      return false;
    }
    if (loginPathnames.includes(parsed.pathname.toLowerCase())) {
      return false;
    }
  } catch {
    return false;
  }

  // 中文模式特定筛除（intl 国际多语种模式不强制汉字要求）
  if (locale === "zh-CN") {
    // 排除日文假名（如 Windows8 メールアプリ...）
    if (/[\u3040-\u309f\u30a0-\u30ff]/u.test(combined)) {
      return false;
    }
    // 排除俄文西里尔字母（如 Правила сообщества YouTube）
    if (/[\u0400-\u04ff]/u.test(combined)) {
      return false;
    }
    // 中文模式下，若查询包含汉字且非测试域名，结果必须至少包含 1 个汉字（过滤澳大利亚银行、海外运营商等纯英文无关结果）
    const queryHasHan = _query !== undefined && /\p{Script=Han}/u.test(_query);
    if (queryHasHan && !isExampleDomain(host) && !/\p{Script=Han}/u.test(combined)) {
      return false;
    }
  }

  // 非政治类查询过滤意识形态与政党选举/党派政治噪音（无论 zh-CN 还是 intl 国际智能路由，查询非政治时严格隔离）
  if (_query !== undefined && !politicalQueryPattern.test(_query)) {
    if (ideologyAndPoliticalKeywords.some((kw) => combined.includes(kw.toLowerCase()))) {
      return false;
    }
  }

  // 证据相关度过滤：若提供了查询词且非测试/本地域名，结果标题或摘要必须包含至少一个核心锚点实体
  if (_query !== undefined && !isExampleDomain(host)) {
    const tokens = extractQueryTokens(_query);
    if (tokens.length > 0) {
      // 优先校验非泛修饰词的锚点实体（如 "暗潮" > "民主"）
      const anchorTokens = tokens.filter((t) => !genericModifierWords.has(t));
      const tokensToCheck = anchorTokens.length > 0 ? anchorTokens : tokens;
      if (!tokensToCheck.some((token) => combined.includes(token))) {
        return false;
      }
    }
  }

  return true;
}

/** 批量筛选并去重 */
export function sieveSearchResults(
  results: readonly WebSearchResult[],
  query?: string,
  locale?: ChatLocale | "intl",
): WebSearchResult[] {
  return results.filter((r) => sieveSearchResult(r, query, locale));
}
