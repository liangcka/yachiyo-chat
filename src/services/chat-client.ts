import type { Locale } from "../domain/chat";

export interface StreamChatMessage {
  role: "user" | "assistant";
  text: string;
  imageDataUrl?: string;
}

export interface StreamChatRequest {
  locale: Locale;
  messages: StreamChatMessage[];
}

export interface StreamChatResult {
  truncated: boolean;
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
  ) {
    super(code);
    this.name = "ChatClientError";
  }
}

export interface StreamChatOptions {
  onDelta: (text: string) => void;
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

export async function streamChat(
  request: StreamChatRequest,
  options: StreamChatOptions,
): Promise<StreamChatResult> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetcher("/api/chat", {
      body: JSON.stringify(request),
      credentials: "same-origin",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      method: "POST",
      signal: options.signal,
    });
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
      } else if (fields.event === "done" && typeof payload.truncated === "boolean") {
        finished = { truncated: payload.truncated };
      } else if (fields.event === "error" && payload.code === "PROVIDER_STREAM_ERROR") {
        throw new ChatClientError("PROVIDER_ERROR");
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
