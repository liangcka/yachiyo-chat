import type { ChatLocale } from "./validation";

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ProviderChunkResult {
  content?: string | null;
  thought?: string | null;
  usage?: TokenUsage | null;
  sources?: ReadonlyArray<{ title: string; url: string }> | null;
}

export type ExtractedDelta = string | ProviderChunkResult | null;

export type ClientStreamEvent =
  | { type: "thought"; text: string }
  | { type: "delta"; text: string }
  | { type: "done"; truncated: boolean; usage?: TokenUsage }
  | { type: "error"; code: "PROVIDER_STREAM_ERROR" }
  | { type: "sources"; sources: ReadonlyArray<{ title: string; url: string }> };

interface ProxyOptions {
  abort?: () => void;
  clientSignal?: AbortSignal;
  onFinalize?: () => void;
  signal?: AbortSignal;
  maxCharacters?: number;
  /** 在读取 upstream 之前先下发的客户端事件（如 sources 搜索来源） */
  initialEvents?: readonly ClientStreamEvent[];
  /** SSE 心跳保活周期（毫秒），默认 5000ms；0 或负数表示不发送心跳 */
  keepAliveIntervalMs?: number;
}

const defaultKeepAliveIntervalMs = 5_000;
const keepAliveComment = new TextEncoder().encode(": ping\n\n");
const maximumOutputCharacters = 200;
const maximumProviderRecordBytes = 64 * 1_024;
const encoder = new TextEncoder();

function takeUnicodePrefix(
  value: string,
  maximum: number,
): { text: string; characters: number; hasMore: boolean } {
  let text = "";
  let characters = 0;

  for (const character of value) {
    if (characters >= maximum) {
      return { text, characters, hasMore: true };
    }
    text += character;
    characters += 1;
  }

  return { text, characters, hasMore: false };
}

