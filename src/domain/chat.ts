export type Locale = "zh-CN" | "ja-JP";

export type MessageStatus = "complete" | "streaming" | "failed" | "stopped";

export interface Conversation {
  id: string;
  title: string;
  locale: Locale;
  createdAt: number;
  updatedAt: number;
  summary?: string;
  lastCompressedAt?: number;
  /** 最后一条已压缩消息的 createdAt；早于此值的消息已被摘要取代，不再进入请求历史 */
  compressedUpTo?: number;
  /** 最后一条已压缩消息的 id；用于消息级精确因果回溯 */
  compressedUpToId?: string;
}

/** 联网搜索返回的参考来源 */
export interface ChatSource {
  readonly title: string;
  readonly url: string;
}

/** 消息消耗的 Token 统计（来自 upstream 模型返回） */
export interface TokenUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  imageId?: string;
  status: MessageStatus;
  createdAt: number;
  /** 服务端按输出上限截断回复时为 true */
  truncated?: boolean;
  /** 联网搜索的参考来源，随消息持久化 */
  sources?: ReadonlyArray<ChatSource>;
  /** 深度思考/思维链内容（DeepSeek-R1 / Claude Thinking / Gemini Thought） */
  thought?: string;
  /** 生成该消息时的厂商快照 */
  provider?: string;
  /** 生成该消息时的具体模型快照 */
  model?: string;
  /** 单条消息的 Token 消耗统计 */
  usage?: TokenUsage;
  /** 单次流式响应总耗时（毫秒） */
  latencyMs?: number;
  /** 用户主动停止/中断标记 */
  interrupted?: boolean;
}

export type StoredImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface StoredImage {
  id: string;
  conversationId: string;
  blob: Blob;
  width: number;
  height: number;
  mimeType: StoredImageMimeType;
}

