import type { ClientHistoryMessage } from "../validation";

/**
 * 纯寒暄问候不作为搜索上文（如首条消息"你好"之后再提问，
 * 组合"上海天气 你好"没有意义，直接只用当前问题）。
 */
export const greetingKeywords: ReadonlySet<string> = new Set([
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