function encodeClientEvent(event: ClientStreamEvent): Uint8Array {
  if (event.type === "delta") {
    return encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: event.text })}\n\n`);
  }
  if (event.type === "thought") {
    return encoder.encode(`event: thought\ndata: ${JSON.stringify({ text: event.text })}\n\n`);
  }
  if (event.type === "done") {
    const payload: { truncated: boolean; usage?: TokenUsage } = { truncated: event.truncated };
    if (event.usage !== undefined) {
      payload.usage = event.usage;
    }
    return encoder.encode(
      `event: done\ndata: ${JSON.stringify(payload)}\n\n`,
    );
  }
  if (event.type === "sources") {
    return encoder.encode(
      `event: sources\ndata: ${JSON.stringify({ sources: event.sources })}\n\n`,
    );
  }
  return encoder.encode(`event: error\ndata: ${JSON.stringify({ code: event.code })}\n\n`);
}

function responseFromEvents(events: ClientStreamEvent[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encodeClientEvent(event));
        }
        controller.close();
      },
    }),
    { headers: streamHeaders() },
  );
}

function streamHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
}

function recordData(record: string): string | null {
  const dataLines = record
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /u, ""));
  return dataLines.length === 0 ? null : dataLines.join("\n");
}

function isRawUsagePayload(
  value: unknown,
): value is { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } {
  return typeof value === "object" && value !== null;
}

function extractDeltaContent(data: string): ExtractedDelta {
  const parsed: unknown = JSON.parse(data);
  if (typeof parsed !== "object" || parsed === null || "error" in parsed) {
    throw new TypeError("Invalid provider event");
  }

  const recordObj = parsed as Record<string, unknown>;
  let usage: TokenUsage | undefined;
  if (isRawUsagePayload(recordObj.usage)) {
    const p = recordObj.usage.prompt_tokens;
    const c = recordObj.usage.completion_tokens;
    const t = recordObj.usage.total_tokens;
    usage = {
      ...(typeof p === "number" ? { promptTokens: p } : {}),
      ...(typeof c === "number" ? { completionTokens: c } : {}),
      ...(typeof t === "number" ? { totalTokens: t } : {}),
    };
  }

  const choices = recordObj.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return usage !== undefined ? { usage } : null;
  }

  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    throw new TypeError("Invalid provider event");
  }
  const delta = (first as Record<string, unknown>).delta;
  if (typeof delta !== "object" || delta === null) {
    throw new TypeError("Invalid provider event");
  }
  const deltaObj = delta as Record<string, unknown>;
  const content = typeof deltaObj.content === "string" && deltaObj.content.length > 0 ? deltaObj.content : null;
  const thought =
    typeof deltaObj.reasoning_content === "string" && deltaObj.reasoning_content.length > 0
      ? deltaObj.reasoning_content
      : typeof deltaObj.reasoning === "string" && deltaObj.reasoning.length > 0
        ? deltaObj.reasoning
        : null;

  if (content === null && thought === null && usage === undefined) {
    return null;
  }

  return {
    content,
    thought,
    ...(usage !== undefined ? { usage } : {}),
  };
}

export function proxyStepFunStream(
  upstream: Response,
  options: ProxyOptions = {},
  extractor: (data: string) => ExtractedDelta = extractDeltaContent,
): Response {
  if (upstream.body === null) {
    return responseFromEvents([{ type: "error", code: "PROVIDER_STREAM_ERROR" }]);
  }

  const reader = upstream.body.getReader();
  let abortCalled = false;
  let closed = false;
  let finalized = false;
  let removeSignalListeners = () => undefined;
  let accumulatedUsage: TokenUsage | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const clearPing = () => {
    if (pingTimer !== undefined) {
      clearInterval(pingTimer);
      pingTimer = undefined;
    }
  };

  const finalize = () => {
    if (finalized) return;
    finalized = true;
    clearPing();
    removeSignalListeners();
    options.onFinalize?.();
  };

  const abortUpstream = () => {
    if (!abortCalled) {
      abortCalled = true;
      options.abort?.();
    }
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const decoder = new TextDecoder();
      let buffer = "";
      let emittedCharacters = 0;

      const close = () => {
        if (!closed) {
          closed = true;
          clearPing();
          finalize();
          controller.close();
        }
      };

      const finish = (truncated: boolean) => {
        if (closed) {
          return;
        }
        controller.enqueue(
          encodeClientEvent({
            type: "done",
            truncated,
            ...(accumulatedUsage !== undefined ? { usage: accumulatedUsage } : {}),
          }),
        );
        close();
      };

      const fail = async () => {
        if (closed) {
          return;
        }
        controller.enqueue(
          encodeClientEvent({ type: "error", code: "PROVIDER_STREAM_ERROR" }),
        );
        abortUpstream();
        const cancellation = reader.cancel().catch(() => undefined);
        close();
        await cancellation;
      };

      const handleData = async (data: string): Promise<boolean> => {
        if (data === "[DONE]") {
          finish(false);
          return false;
        }

        const chunkResult = extractor(data);
        if (chunkResult === null) {
          return true;
        }

        const content = typeof chunkResult === "string" ? chunkResult : chunkResult.content ?? null;
        const thought = typeof chunkResult === "object" ? chunkResult.thought ?? null : null;
        const usage = typeof chunkResult === "object" ? chunkResult.usage ?? null : null;
        const sources = typeof chunkResult === "object" ? chunkResult.sources ?? null : null;

        if (sources !== null && sources.length > 0) {
          controller.enqueue(encodeClientEvent({ type: "sources", sources }));
        }

        if (usage !== null && usage !== undefined) {
          accumulatedUsage = {
            ...(accumulatedUsage ?? {}),
            ...(usage.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
            ...(usage.completionTokens !== undefined ? { completionTokens: usage.completionTokens } : {}),
            ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
          };
        }

        if (thought !== null && thought.length > 0) {
          controller.enqueue(encodeClientEvent({ type: "thought", text: thought }));
        }

        if (content !== null && content.length > 0) {
          const characterLimit = options.maxCharacters ?? maximumOutputCharacters;
          const remaining = characterLimit - emittedCharacters;
          const accepted = takeUnicodePrefix(content, remaining);
          if (accepted.characters > 0) {
            emittedCharacters += accepted.characters;
            controller.enqueue(encodeClientEvent({ type: "delta", text: accepted.text }));
          }

          if (accepted.hasMore || accepted.characters === remaining) {
            abortUpstream();
            try {
              await reader.cancel();
            } catch {
              // The response limit has already determined the client result.
            }
            finish(true);
            return false;
          }
        }
        return true;
      };

      const consumeRecords = async (flush: boolean): Promise<boolean> => {
        while (!closed) {
          const separator = /\r?\n\r?\n/u.exec(buffer);
          if (separator === null) {
            break;
          }

          const record = buffer.slice(0, separator.index);
          if (encoder.encode(record).byteLength > maximumProviderRecordBytes) {
            throw new TypeError("Provider record exceeds the byte limit");
          }
          buffer = buffer.slice(separator.index + separator[0].length);
          const data = recordData(record);
          if (data !== null && !(await handleData(data))) {
            return false;
          }
        }

        if (flush && buffer.trim().length > 0) {
          if (encoder.encode(buffer).byteLength > maximumProviderRecordBytes) {
            throw new TypeError("Provider record exceeds the byte limit");
          }
          const data = recordData(buffer);
          buffer = "";
          if (data !== null && !(await handleData(data))) {
            return false;
          }
        }
        return true;
      };

      const onClientAbort = () => {
        if (closed) {
          return;
        }
        abortUpstream();
        void reader.cancel().catch(() => undefined);
        close();
      };
      const onDeadline = () => {
        void fail();
      };
      options.clientSignal?.addEventListener("abort", onClientAbort, { once: true });
      options.signal?.addEventListener("abort", onDeadline, { once: true });
      removeSignalListeners = () => {
        options.clientSignal?.removeEventListener("abort", onClientAbort);
        options.signal?.removeEventListener("abort", onDeadline);
      };

      const keepAliveInterval = options.keepAliveIntervalMs ?? defaultKeepAliveIntervalMs;
      if (keepAliveInterval > 0) {
        pingTimer = setInterval(() => {
          if (!closed) {
            try {
              controller.enqueue(keepAliveComment);
            } catch {
              clearPing();
            }
          } else {
            clearPing();
          }
        }, keepAliveInterval);
      }

      void (async () => {
        try {
          for (const event of options.initialEvents ?? []) {
            if (closed) {
              return;
            }
            controller.enqueue(encodeClientEvent(event));
          }

          if (options.signal?.aborted) {
            await fail();
            return;
          }
          if (options.clientSignal?.aborted) {
            onClientAbort();
            return;
          }

          while (!closed) {
            const { done, value } = await reader.read();
            if (done) {
              buffer += decoder.decode();
              if (await consumeRecords(true)) {
                finish(false);
              }
              return;
            }

            if (value.byteLength > maximumProviderRecordBytes) {
              await fail();
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            if (!(await consumeRecords(false))) {
              return;
            }
            if (encoder.encode(buffer).byteLength > maximumProviderRecordBytes) {
              await fail();
              return;
            }
          }
        } catch {
          if (!options.clientSignal?.aborted) {
            await fail();
          }
        }
      })();
    },
    async cancel() {
      closed = true;
      clearPing();
      abortUpstream();
      try {
        await reader.cancel();
      } finally {
        finalize();
      }
    },
  });

  return new Response(body, { headers: streamHeaders() });
}

export const proxyProviderStream = proxyStepFunStream;

/** mock 模式联网搜索的固定来源载荷，用于 UI / e2e 验证 */
const mockSearchSources: ReadonlyArray<{ title: string; url: string }> = [
  { title: "必应搜索结果一", url: "https://www.bing.com/" },
  { title: "必应搜索结果二", url: "https://cn.bing.com/" },
];

export function mockChatResponse(
  locale: ChatLocale,
  mode?: string,
  webSearch?: boolean,
): Response {
  const text =
    mode === "summary"
      ? locale === "ja-JP"
        ? "これまでの会話：ユーザーと八千代の交流。重要な話題と約束が共有されています。"
        : "前情摘要：用户与八千代进行了日常交流，确认了相互的约定与近期话题。"
      : locale === "ja-JP"
        ? "彩葉〜今日もお疲れさま！（笑顔で温かいパンケーキを差し出す）"
        : "彩叶~今天也辛苦啦！（笑着递上热乎乎的松饼）";
  const characters = [...text];
  const midpoint = Math.ceil(characters.length / 2);
  return responseFromEvents([
    ...(webSearch === true
      ? [{ type: "sources" as const, sources: mockSearchSources }]
      : []),
    { type: "delta", text: characters.slice(0, midpoint).join("") },
    { type: "delta", text: characters.slice(midpoint).join("") },
    {
      type: "done",
      truncated: false,
      usage: {
        promptTokens: 35,
        completionTokens: 28,
        totalTokens: 63,
      },
    },
  ]);
}

function isSourcesPayload(value: unknown): value is Array<{ title: string; url: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).title === "string" &&
        typeof (item as Record<string, unknown>).url === "string",
    )
  );
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

export async function collectClientEvents(
  stream: ReadableStream<Uint8Array>,
): Promise<ClientStreamEvent[]> {
  const text = await new Response(stream).text();
  const events: ClientStreamEvent[] = [];

  for (const record of text.split(/\r?\n\r?\n/u)) {
    if (record.trim().length === 0) {
      continue;
    }
    const lines = record.split(/\r?\n/u).filter((line) => !line.startsWith(":"));
    if (lines.length === 0) {
      continue;
    }
    const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = recordData(record);
    if (data === null) {
      throw new TypeError("Invalid client event");
    }
    const payload: unknown = JSON.parse(data);
    if (typeof payload !== "object" || payload === null) {
      throw new TypeError("Invalid client event");
    }
    const value = payload as Record<string, unknown>;

    if (eventName === "delta" && typeof value.text === "string") {
      events.push({ type: "delta", text: value.text });
    } else if (eventName === "thought" && typeof value.text === "string") {
      events.push({ type: "thought", text: value.text });
    } else if (eventName === "done" && typeof value.truncated === "boolean") {
      const usage = isUsagePayload(value.usage) ? value.usage : undefined;
      events.push({
        type: "done",
        truncated: value.truncated,
        ...(usage !== undefined ? { usage } : {}),
      });
    } else if (eventName === "error" && value.code === "PROVIDER_STREAM_ERROR") {
      events.push({ type: "error", code: "PROVIDER_STREAM_ERROR" });
    } else if (eventName === "sources" && isSourcesPayload(value.sources)) {
      events.push({
        type: "sources",
        sources: value.sources.map(({ title, url }) => ({ title, url })),
      });
    } else {
      throw new TypeError("Invalid client event");
    }
  }

  return events;
}
