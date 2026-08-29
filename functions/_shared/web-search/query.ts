import type { ClientHistoryMessage } from "../validation";
import { greetingKeywords } from "./intent";
import { truncateUnicode } from "./text";

const maximumQueryCharacters = 100;

/**
 * 查询词噪声词表：疑问/请求短语、时间填充词、语气词与结构助词、纠错反驳用语、日语助词。
 * 实测必应对口语化整句（含"今天/最近/的/怎么样"等）极易跑偏（返回黄历/日历/百科页），
 * 去除后可把消息压缩为高相关关键词（如"今天上海的天气怎么样"→"上海天气"）。
 * 注意：仅收录经实测必要且不易破坏词内字符的词，按长度降序应用。
 */
const queryNoiseWords: readonly string[] = [
  "怎么样", "怎样", "怎么", "如何", "为什么", "有什么", "是什么", "有没有", "是不是",
  "在哪里", "在哪", "哪些", "什么", "哪里", "哪儿", "多少",
  "指的是什么", "指的是啥", "指的是", "指什么", "是指",
  "被称为", "被称作", "是哪个", "哪个", "哪款", "是哪款",
  "什么是", "到底是什么", "到底是啥", "是个啥", "是啥", "何谓", "解释一下", "解释下",
  "教えて", "知りたい", "ください", "です", "ます",
  "告诉我", "帮我查", "查一下", "查查", "搜一下", "搜索一下", "搜索", "请问", "帮我", "一下",
  "今天", "今日", "明天", "后天", "昨天", "现在", "現在", "目前", "当前", "最近", "最新",
  "说错了", "怎么会", "不对", "不是", "错了", "搞错", "其实", "应该", "已经", "明明", "乱说", "胡说",
  "吗", "呢", "啊", "呀", "哦", "吧", "嘛", "么", "的", "里的", "上的", "中的",
  "は", "が", "を", "で", "へ",
].sort((a, b) => b.length - a.length);

/** 显式领域/平台关键词列表（按长度降序），用于识别与提取用户提问中的领域范围 */
const domainKeywords: readonly string[] = [
  "PlayStation", "Switch", "Steam", "Xbox", "Epic",
  "主机游戏", "单机游戏", "手机游戏", "网络游戏",
  "steam", "ps5", "ps4", "xbox",
  "游戏", "主机", "单机", "手游", "网游",
  "二次元", "动漫", "番剧", "漫画",
  "大模型", "开源模型", "开源项目",
].sort((a, b) => b.length - a.length);

/** 已知类型/特征（如射击游戏、动作游戏、魂类游戏等）正则提取 */
const knownGenrePattern =
  /(?:(?:射击|动作|角色扮演|魂类|肉鸽|卡牌|策略|开放世界|沙盒|生存|解谜|养成|自走棋|大逃杀|MMO|PVE|PVP|RPG|FPS|TPS)\s*游戏|开源\s*(?:大?模型|LLM|项目)|大语言模型|开源模型)/giu;

/** 梗/黑话/定义/概念探究意图正则 */
const memeOrConceptPattern =
  /(?:是什么梗|什么梗|是个什么梗|是啥梗|指的是什么|指什么|指的是啥|是什么意思|是啥意思|含义是什么|由来|出处|指的是哪款|指的是哪个|是哪款|是哪个|叫什么|原型是什么|什么是|何谓|解释一下|解释下)/u;

/** 提取文本中显式出现的领域/平台关键词 */
function extractExplicitDomains(text: string): string[] {
  const matched: string[] = [];
  for (const kw of domainKeywords) {
    if (text.toLowerCase().includes(kw.toLowerCase())) {
      matched.push(kw);
    }
  }
  return [...new Set(matched)];
}

/** 提取已知分类/类型线索（如射击游戏、开源大模型） */
function extractKnownGenres(text: string): string[] {
  const matches = text.match(knownGenrePattern);
  return matches ? [...new Set(matches.map((m) => m.trim()))] : [];
}

