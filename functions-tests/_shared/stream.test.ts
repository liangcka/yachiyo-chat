import { describe, expect, it, vi } from "vitest";
import {
  collectClientEvents,
  mockChatResponse,
  proxyStepFunStream,
} from "../../functions/_shared/stream";

const encoder = new TextEncoder();

function chunkedResponse(text: string, chunkSize = 7): Response {
  const bytes = encoder.encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          controller.enqueue(bytes.slice(offset, offset + chunkSize));
        }
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function upstreamSse(deltas: string[], chunkSize = 7): Response {
  const records = deltas
    .map((content) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`,
    )
    .join("");
  return chunkedResponse(`${records}data: [DONE]\r\n\r\n`, chunkSize);
}

function controlledUpstream(initialText = ""): {
  cancel: ReturnType<typeof vi.fn>;
  close: () => void;
  response: Response;
} {
  const cancel = vi.fn();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        if (initialText.length > 0) {
          controller.enqueue(encoder.encode(initialText));
        }
      },
      cancel,
    }),
    { headers: { "content-type": "text/event-stream" } },
  );

  return {
    cancel,
    close: () => controller.close(),
    response,
  };
}

describe("proxyStepFunStream", () => {
  it("parses split UTF-8 records into sanitized client events", async () => {
    const response = proxyStepFunStream(upstreamSse(["彩叶~", "辛苦啦！"], 3));
    const events = await collectClientEvents(response.body!);

    expect(events).toEqual([
      { type: "delta", text: "彩叶~" },
      { type: "delta", text: "辛苦啦！" },
      { type: "done", truncated: false },
    ]);
  });

  it("caps output at 200 Unicode characters and aborts upstream", async () => {
    const abort = vi.fn();
    const response = proxyStepFunStream(
      upstreamSse(["🌙".repeat(150), "八".repeat(100)]),
      { abort },
    );
    const events = await collectClientEvents(response.body!);
    const text = events
      .filter((event) => event.type === "delta")
      .map((event) => event.text)
      .join("");

    expect([...text]).toHaveLength(200);
    expect(events.at(-1)).toEqual({ type: "done", truncated: true });
    expect(abort).toHaveBeenCalledOnce();
  });

  it("replaces malformed upstream data with one stable error code", async () => {
    const response = proxyStepFunStream(
      chunkedResponse("data: {provider-secret-body}\n\n"),
    );
    const events = await collectClientEvents(response.body!);

    expect(events).toEqual([{ type: "error", code: "PROVIDER_STREAM_ERROR" }]);
    expect(JSON.stringify(events)).not.toContain("provider-secret-body");
  });

  it("emits initial sources events before any upstream delta", async () => {
    const response = proxyStepFunStream(upstreamSse(["彩叶~"]), {
      initialEvents: [
        { type: "sources", sources: [{ title: "来源甲", url: "https://a.example.com/" }] },
        { type: "sources", sources: [{ title: "来源乙", url: "https://b.example.com/" }] },
      ],
    });
    const events = await collectClientEvents(response.body!);

    expect(events.slice(0, 2)).toEqual([
      { type: "sources", sources: [{ title: "来源甲", url: "https://a.example.com/" }] },
      { type: "sources", sources: [{ title: "来源乙", url: "https://b.example.com/" }] },
    ]);
    expect(events[2]).toEqual({ type: "delta", text: "彩叶~" });
    expect(events.at(-1)).toEqual({ type: "done", truncated: false });
  });

  it("emits sources event when extractor dynamically returns grounding sources", async () => {
    const customUpstream = chunkedResponse("data: chunk-with-sources\r\n\r\ndata: [DONE]\r\n\r\n");
    const customExtractor = (data: string) => {
      if (data === "chunk-with-sources") {
        return {
          content: "民主暗潮解答",
          sources: [{ title: "维基百科", url: "https://zh.wikipedia.org/" }],
        };
      }
      return null;
    };
    const response = proxyStepFunStream(customUpstream, {}, customExtractor);
    const events = await collectClientEvents(response.body!);

    expect(events).toEqual([
      { type: "sources", sources: [{ title: "维基百科", url: "https://zh.wikipedia.org/" }] },
      { type: "delta", text: "民主暗潮解答" },
      { type: "done", truncated: false },
    ]);
  });

  it("cancels a provider stream that exceeds its total deadline", async () => {
    vi.useFakeTimers();
    const upstream = controlledUpstream();
    const abort = vi.fn();
    const deadline = new AbortController();
    const response = proxyStepFunStream(upstream.response, {
      abort,
      signal: deadline.signal,
    });
    const eventsPromise = collectClientEvents(response.body!);

    setTimeout(() => deadline.abort(), 25);
    await vi.advanceTimersByTimeAsync(25);
    const timedOut = abort.mock.calls.length === 1;
    if (!timedOut) {
      upstream.close();
    }
    const events = await eventsPromise;
    vi.useRealTimers();

    expect(timedOut).toBe(true);
    expect(upstream.cancel).toHaveBeenCalledOnce();
    expect(events).toEqual([{ type: "error", code: "PROVIDER_STREAM_ERROR" }]);
  });

  it("rejects an oversized raw provider record before waiting for its terminator", async () => {
    const secret = "provider-secret-body";
    const upstream = controlledUpstream(`data: ${secret}${"x".repeat(70 * 1_024)}`);
    const abort = vi.fn();
    const response = proxyStepFunStream(upstream.response, { abort });
    const eventsPromise = collectClientEvents(response.body!);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const rejectedBeforeClose = abort.mock.calls.length === 1;
    if (!rejectedBeforeClose) {
      upstream.close();
    }
    const events = await eventsPromise;

    expect(rejectedBeforeClose).toBe(true);
    expect(upstream.cancel).toHaveBeenCalledOnce();
    expect(events).toEqual([{ type: "error", code: "PROVIDER_STREAM_ERROR" }]);
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it("emits periodic keepalive comments without corrupting client events", async () => {
    vi.useFakeTimers();
    const upstream = controlledUpstream();
    const response = proxyStepFunStream(upstream.response, {
      keepAliveIntervalMs: 10,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    const readPromise = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
    })();

    await vi.advanceTimersByTimeAsync(25);
    upstream.close();
    await readPromise;
    vi.useRealTimers();

    const output = chunks.join("");
    expect(output).toContain(": ping\n\n");
  });

  it("safely ignores comment-only records in collectClientEvents", async () => {
    const sse = ": ping\r\n\r\nevent: delta\r\ndata: {\"text\":\"内容\"}\r\n\r\n: ping\r\n\r\nevent: done\r\ndata: {\"truncated\":false}\r\n\r\n";
    const events = await collectClientEvents(chunkedResponse(sse).body!);

    expect(events).toEqual([
      { type: "delta", text: "内容" },
      { type: "done", truncated: false },
    ]);
  });
});

describe("mockChatResponse", () => {
  it("prepends two fixed sources events when webSearch is enabled", async () => {
    const events = await collectClientEvents(mockChatResponse("zh-CN", undefined, true).body!);

    expect(events[0]).toEqual({
      type: "sources",
      sources: [
        { title: "必应搜索结果一", url: "https://www.bing.com/" },
        { title: "必应搜索结果二", url: "https://cn.bing.com/" },
      ],
    });
    expect(events[1]?.type).toBe("delta");
    expect(events.at(-1)).toEqual({
      type: "done",
      truncated: false,
      usage: { promptTokens: 35, completionTokens: 28, totalTokens: 63 },
    });
  });

  it("keeps the plain mock response without webSearch", async () => {
    const events = await collectClientEvents(mockChatResponse("zh-CN").body!);

    expect(events.some((event) => event.type === "sources")).toBe(false);
    expect(events.at(-1)).toEqual({
      type: "done",
      truncated: false,
      usage: { promptTokens: 35, completionTokens: 28, totalTokens: 63 },
    });
  });
});

describe("collectClientEvents sources parsing", () => {
  it("round-trips an encoded sources event", async () => {
    const response = proxyStepFunStream(upstreamSse(["彩叶~"]), {
      initialEvents: [{ type: "sources", sources: [{ title: "标题", url: "https://x.example/" }] }],
    });
    const text = await new Response(response.body!).text();

    expect(text).toContain('event: sources\ndata: {"sources":[{"title":"标题","url":"https://x.example/"}]}');
    const events = await collectClientEvents(new Response(text).body!);
    expect(events[0]).toEqual({
      type: "sources",
      sources: [{ title: "标题", url: "https://x.example/" }],
    });
  });

  it("rejects malformed sources payloads", async () => {
    const malformed = [
      'event: sources\ndata: {"sources":{"title":"t","url":"u"}}\n\n',
      'event: sources\ndata: {"sources":[{"title":1,"url":"https://x.example/"}]}\n\n',
      'event: sources\ndata: {"sources":[{"title":"t"}]}\n\n',
      'event: sources\ndata: {}\n\n',
    ].join("");

    await expect(collectClientEvents(chunkedResponse(malformed).body!)).rejects.toThrow(TypeError);
  });

  it("extracts thought and usage from upstream stream", async () => {
    const customExtractor = (data: string) => {
      if (data === "chunk-1") return { thought: "思考中..." };
      if (data === "chunk-2") return { content: "回答正文", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
      return null;
    };
    const sse = "data: chunk-1\r\n\r\ndata: chunk-2\r\n\r\ndata: [DONE]\r\n\r\n";
    const response = proxyStepFunStream(chunkedResponse(sse), {}, customExtractor);
    const events = await collectClientEvents(response.body!);

    expect(events).toEqual([
      { type: "thought", text: "思考中..." },
      { type: "delta", text: "回答正文" },
      {
        type: "done",
        truncated: false,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    ]);
  });
});

