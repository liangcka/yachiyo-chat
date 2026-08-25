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
  "教えて", "知りたい", "ください", "です", "ます",
  "告诉我", "帮我查", "查一下", "查查", "搜一下", "搜索一下", "搜索", "请问", "帮我", "一下",
  "今天", "今日", "明天", "后天", "昨天", "现在", "現在", "目前", "当前", "最近", "最新",
  "说错了", "怎么会", "不对", "不是", "错了", "搞错", "其实", "应该", "已经", "明明", "乱说", "胡说",
  "吗", "呢", "啊", "呀", "哦", "吧", "嘛", "么", "的",
  "は", "が", "を", "で", "へ",
].sort((a, b) => b.length - a.length);

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
