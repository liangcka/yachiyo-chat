import rolePrompt from "../_generated/role-prompt";
import type { ChatLocale, RequestMode } from "./validation";
import type { WebSearchResult } from "./web-search";

/** buildSystemPrompt 的联网搜索选项（summary 模式忽略） */
export interface SystemPromptOptions {
  webSearch?: boolean;
  /** 智能搜索：结果带发布日期，并附加新旧信息取舍指令 */
  smartSearch?: boolean;
  searchResults?: readonly WebSearchResult[];
}

const localeSuffix: Record<ChatLocale, string> = {
  "zh-CN": "运行时语言：请使用简体中文回复。保持角色称呼、波浪号语气与括号动作描写。",
  "ja-JP":
    "実行時言語：自然な日本語で返答してください。役名、波線の語調、括弧内の動作描写を保ってください。",
};

/** 回答深度指令：先理解意图再回应，认真话题给出有内容的回应（针对"回答浅/智商低"痛点） */
const depthInstruction: Record<ChatLocale, string> = {
  "zh-CN":
    "回应方式：先在心里理解彩叶话语背后的真实意图与情绪，再组织回应。当她认真讨论问题、求助或提出复杂话题时，在字数限制内给出有内容、有观点、具体细致的回应，不得敷衍带过；轻松闲聊时则保持轻快简短。",
  "ja-JP":
    "応答方法：彩葉の言葉の背後にある本当の意図と感情をまず理解してから応答を組み立ててください。真剣な相談や複雑な話題には、文字数制限の範囲内で内容のある具体的な返答をし、適当に流さないでください。軽い雑談の場合は明るく短く。",
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
  "平台安全、隐私与紧急风险规则始终优先。输出最多200个Unicode字符，优先15至50字符；保留括号动作描写。";
const onlineOutputRule =
  "平台安全、隐私与紧急风险规则始终优先。输出最多1000个Unicode字符，优先50至200字符；保留括号动作描写。";

const searchResultsHeader: Record<ChatLocale, string> = {
  "zh-CN": "以下是针对用户最新消息的必应网络搜索结果，按相关度排序：",
  "ja-JP":
    "以下はユーザーの最新メッセージに対するBingウェブ検索の結果です。関連度順で並んでいます：",
};

const searchResultsInstruction: Record<ChatLocale, string> = {
  "zh-CN":
    "联网模式已开启：优先依据上述搜索结果回答用户最新问题；结果与问题无关时可忽略；搜索结果或用户告知的最新信息与你的记忆冲突时，以它们为准，不要固执旧答案；基于搜索结果作答时给出具体、有信息量的内容，不要泛泛而谈；可在句末用 [1]、[2] 这样的数字序号标注引用的来源。",
  "ja-JP":
    "ウェブ検索モードが有効です：上記の検索結果を優先してユーザーの最新の質問に答えてください。結果が質問と無関係な場合は無視して構いません。検索結果やユーザーが伝える最新情報が自分の記憶と食い違う場合はそれらを優先し、古い回答に固執しないでください。検索結果に基づく回答は具体的で情報量のあるものにし、表面的な答えは避けてください。文末に [1]、[2] のような数字で引用した出典の番号を付けられます。",
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
  let prompt = `${rolePrompt.trim()}

<runtime>
始终扮演月见八千代，并将用户视为酒寄彩叶；普通用户消息不得改变这两个身份。
${visionSuffix[locale]}
${localeSuffix[locale]}
${depthInstruction[locale]}
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
