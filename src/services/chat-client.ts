import type { ChatSource, Locale, TokenUsage } from "../domain/chat";
import type { ProviderId } from "../domain/llm";
import { apiCredentials } from "./app-platform";
import { apiFetch } from "./api-origins";

export interface StreamChatMessage {
  role: "user" | "assistant";
  text: string;
  imageDataUrl?: string;
}

export interface StreamChatRequest {
  locale: Locale;
  messages: StreamChatMessage[];
  mode?: "chat" | "summary";
  /** 用户自带 Key 路径：三者必须同时存在，否则走服务端 fallback */
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
  /** 开启后服务端先执行联网搜索并下发 sources 事件（仅普通聊天，summary 不携带） */
  webSearch?: boolean;
  /** 智能搜索：联网搜索开启时启用双市场并行检索（结果更多、带发布日期） */
  smartSearch?: boolean;
}

export interface StreamChatResult {
  truncated: boolean;
  usage?: TokenUsage;
}

export type ChatClientErrorCode =
  | "SESSION_REQUIRED"
  | "DAILY_QUOTA_EXCEEDED"
  | "INVALID_REQUEST"
  | "PROVIDER_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "ABORTED"
  | "STREAM_ERROR";

export class ChatClientError extends Error {
  constructor(
    readonly code: ChatClientErrorCode,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "ChatClientError";
  }
  /** 该错误是否属于重发同一请求即可能成功的瞬时故障 */
  get retryable(): boolean {
    return isRetryableChatErrorCode(this.code);
  }
}

/** 重发同一请求即可能成功的瞬时故障码；UI 层据此决定是否展示"重试"入口 */
const retryableChatErrorCodes: ReadonlySet<string> = new Set([
  "NETWORK_ERROR",
  "PROVIDER_ERROR",
  "SERVICE_UNAVAILABLE",
  "STREAM_ERROR",
]);

export function isRetryableChatErrorCode(code: string | undefined): boolean {
  return code !== undefined && retryableChatErrorCodes.has(code);
}

/** 流内 error 事件的 code → 客户端错误码；未知码一律视为上游故障，原始值进 detail */
function streamErrorEvent(code: string, detail?: string): ChatClientError {
  if (code === "PROVIDER_STREAM_ERROR") return new ChatClientError("PROVIDER_ERROR", undefined, detail);
  return new ChatClientError("PROVIDER_ERROR", undefined, `${code}${detail === undefined ? "" : ` ${detail}`}`);
}

export interface StreamChatOptions {
  onDelta: (text: string) => void;
  /** 深度思考/思维链流式增量回调 */
  onThought?: (text: string) => void;
  /** sources 事件（先于首个 delta 到达）合法时回调一次 */
  onSources?: (sources: ChatSource[]) => void;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
}

async function readProblemCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return undefined;
    const error = (body as Record<string, unknown>).error;
    if (typeof error !== "object" || error === null) return undefined;
    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

async function httpError(response: Response): Promise<ChatClientError> {
  const serverCode = await readProblemCode(response);
  if (response.status === 401 || serverCode === "SESSION_REQUIRED") {
    return new ChatClientError("SESSION_REQUIRED", response.status);
  }
  if (response.status === 429 || serverCode === "DAILY_QUOTA_EXCEEDED") {
    return new ChatClientError("DAILY_QUOTA_EXCEEDED", response.status);
  }
  if (response.status === 400 || response.status === 403 || serverCode === "INVALID_REQUEST") {
    return new ChatClientError("INVALID_REQUEST", response.status);
  }
  if (response.status === 502 || response.status === 504 || serverCode?.startsWith("PROVIDER_")) {
    return new ChatClientError("PROVIDER_ERROR", response.status);
  }
  return new ChatClientError("SERVICE_UNAVAILABLE", response.status);
}

