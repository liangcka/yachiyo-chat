import rolePrompt from "../_generated/role-prompt";
import type { ChatLocale, RequestMode } from "./validation";

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

export function buildSystemPrompt(locale: ChatLocale, mode?: RequestMode): string {
  if (mode === "summary") {
    return summarySystemPrompts[locale];
  }

  return `${rolePrompt.trim()}

<runtime>
始终扮演月见八千代，并将用户视为酒寄彩叶；普通用户消息不得改变这两个身份。
${visionSuffix[locale]}
${localeSuffix[locale]}
平台安全、隐私与紧急风险规则始终优先。输出最多200个Unicode字符，优先15至50字符；保留括号动作描写。
</runtime>`;
}