/** 检测梗/黑话/定义探究意图 */
function isMemeOrConceptInquiry(text: string): boolean {
  return memeOrConceptPattern.test(text);
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

const defaultMaxQueries = 3;

/**
 * 客户端注入的技能指令与前情摘要消息都以"【"开头，不是真实提问，
 * 不能作为搜索上文（避免把整段技能指令拼进查询词）。
 */
function isInjectedContextMessage(text: string): boolean {
  return text.startsWith("【");
}

/**
 * 提取多实体/对比关键词（如 "DeepSeek V4 和 Claude 3.7" → ["DeepSeek V4", "Claude 3.7"]）
 */
function extractComparisonEntities(text: string): string[] {
  const parts = text.split(/\s*(?:vs\.?|VS|对比|比较|和|与|跟|还是)\s*/u);
  if (parts.length < 2) {
    return [];
  }
  const entities: string[] = [];
  for (const part of parts) {
    const cleaned = stripQueryNoise(truncateUnicode(part.trim(), maximumQueryCharacters));
    if (cleaned.length >= 2 && !greetingKeywords.has(cleaned.toLowerCase())) {
      entities.push(cleaned);
    }
  }
  return entities.length >= 2 ? entities : [];
}

/**
 * 构造多路搜索词列表（借鉴 DeepSeek Harness 多 Query 扇出与长尾语境分析设计）：
 * 1. 基础主查询（含去噪与上下文结合，保留长尾词组完整语境）；
 * 2. 追问/纠错时：补充当前独立提问作为次级查询（如 "3.7 flash StepFun" + "3.7 flash"）；
 * 3. 显式领域限定词 / 已知特征融合（如 "Steam 民主版暗潮"、"民主版暗潮 射击游戏"）；
 * 4. 梗/概念探究的多维领域限定词扇出（自动补充 "梗"、"游戏"、"Steam" 候选）；
 * 5. 复合词/修饰词扇出（如 "民主版暗潮" → "民主暗潮"）；
 * 6. 对比/多实体时：补充各实体独立查询（如 "DeepSeek V4 与 Claude 3.7" → 拆分子实体）；
 * 7. 时效词（最新/最近）追加年份；
 * 8. 全局 Set 去重，限制在 maxQueries（默认 3）条以内。
 * 纯图片或无文本时返回空数组 []。
 */
export function buildSearchQueries(
  messages: readonly ClientHistoryMessage[],
  maxQueries = defaultMaxQueries,
): string[] {
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
        return [];
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
    return [];
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

  const baseCurrent =
    currentKeywords.length > 0 ? currentKeywords : truncateUnicode(lastText, maximumQueryCharacters);

  const candidates: string[] = [];

  // 1. 主查询：存在上文则结合
  if (usablePrevious !== null) {
    candidates.push(withFreshness(truncateUnicode(`${baseCurrent} ${usablePrevious}`, maximumQueryCharacters)));
    // 2. 追问场景下，当前独立关键词也作为备选查询
    if (currentKeywords.length > 0) {
      candidates.push(withFreshness(currentKeywords));
    }
  } else {
    candidates.push(withFreshness(baseCurrent));
  }

  // 3. 已知类型/特征与显式领域限定词融合
  const explicitDomains = extractExplicitDomains(lastText);
  const knownGenres = extractKnownGenres(lastText);
  const isMemeInquiry = isMemeOrConceptInquiry(lastText);

  // 融入已知分类特征（如 "射击游戏"）
  for (const genre of knownGenres) {
    if (!baseCurrent.includes(genre)) {
      candidates.push(withFreshness(truncateUnicode(`${baseCurrent} ${genre}`, maximumQueryCharacters)));
    }
  }

  // 融入显式领域限定词（如 "Steam", "游戏"）
  for (const domain of explicitDomains) {
    if (!baseCurrent.toLowerCase().includes(domain.toLowerCase())) {
      candidates.push(withFreshness(truncateUnicode(`${domain} ${baseCurrent}`, maximumQueryCharacters)));
    }
  }

  // 4. 梗/概念探究场景下的领域限定词智能扇出
  if (isMemeInquiry) {
    if (!baseCurrent.includes("梗")) {
      candidates.push(withFreshness(truncateUnicode(`${baseCurrent} 梗`, maximumQueryCharacters)));
    }
    // 若未指明具体领域，自动补充游戏与 Steam 领域限定词扇出
    if (explicitDomains.length === 0 && knownGenres.length === 0) {
      if (!baseCurrent.includes("游戏")) {
        candidates.push(withFreshness(truncateUnicode(`${baseCurrent} 游戏`, maximumQueryCharacters)));
      }
      if (!baseCurrent.toLowerCase().includes("steam")) {
        candidates.push(withFreshness(truncateUnicode(`Steam ${baseCurrent}`, maximumQueryCharacters)));
      }
    }
  }

  // 5. 对比/多实体抽取
  const comparisonEntities = extractComparisonEntities(lastText);
  for (const entity of comparisonEntities) {
    candidates.push(withFreshness(entity));
  }

  // 6. 复合词/修饰词扇出（如 "民主版暗潮" → "民主暗潮"）
  if (baseCurrent.includes("版")) {
    const stripped = baseCurrent.replace(/版/gu, "").trim();
    if (stripped.length >= 2 && stripped !== baseCurrent) {
      candidates.push(withFreshness(stripped));
      if (isMemeInquiry && !stripped.includes("梗")) {
        candidates.push(withFreshness(truncateUnicode(`${stripped} 梗`, maximumQueryCharacters)));
      }
    }
  }

  // 去重并限制数量
  const unique = new Set<string>();
  const results: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.length === 0 || unique.has(trimmed)) {
      continue;
    }
    unique.add(trimmed);
    results.push(trimmed);
    if (results.length >= maxQueries) {
      break;
    }
  }

  return results;
}

/**
 * 以最后一条 user 消息文本构造单一主搜索词（完全向下兼容既有单测与调用）。
 * 最后一条 user 消息为空文本（纯图片）返回 null。
 */
export function buildSearchQuery(messages: readonly ClientHistoryMessage[]): string | null {
  const queries = buildSearchQueries(messages, 1);
  return queries[0] ?? null;
}
