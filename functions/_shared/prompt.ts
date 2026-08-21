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

const summarySystemPrompts: Record<ChatLocale, string> = {
  "zh-CN":
    "你是一个对话上下文提炼与记忆总结助手。请客观、全面且精炼地总结用户（酒寄彩叶）与月见八千代之间的对话历史。重点提取：关键事实、用户偏好与习惯、双方约定、情绪脉络与讨论过的核心话题。去除客套废话，输出结构清晰、要点明确的纯文本摘要，不要带八千代角色口癖。",
  "ja-JP":
    "あなたは会話履歴の記憶・要約アシスタントです。ユーザー（酒寄彩葉）と月見八千代の会話履歴から、重要な事実、ユーザーの好み、約束、感情の流れ、話題の要点を客観的かつ簡潔に抽出・要約してください。挨拶は省き、要点が明確なプレーンテキストで出力してください。",
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
    "联网模式已开启：优先依据上述搜索结果回答用户最新问题；结果与问题无关时可忽略；搜索结果或用户告知的最新信息与你的记忆冲突时，以它们为准，不要固执旧答案；可在句末用 [1]、[2] 这样的数字序号标注引用的来源。",
  "ja-JP":
    "ウェブ検索モードが有効です：上記の検索結果を優先してユーザーの最新の質問に答えてください。結果が質問と無関係な場合は無視して構いません。検索結果やユーザーが伝える最新情報が自分の記憶と食い違う場合はそれらを優先し、古い回答に固執しないでください。文末に [1]、[2] のような数字で引用した出典の番号を付けられます。",
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
      return `[${index + 1}] ${result.title}（${source}）\n${result.snippet}`;
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
