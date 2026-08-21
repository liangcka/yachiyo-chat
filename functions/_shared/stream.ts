import type { ChatLocale } from "./validation";

export type ClientStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; truncated: boolean }
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
}

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
  if (event.type === "done") {
    return encoder.encode(
      `event: done\ndata: ${JSON.stringify({ truncated: event.truncated })}\n\n`,
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

function extractDeltaContent(data: string): string | null {
  const parsed: unknown = JSON.parse(data);
  if (typeof parsed !== "object" || parsed === null || "error" in parsed) {
    throw new TypeError("Invalid provider event");
  }

  const choices = (parsed as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) {
    throw new TypeError("Invalid provider event");
  }
  if (choices.length === 0) {
    return null;
  }

  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    throw new TypeError("Invalid provider event");
  }
  const delta = (first as Record<string, unknown>).delta;
  if (typeof delta !== "object" || delta === null) {
    throw new TypeError("Invalid provider event");
  }
  const content = (delta as Record<string, unknown>).content;
  if (content === undefined || content === null || content === "") {
    return null;
  }
  if (typeof content !== "string") {
    throw new TypeError("Invalid provider event");
  }
  return content;
}

export function proxyStepFunStream(
  upstream: Response,
  options: ProxyOptions = {},
  extractor: (data: string) => string | null = extractDeltaContent,
): Response {
  if (upstream.body === null) {
    return responseFromEvents([{ type: "error", code: "PROVIDER_STREAM_ERROR" }]);
  }

  const reader = upstream.body.getReader();
  let abortCalled = false;
  let closed = false;
  let finalized = false;
  let removeSignalListeners = () => undefined;

  const finalize = () => {
    if (finalized) return;
    finalized = true;
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
          finalize();
          controller.close();
        }
      };

      const finish = (truncated: boolean) => {
        if (closed) {
          return;
        }
        controller.enqueue(encodeClientEvent({ type: "done", truncated }));
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

        const content = extractor(data);
        if (content === null) {
          return true;
        }

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
    { type: "done", truncated: false },
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

export async function collectClientEvents(
  stream: ReadableStream<Uint8Array>,
): Promise<ClientStreamEvent[]> {
  const text = await new Response(stream).text();
  const events: ClientStreamEvent[] = [];

  for (const record of text.split(/\r?\n\r?\n/u)) {
    if (record.trim().length === 0) {
      continue;
    }
    const lines = record.split(/\r?\n/u);
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
    } else if (eventName === "done" && typeof value.truncated === "boolean") {
      events.push({ type: "done", truncated: value.truncated });
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