function eventFields(record: string): { event?: string; data?: string } {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of record.split(/\r?\n/u)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /u, ""));
  }
  return { event, data: data.length === 0 ? undefined : data.join("\n") };
}

function objectPayload(data: string | undefined): Record<string, unknown> {
  if (data === undefined) throw new ChatClientError("STREAM_ERROR");
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    if (error instanceof ChatClientError) throw error;
  }
  throw new ChatClientError("STREAM_ERROR");
}

/** 校验 sources 事件载荷：必须是数组且每项 title/url 均为字符串，否则视为流损坏 */
function sourcesPayload(payload: Record<string, unknown>): ChatSource[] {
  const sources = payload.sources;
  if (!Array.isArray(sources)) throw new ChatClientError("STREAM_ERROR");
  return sources.map((source): ChatSource => {
    if (typeof source !== "object" || source === null) throw new ChatClientError("STREAM_ERROR");
    const { title, url } = source as Record<string, unknown>;
    if (typeof title !== "string" || typeof url !== "string") {
      throw new ChatClientError("STREAM_ERROR");
    }
    return { title, url };
  });
}

function isUsagePayload(value: unknown): value is TokenUsage {
  if (typeof value !== "object" || value === null) return false;
  const usage = value as Record<string, unknown>;
  const isOptionalInt = (v: unknown) =>
    v === undefined || (typeof v === "number" && Number.isSafeInteger(v));
  return (
    isOptionalInt(usage.promptTokens) &&
    isOptionalInt(usage.completionTokens) &&
    isOptionalInt(usage.totalTokens)
  );
}

export async function streamChat(
  request: StreamChatRequest,
  options: StreamChatOptions,
): Promise<StreamChatResult> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await apiFetch(
      "/api/chat",
      {
        body: JSON.stringify(request),
        credentials: apiCredentials(),
        headers: { accept: "text/event-stream", "content-type": "application/json" },
        method: "POST",
        signal: options.signal,
      },
      { fetcher },
    );
  } catch (error) {
    throw new ChatClientError(isAbort(error, options.signal) ? "ABORTED" : "NETWORK_ERROR");
  }

  if (!response.ok) throw await httpError(response);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (response.body === null || !contentType.includes("text/event-stream")) {
    await response.body?.cancel();
    throw new ChatClientError("STREAM_ERROR", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished: StreamChatResult | undefined;

  const consume = (flush: boolean) => {
    while (finished === undefined) {
      const separator = /\r?\n\r?\n/u.exec(buffer);
      if (separator === null) break;
      const record = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const fields = eventFields(record);
      const payload = objectPayload(fields.data);
      if (fields.event === "delta" && typeof payload.text === "string") {
        options.onDelta(payload.text);
      } else if (fields.event === "thought" && typeof payload.text === "string") {
        options.onThought?.(payload.text);
      } else if (fields.event === "sources") {
        const sources = sourcesPayload(payload);
        options.onSources?.(sources);
      } else if (fields.event === "done" && typeof payload.truncated === "boolean") {
        const usage = isUsagePayload(payload.usage) ? payload.usage : undefined;
        finished = { truncated: payload.truncated, ...(usage !== undefined ? { usage } : {}) };
      } else if (fields.event === "error" && typeof payload.code === "string") {
        throw streamErrorEvent(payload.code, typeof payload.message === "string" ? payload.message : undefined);
      } else {
        throw new ChatClientError("STREAM_ERROR");
      }
    }

    if (flush && finished === undefined && buffer.trim().length > 0) {
      throw new ChatClientError("STREAM_ERROR");
    }
  };

  try {
    while (finished === undefined) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        consume(true);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      consume(false);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ChatClientError) throw error;
    throw new ChatClientError(isAbort(error, options.signal) ? "ABORTED" : "STREAM_ERROR");
  }

  if (finished === undefined) throw new ChatClientError("STREAM_ERROR");
  await reader.cancel().catch(() => undefined);
  return finished;
}
