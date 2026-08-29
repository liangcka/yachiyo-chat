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
 */
const chatReplyWords: readonly string[] = [
  ...greetingKeywords,
  // 应答确认
  "好的", "好滴", "好呀", "好吧", "好嘞", "好耶", "可以的", "没问题", "没错", "是的", "确实",
  "嗯", "哦", "噢", "唉", "欸", "诶", "哼", "对", "ok", "k",
  // 感谢与告别
  "谢谢", "多谢", "感谢", "thx", "thanks", "ありがとう", "拜拜", "再见", "またね", "88", "886",
  // 情绪与认知回应
  "太好了", "原来如此", "原来是这样", "我知道了", "我明白了", "我懂了", "我了解了",
  "明白了", "懂了", "知道了", "涨知识了", "学到了", "厉害", "不错", "挺好", "真好",
  "哈", "嘿", "呵", "呜", "耶", "哇", "嘻嘻", "啦啦啦",
  // 对话流程控制
  "继续", "继续说", "接着说", "说下去", "然后呢", "再说一遍", "重复一下", "别说了",
  // 语气尾词
  "呀", "啊", "呢", "啦", "嘛", "哟", "嘞", "吧", "哦", "捏", "哒", "滴",
  // 日语回应
  "なるほど", "わかった", "そうだね", "うん", "はい",
].sort((a, b) => b.length - a.length);

/** 纯闲聊消息匹配：整条消息去标点后可完全由闲聊词序列组成 */
const chatReplyPattern = new RegExp(`^(?:${chatReplyWords.join("|")})+$`, "u");

/**
 * 时间与日历纯查询正则：
 * 当前时间/日期由系统提示词（`当前现实时间：...`）实时注入，
 * 模型自身即可精确回答，绝不应向外部搜索引擎检索（避免搜出汉字字典/无关社交账号页面）。
 */
const pureTimeInquiryPattern =
  /^(?:请问|告诉我|帮我查一下|查一下)?\s*(?:现在|今天|目前|当前|现在是|今天是|此时)?\s*(?:几点|几点了|几点钟|什么时间|几号|几月几号|星期几|礼拜几|周几|时间是多少|何时|今何時|何曜日|何日)\s*[?？吗吧呢啦!！~～\s]*$/iu;

/**
 * 角色互动与日常情感生活闲聊正则：
 * 用户与八千代的日常陪伴互动，不需要联网搜索。
 */
const personaOrChitChatPattern =
  /^(?:(?:八千代|yachiyo|彩叶)?\s*(?:你是谁|你叫什么|你多大|在干嘛|在做什么|在干什么|在不在|在吗|想你了|想你啦|想我了吗|抱抱|摸摸头|摸摸|喜欢我吗|你喜欢我吗|喜欢你|爱我吗|爱你|你觉得我|你记得我吗|你喜欢吃什么|你喜欢什么|你会什么|你的生日|今天好累|今天好开心|我好难过|好无聊|无聊啊|睡不着|准备去睡觉|要去睡了|准备吃饭|晚饭吃什么|午饭吃什么|早饭吃什么|吃了吗|吃过了吗|天气真好|今天真好|好困|困了)\s*[?？吗吧呢啦!！~～\s]*)$/iu;

/**
 * 无需外部时效信息的常规创作/代码/翻译/常识任务正则：
 * （如单纯请求写诗、讲笑话、写简单代码、算术、翻译等，且未提及外部最新实体）
 */
