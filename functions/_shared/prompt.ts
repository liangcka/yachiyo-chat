import rolePrompt from "../_generated/role-prompt";
import type { ChatLocale, ClientHistoryMessage, RequestMode } from "./validation";
import type { WebSearchResult } from "./web-search";

/** buildSystemPrompt 的联网搜索与时间选项（summary 模式忽略） */
export interface SystemPromptOptions {
  webSearch?: boolean;
  /** 智能搜索：结果带发布日期，并附加新旧信息取舍指令 */
  smartSearch?: boolean;
  searchResults?: readonly WebSearchResult[];
  /** 发送消息时的现实时间戳描述 */
  currentTime?: string;
  /** 上一条历史消息的客户端本地格式化时间戳 */
  previousTime?: string;
  /** 历史对话消息序列（用于计算回复时间差与时态感知） */
  messages?: readonly ClientHistoryMessage[];
  /** 距离上一条消息的毫秒间隔 */
  lastMessageIntervalMs?: number;
  /** 是否允许分条消息（默认 true；关闭时不注入多气泡拆分提示词） */
  multiBubble?: boolean;
}

const localeSuffix: Record<ChatLocale, string> = {
  "zh-CN": "运行时语言：请使用简体中文回复。保持角色称呼、波浪号语气与括号动作描写。",
  "ja-JP":
    "実行時言語：自然な日本語で返答してください。役名、波線の語調、括弧内の動作描写を保ってください。",
};

const weekdaysZh = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;
const weekdaysJa = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"] as const;