const standardTaskPattern =
  /^(?:(?:帮我|给我)?(?:写一首|写首|创作一首|作一首)(?:关于\S+的)?(?:诗|诗歌|歌词)|讲个笑话|说个笑话|唱首歌|唱支歌|用(?:python|javascript|typescript|c\+\+|java|go|rust|c#|php|swift|kotlin)?\s*写(?:一个|一段|个)?\s*(?:冒泡排序|快速排序|斐波那契|二分查找|hello\s*world|简单代码|函数|脚本)|(?:计算|算一下|求)\s*[\d\s+\-*=().\x2f]+|翻译(?:成|为)?(?:英语|英文|日语|日文|中文|汉语|法文|法语|德语|德文|韩语|韩文|俄语|俄文)?[\s：:]*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\w\s]+|为什么天空是蓝的|勾股定理(?:是什么)?|圆周率(?:是多少)?)\s*[?？!！~～\s]*$/iu;

/**
 * 强时效/实体搜索正向触发特征：
 * 命中这些强特征且不属于时间/闲聊排除项时，判定为需要联网。
 */
const explicitSearchKeywords = [
  "帮我查", "查一下", "查查", "搜一下", "搜搜", "搜索一下", "搜索", "查下",
  "調べて", "検索",
];

const factualEntityTriggers = [
  // 气象预报
  "天气", "气温", "下雨", "降水", "台风", "预报", "空气质量", "pm2.5", "天気", "気温", "降水",
  // 新闻与时事
  "新闻", "时事", "资讯", "头条", "热搜", "突发", "赛况", "比分", "战报", "金牌榜", "奖牌榜", "ニュース",
  // 金融与行情
  "股价", "股票", "行情", "汇率", "金价", "油价", "大盘", "纳斯达克", "标普", "株価", "為替",
  // 产品发布与版本动态
  "发布了吗", "发布会", "上线了吗", "发售了吗", "出了吗", "上市时间", "发售日", "版本更新", "更新日志", "更新了什么", "新特性",
  "多少钱", "售价", "价格多少", "官网价格", "首发价", "多少円",
  // 对比与评测
  "对比", "评测", "参数配置", "区别是什么", "参数对比",
];

/**
 * 名词定义、网络热梗、概念科普与实体背景正向特征：
 * 如"民主暗潮是什么"、"什么是管理式民主"、"赛博朋克是什么梗"、"DeepSeek怎么回事"、"XXとは"等。
 */
const conceptEntityQueryPattern =
  /(?:是什么|什么是|指的是什么|指什么|是什么梗|是什么意思|是什么游戏|是什么东西|是啥|谁是|是谁|怎么回事|为什么叫|为什么被称为|由来|起源|含义|出处|科普一下|科普下|介绍一下|介绍下|背景故事|世界观)|^(?:什么是|解释一下|解释下|科普一下|科普下|介绍一下|介绍下|何谓)/u;
const conceptEntityJaPattern =
  /(?:とは|って何|ってなに|どういう意味|何の略|元ネタ|由来)/u;

/**
 * 关注最新动态与前沿实体的正向正则：
 * 如含"最新/最近/今年" + 具体名词，或提及时效性 AI/科技产品。
 */
const freshEntityPattern =
  /(?:最新|最近|今年|近期)\s*(?:消息|进展|动态|情况|版本|特性|模型|发布|论文|政策|通知|安排|名单|排名|榜单)|(?:deepseek|claude|gemini|gpt-?5|gpt-?4\.5|llama|qwen|stepfun|openai|anthropic|kimi|minimax|midjourney|sora|vision\s*pro|iphone\s*\d+|switch\s*2)\b/iu;

/**
 * 上下文追问/纠错特征：
 * 在前序有搜索或提问背景下，简短的追问（"那北京呢"、"广州呢"）或纠错（"不对，已经发布了"）
 */
const followUpQueryPattern =
  /^(?:那|还有|另外)?\s*[\p{Script=Han}\w]{2,10}\s*(?:呢|怎么样|如何|怎样|的天气|的情况)\s*[?？]*$/u;
const correctionPattern =
  /^(?:不对|不是|错了|其实|已经|明明|并不是|搞错了|不是吧)[，, ]*.+/u;

/**
 * 联网搜索意图门控：判断最新 user 消息是否值得发起网络搜索。
 * 遵循 DeepSeek Harness "一切为了精准、宁缺毋滥" 的插件工具调用理念：
 * 1. 无文本（纯图片/无 user 消息）→ 不搜；
 * 2. 纯标点、颜文字或纯闲聊回应（问候/应答/感谢/告别/语气词）→ 不搜；
 * 3. 当前现实时间/日期查询（系统已有时间感知）→ 不搜；
 * 4. 角色互动、日常情感陪伴与生活闲聊（"你是谁"、"在干嘛"、"今天好累"）→ 不搜；
 * 5. 常规创作/代码/翻译/常识任务（无外部最新时效诉求）→ 不搜；
 * 6. 命中显式搜索指令、气象新闻金融时效词、前沿科技实体或追问纠错 → 搜索；
 * 7. 其余普通对话保守放行 false（避免无关搜索污染上下文与回复气泡）。
 */
export function shouldSearchWeb(messages: readonly ClientHistoryMessage[]): boolean {
  let lastText: string | null = null;
  let previousUserText: string | null = null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "user") {
      continue;
    }
    const normalized = message.text.trim().replace(/[\r\n\t]/gu, " ");
    if (lastText === null) {
      if (normalized.length === 0) {
        return false;
      }
      lastText = normalized;
      continue;
    }
    if (normalized.length > 0 && !normalized.startsWith("【")) {
      previousUserText = normalized;
      break;
    }
  }

  if (lastText === null) {
    return false;
  }

  const compact = lastText.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
  if (compact.length === 0) {
    return false;
  }

  // 1. 负向规则：纯闲聊/寒暄词组合
  if (chatReplyPattern.test(compact)) {
    return false;
  }

  // 2. 负向规则：当前时间/日历查询
  if (pureTimeInquiryPattern.test(lastText)) {
    return false;
  }

  // 3. 负向规则：角色互动与日常闲聊
  if (personaOrChitChatPattern.test(lastText)) {
    return false;
  }

  // 4. 负向规则：常规任务（创作/代码/算术/翻译）且不含强时效词
  if (
    standardTaskPattern.test(lastText) &&
    !explicitSearchKeywords.some((kw) => lastText!.includes(kw)) &&
    !factualEntityTriggers.some((kw) => lastText!.includes(kw)) &&
    !freshEntityPattern.test(lastText)
  ) {
    return false;
  }

  // 5. 正向规则：显式搜索词
  if (explicitSearchKeywords.some((kw) => lastText!.includes(kw))) {
    return true;
  }

  // 6. 正向规则：强时效事实关键词
  if (factualEntityTriggers.some((kw) => lastText!.includes(kw))) {
    return true;
  }

  // 7. 正向规则：前沿实体与时效求新
  if (freshEntityPattern.test(lastText)) {
    return true;
  }

  // 8. 正向规则：名词定义、网络热梗、概念科普与实体背景
  if (conceptEntityQueryPattern.test(lastText) || conceptEntityJaPattern.test(lastText)) {
    return true;
  }

  // 9. 正向规则：纠错
  if (correctionPattern.test(lastText)) {
    return true;
  }

  // 10. 正向规则：上下文追问（在上文已具备搜索/事实意图时，如"那北京呢"）
  if (followUpQueryPattern.test(lastText) && previousUserText !== null) {
    if (
      factualEntityTriggers.some((kw) => previousUserText!.includes(kw)) ||
      freshEntityPattern.test(previousUserText) ||
      conceptEntityQueryPattern.test(previousUserText) ||
      explicitSearchKeywords.some((kw) => previousUserText!.includes(kw))
    ) {
      return true;
    }
  }

  // 保守兜底：默认不盲目搜索
  return false;
}