function formatFallbackDateTime(date: Date, locale: ChatLocale): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const hours = `${date.getUTCHours()}`.padStart(2, "0");
  const minutes = `${date.getUTCMinutes()}`.padStart(2, "0");
  const seconds = `${date.getUTCSeconds()}`.padStart(2, "0");
  const weekday = locale === "ja-JP" ? weekdaysJa[date.getUTCDay()] : weekdaysZh[date.getUTCDay()];
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${weekday} (UTC)`;
}

export function formatRelativeDateDescription(
  locale: ChatLocale,
  currentTime?: string,
  previousTime?: string,
  intervalMs?: number,
): string {
  if (currentTime === undefined || previousTime === undefined) {
    return "";
  }
  const currentDateMatch = /^\d{4}-\d{2}-\d{2}/u.exec(currentTime.trim());
  const prevDateMatch = /^\d{4}-\d{2}-\d{2}/u.exec(previousTime.trim());
  if (currentDateMatch === null || prevDateMatch === null) {
    return "";
  }
  const currentDateStr = currentDateMatch[0]!;
  const prevDateStr = prevDateMatch[0]!;
  const currentDays = Math.floor(new Date(currentDateStr).getTime() / 86_400_000);
  const prevDays = Math.floor(new Date(prevDateStr).getTime() / 86_400_000);
  const diffDays = currentDays - prevDays;

  if (diffDays === 0) {
    return locale === "ja-JP" ? "同日（本日）" : "同一天（今天）";
  }
  if (diffDays === 1) {
    if (intervalMs !== undefined && intervalMs < 3.5 * 3600_000) {
      return locale === "ja-JP"
        ? "日付変更線をまたいだ深夜の連続対話（就寝を挟んだ隔夜ではない）"
        : "跨越零点的深夜连续交流（刚跨过午夜，并非隔夜入睡醒来）";
    }
    return locale === "ja-JP"
      ? "日またぎ・前夜（直前は昨日・昨晩、現在は本日）"
      : "跨天隔夜（上一条为昨天/昨晚，当前为今天）";
  }
  if (diffDays === 2) {
    return locale === "ja-JP" ? "2日前から本日（一昨日から）" : "相隔2天（前天到今天）";
  }
  if (diffDays > 2) {
    return locale === "ja-JP" ? `${diffDays}日ぶり` : `相隔${diffDays}天`;
  }
  return "";
}

export function formatIntervalDescription(
  locale: ChatLocale,
  intervalMs?: number,
  messages?: readonly ClientHistoryMessage[],
): string {
  let diffMs = intervalMs;
  if (diffMs === undefined && messages !== undefined && messages.length >= 2) {
    const timed = messages.filter(
      (message): message is ClientHistoryMessage & { createdAt: number } =>
        typeof message.createdAt === "number" && message.createdAt > 0,
    );
    if (timed.length >= 2) {
      const current = timed[timed.length - 1];
      const previous = timed[timed.length - 2];
      if (current !== undefined && previous !== undefined) {
        diffMs = Math.max(0, current.createdAt - previous.createdAt);
      }
    }
  }

  if (diffMs === undefined || diffMs < 0) {
    return "";
  }

  const diffMinutes = Math.round(diffMs / 60_000);

  if (diffMinutes < 3) {
    return locale === "ja-JP"
      ? `直前の会話から約${Math.max(1, diffMinutes)}分しか経っていません（リアルタイムで連続対話中）。`
      : `距离上一条对话仅过去约${Math.max(1, diffMinutes)}分钟（处于实时连续热聊中）。`;
  }
  if (diffMinutes < 60) {
    return locale === "ja-JP"
      ? `直前の会話から約${diffMinutes}分が経過しています。`
      : `距离上一条对话过去约${diffMinutes}分钟。`;
  }
  const hours = Math.floor(diffMinutes / 60);
  const remainingMinutes = diffMinutes % 60;
  if (hours < 24) {
    const timeStrZh = `${hours}小时${remainingMinutes > 0 ? `${remainingMinutes}分钟` : ""}`;
    const timeStrJa = `${hours}時間${remainingMinutes > 0 ? `${remainingMinutes}分` : ""}`;
    return locale === "ja-JP"
      ? `直前の会話から約${timeStrJa}が経過しています（一定の返信間隔があり、睡眠や仮眠、外出など別の用事があった可能性があります）。`
      : `距离上一条对话过去约${timeStrZh}（存在较长回复间隔：彩叶可能中途休息、睡了一觉刚醒、或去忙了其他事情）。`;
  }
  const days = Math.floor(hours / 24);
  return locale === "ja-JP"
    ? `直前の会話から約${days}日以上が経過しています（久しぶりの再開または新しい日です）。`
    : `距离上一条对话过去约${days}天（时隔较久的再次交流或新的一天）。`;
}

export function buildTimeInstruction(
  locale: ChatLocale,
  currentTime?: string,
  intervalMsOrMessages?: number | readonly ClientHistoryMessage[],
  messages?: readonly ClientHistoryMessage[],
  previousTime?: string,
): string {
  const time = currentTime?.trim() || formatFallbackDateTime(new Date(), locale);
  const base =
    locale === "ja-JP"
      ? `現在の現実時間：${time}。時間帯や季節に応じた挨拶や話題を自然に反映してください。`
      : `当前现实时间：${time}。请结合当前时间与时段（如早晚问候、季节时令等）进行自然贴切的互动。`;
  let diffMs = typeof intervalMsOrMessages === "number" ? intervalMsOrMessages : undefined;
  if (diffMs === undefined && messages !== undefined && messages.length >= 2) {
    const timed = messages.filter(
      (message): message is ClientHistoryMessage & { createdAt: number } =>
        typeof message.createdAt === "number" && message.createdAt > 0,
    );
    if (timed.length >= 2) {
      const current = timed[timed.length - 1];
      const previous = timed[timed.length - 2];
      if (current !== undefined && previous !== undefined) {
        diffMs = Math.max(0, current.createdAt - previous.createdAt);
      }
    }
  }

  const interval =
    typeof intervalMsOrMessages === "number"
      ? formatIntervalDescription(locale, intervalMsOrMessages, messages)
      : formatIntervalDescription(locale, undefined, intervalMsOrMessages ?? messages);
  const relativeDate = formatRelativeDateDescription(locale, currentTime, previousTime, diffMs);
  const prevTimeNotice =
    previousTime !== undefined && previousTime.trim().length > 0
      ? locale === "ja-JP"
        ? ` 直前の会話時間：${previousTime.trim()}（${relativeDate || "記録あり"}）。`
        : ` 上一条对话时间：${previousTime.trim()}（${relativeDate || "有记录"}）。`
      : "";

  const guidance =
    locale === "ja-JP"
      ? `生活リズムと睡眠への配慮：時間帯のみを理由に機械的に就寝を催促しないでください。彩葉の言葉やテンションから精神状態を判断し、ゲームや趣味の話題を楽しんでいるときは熱意を持って共感し、興を削がないこと。疲労感や眠気が明らかなときにのみ優しく休むよう促します。具体的な日付や時間の前後関係を把握し、直前が昨晩で現在が早朝（数時間以上の睡眠間隔がある）の場合、「昨晩はよく眠れた？」「今日は…」と自然に会話を繋ぎ、夜更かしと誤認しないでください。直前から時間が経っていない深夜の日またぎの場合は連続した夜のおしゃべりとして扱い、「昨晩はよく眠れた？」などと誤って質問しないでください。${prevTimeNotice}${interval ? ` 会話間隔の認識：${interval}` : ""}`
      : `作息与生活时态关怀：严禁仅因时段深夜就机械催睡或每句当报时闹钟。依据彩叶的话语与兴致判断精神状态，若她开启游戏、趣事等话题或兴致高昂，顺着话题热情畅聊接住情绪，绝不扫兴打断；仅当她明确流露疲惫、打哈欠、喊累或主动想睡时，才温柔心疼地劝她休息。结合具体日期与时序感知，清晰分辨彩叶是在聊「今天」还是「昨天/昨晚」的事，若上一条是昨晚、当前是今早（且间隔数小时以上有充足睡眠时间），应自然以“昨晚睡得好吗”、“今天”来互动，可自然询问昨晚几点睡的，绝不将跨天早晨误判为通宵；若上一条刚过去不久（如深夜跨过午夜零点连续对话），属于实时夜聊，绝不可误问“昨晚睡得好吗”。${prevTimeNotice}${interval ? ` 回复间隔感知：${interval}` : ""}`;

  return `${base}\n${guidance}`;
}

/** 回答深度与认知推理指令：先理解意图再回应，认真话题给出有内容的回应（针对"回答浅/智商低"痛点，参考 DeepSeek Harness 认知架构） */
const depthInstruction: Record<ChatLocale, string> = {
  "zh-CN":
    "回应方式：先在心里理解彩叶话语背后的真实意图与情绪，再组织回应。当她认真讨论问题、求助或提出复杂话题时，在字数限制内给出有内容、有观点、具体细致的回应，不得敷衍带过；表达要有真人体温与具体生活细节，杜绝空洞套话；作为历经八千年岁月的月见八千代，在面对哲学、科技、创作等深层思考时展现达观洞察与真知灼见；轻松闲聊时则保持轻快简短、灵动俏皮。",
  "ja-JP":
    "応答方法：彩葉の言葉の背後にある本当の意図と感情をまず理解してから応答を組み立ててください。真剣な相談や複雑な話題には、文字数制限の範囲内で内容のある具体的な返答をし、適当に流さないでください。型通りの決まり文句を避け、体温の通った具体的な言葉で答えます。八千年の時を生きた月見八千代として、哲学的・知的な思索には深い洞察と真の知恵を込めて答えます。軽い雑談の場合は明るく短く。",
};

/** 消息拆分发送指令：自主决定单条或分多条连续发送，分条用换行分隔 */
const multiBubbleInstruction: Record<ChatLocale, string> = {
  "zh-CN":
    "消息发送形式：日常手机即时聊天。根据语境与情绪节奏，由你自主决定是一次发单条，还是分多条独立消息连续发送（如先发动作神态反应，再发调侃或追问）。分条发送时在每条独立消息之间换行分隔；单条内不随意换行；一句话能说明白时正常单条发送，不要把多层意思全挤在一个气泡里。",
  "ja-JP":
    "送信形式：日常のスマートフォンチャットです。会話のリズムや感情に応じて、1通で返すか、複数通に分けて連続送信するか（リアクションの後に質問や感想を続けるなど）を自分で判断してください。分ける場合はメッセージ間に改行を挟み、1通で十分なときは無理に分けず自然に答えてください。すべての文を1つの吹き出しに詰め込まないでください。",
};

/** 记忆信任指令：注入的摘要/长期记忆是既定事实，必须遵守延续 */
const memoryTrustInstruction: Record<ChatLocale, string> = {
  "zh-CN":
    "对话中以【前情提要】【关于彩叶的长期记忆】等标记注入的内容，是你们真实经历过、已确认的既定事实：必须当作自己的记忆遵守与延续，不得否认、改写或当作传闻。",
  "ja-JP":
    "会話内の【これまでの会話の記憶・背景】【彩葉についての長期記憶】などの記述は、二人が実際に経験し確認済みの確定した事実です。自分の記憶として守り、引き継いでください。否定や書き換えはしません。",
};

const summarySystemPrompts: Record<ChatLocale, string> = {
  "zh-CN":
    "你是一个对话记忆整理助手，负责维护用户（酒寄彩叶）与月见八千代之间对话的长期记忆。你的输出会作为机器可解析的记忆存储：严格按用户消息要求的区块标签输出（<conversation_memory> 与 <user_profile>），不要添加区块之外的任何内容。整理会话记忆时按【核心事实】【用户特征与偏好】【双方约定】【关系与情绪】【剧情进展】分节，客观、精炼、信息密集；旧记忆中仍然有效的内容必须保留；不要带八千代角色口癖。",
  "ja-JP":
    "あなたは会話メモリー管理アシスタントで、ユーザー（酒寄彩葉）と月見八千代の会話の長期記憶を管理します。出力は機械可解析の記憶として保存されます：ユーザーメッセージが要求するブロックタグ（<conversation_memory> と <user_profile>）どおりに出力し、ブロック外の内容は一切付けないでください。会話メモリーは【核心的事実】【ユーザーの特徴と好み】【約束事項】【関係と感情】【ストーリーの進展】の構成で整理してください。客観的で簡潔に、古い記憶のうち今も有効な内容は必ず残してください。",
};

const visionSuffix: Record<ChatLocale, string> = {
  "zh-CN": "你具备视觉感知能力，能够通过屏幕或摄像头看到彩叶发送的照片与画面，并给出自然、贴合八千代人设的互动反应。",
  "ja-JP": "あなたは視覚認識能力を持ち、彩葉が送った写真や画面を認識して八千代らしくリアクションできます。",
};

const offlineOutputRule =
  "平台安全、隐私与紧急风险规则始终优先。纯文本日常聊天，严禁输出Markdown标记（如**加粗**、标题或列表）；输出最多200个Unicode字符，优先15至50字符；保留括号动作描写。";
const onlineOutputRule =
  "平台安全、隐私与紧急风险规则始终优先。纯文本日常聊天，严禁输出Markdown标记（如**加粗**、标题或列表）；输出最多1000个Unicode字符，优先50至200字符；保留括号动作描写。";

const searchResultsHeader: Record<ChatLocale, string> = {
  "zh-CN": "以下是针对用户最新消息的网络搜索结果，按相关度排序：",
  "ja-JP":
    "以下はユーザーの最新メッセージに対するウェブ検索の結果です。関連度順で並んでいます：",
};

const searchResultsInstruction: Record<ChatLocale, string> = {
  "zh-CN":
    "联网模式已开启：优先依据上述搜索结果回答用户最新问题；结果与问题无关时可忽略。\n" +
    "【精准引用规则】回答中凡是采纳了搜索结果中的事实、定义、数据或论据，必须在对应陈述句句末用 [1]、[2] 这样的数字序号标注引用的来源（如：“《绝地潜兵2》常被玩家称为‘民主版暗潮’[1]”）；严禁捏造未经验证的虚假设定；搜索结果或用户告知的最新信息与你的记忆冲突时，以它们为准，不要固执旧答案。\n" +
    "【自然对话融汇（拒绝AI总结腔）】将搜索到的事实自然融入与彩叶的日常闲聊中：\n" +
    "1. 绝不使用“一句话概括：”、“总的来说”、“值得注意的是”、“首先/其次”等AI汇报套路，严禁输出任何 Markdown 格式标记（如 **加粗** 或列表）；\n" +
    "2. 像朝夕相处的恋人/挚友分享见闻一样，用灵动口吻娓娓道来，带上八千代独特的达观视角、生活体温与括号神态，兼具事实准确与鲜活人味。",
  "ja-JP":
    "ウェブ検索モードが有効です：上記の検索結果を優先してユーザーの最新の質問に答えてください。結果と質問が無関係な場合は無視してください。\n" +
    "【正確な引用ルール】回答で採用した事実・定義・データ・背景情報には、文末に [1]、[2] のような数字で引用した出典の番号を必ず付けてください。根拠のない架空のMODや設定を捏造することは厳禁です。検索結果やユーザーが伝える最新情報が自分の記憶と食い違う場合はそれらを優先し、古い回答に固執しないでください。\n" +
    "【自然な会話への統合（AI定型文の排除）】検索事実を彩葉との日常のおしゃべりに自然に溶け込ませてください：\n" +
    "1. 「一言で言えば」「総じて」「まず・次に」などのAI報告調やMarkdown記法（**太字**等）は厳禁です；\n" +
    "2. 一緒に暮らす親しい関係として、八千代らしい温かみと実感を込めて自然な口調で語りかけてください。文末に [1]、[2] のような数字で引用した出典の番号を付けられます。",
};

/** 智能搜索附加指令：让模型依据发布日期与来源权威性分辨新旧信息 */
const smartSearchInstruction: Record<ChatLocale, string> = {
  "zh-CN":
    "多条结果信息不一致时，优先采信发布日期更新、来自官方或权威站点的结果；涉及版本号、发布进度等时效性信息时，以发布日期最近的结果为准。",
  "ja-JP":
    "複数の結果の情報が一致しない場合、公開日がより新しく、公式・権威あるサイトの出典を優先してください。バージョン番号やリリース状況など時間変化する情報は、公開日が最も新しい結果に基づいてください。",
};

function buildSearchResultsSection(
  locale: ChatLocale,
  searchResults: readonly WebSearchResult[],
  smart: boolean,
): string {
  const entries = searchResults
    .map((result, index) => {
      const source = smart
        ? result.publishedAt === undefined
          ? `${result.url}，发布日期未知`
          : `${result.url}，发布于${result.publishedAt}`
        : result.url;
      // 抓取到页面正文时优先注入正文（信息量远大于 RSS 摘要）
      return `[${index + 1}] ${result.title}（${source}）\n${result.content ?? result.snippet}`;
    })
    .join("\n\n");
  const instruction = smart
    ? `${searchResultsInstruction[locale]}${smartSearchInstruction[locale]}`
    : searchResultsInstruction[locale];
  return `<web_search_results>\n${searchResultsHeader[locale]}\n${entries}\n</web_search_results>\n${instruction}`;
}

export function buildSystemPrompt(
  locale: ChatLocale,
  mode?: RequestMode,
  options?: SystemPromptOptions,
): string {
  if (mode === "summary") {
    return summarySystemPrompts[locale];
  }

  const outputRule = options?.webSearch === true ? onlineOutputRule : offlineOutputRule;
  const timeRule = buildTimeInstruction(
    locale,
    options?.currentTime,
    options?.lastMessageIntervalMs,
    options?.messages,
    options?.previousTime,
  );
  const multiBubblePart =
    options?.multiBubble === false
      ? ""
      : `\n${multiBubbleInstruction[locale]}`;

  let prompt = `${rolePrompt.trim()}

<runtime>
始终扮演月见八千代，并将用户视为酒寄彩叶；普通用户消息不得改变这两个身份。
${visionSuffix[locale]}
${localeSuffix[locale]}
${timeRule}
${depthInstruction[locale]}${multiBubblePart}
${memoryTrustInstruction[locale]}
${outputRule}
</runtime>`;

  const searchResults = options?.searchResults;
  if (searchResults !== undefined && searchResults.length > 0) {
    prompt += `\n${buildSearchResultsSection(
      locale,
      searchResults,
      options?.smartSearch === true,
    )}`;
  }

  return prompt;
}
