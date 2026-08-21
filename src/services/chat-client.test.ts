import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatClientError, streamChat, type StreamChatRequest } from "./chat-client";

const sampleRequest: StreamChatRequest = {
  locale: "zh-CN",
  messages: [{ role: "user", text: "今天有点累" }],
};

function splitBytes(value: string, sizes: number[]): Uint8Array[] {
  const bytes = new TextEncoder().encode(value);
  const parts: Uint8Array[] = [];
  let offset = 0;
  let index = 0;
  while (offset < bytes.length) {
    const size = sizes[index % sizes.length] ?? 1;
    parts.push(bytes.slice(offset, offset + size));
    offset += size;
    index += 1;
  }
  return parts;
}

function sseResponse(value: string, sizes = [1, 2, 5, 3]): Response {
  const chunks = splitBytes(value, sizes);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

function problem(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("streamChat", () => {
  let serverFetch: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    serverFetch = vi.fn<typeof fetch>();
  });

  it("parses Unicode delta records split across arbitrary byte boundaries", async () => {
    serverFetch.mockResolvedValue(
      sseResponse(
        'event: delta\r\ndata: {"text":"彩叶~"}\r\n\r\n' +
          'event: delta\ndata: {"text":"辛苦啦！"}\n\n' +
          'event: done\ndata: {"truncated":false}\n\n',
      ),
    );
    const chunks: string[] = [];

    await expect(
      streamChat(sampleRequest, {
        fetcher: serverFetch,
        onDelta: (text) => chunks.push(text),
      }),
    ).resolves.toEqual({ truncated: false });

    expect(chunks).toEqual(["彩叶~", "辛苦啦！"]);
    expect(serverFetch).toHaveBeenCalledWith("/api/chat", {
      body: JSON.stringify(sampleRequest),
      credentials: "same-origin",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      method: "POST",
      signal: undefined,
    });
  });

  it.each([
    [problem("SESSION_REQUIRED", 401), "SESSION_REQUIRED"],
    [problem("DAILY_QUOTA_EXCEEDED", 429), "DAILY_QUOTA_EXCEEDED"],
    [problem("INVALID_REQUEST", 400), "INVALID_REQUEST"],
    [problem("PROVIDER_TIMEOUT", 504), "PROVIDER_ERROR"],
  ] as const)("maps HTTP failures to a stable client code", async (response, code) => {
    serverFetch.mockResolvedValue(response);

    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code }));
  });

  it("maps a sanitized provider stream error", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: error\ndata: {"code":"PROVIDER_STREAM_ERROR"}\n\n'),
    );

    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ChatClientError>>({ code: "PROVIDER_ERROR" }),
    );
  });

  it("rejects malformed or incomplete streams", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: delta\ndata: {"text":42}\n\n'),
    );

    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code: "STREAM_ERROR" }));
  });

  it("delivers a valid sources event before deltas exactly once", async () => {
    serverFetch.mockResolvedValue(
      sseResponse(
        'event: sources\ndata: {"sources":[{"title":"必应搜索结果一","url":"https://www.bing.com/"},{"title":"必应搜索结果二","url":"https://cn.bing.com/"}]}\n\n' +
          'event: delta\ndata: {"text":"基于搜索的回复"}\n\n' +
          'event: done\ndata: {"truncated":false}\n\n',
      ),
    );
    const calls: string[] = [];
    const onSources = vi.fn((sources: Array<{ title: string; url: string }>) => {
      calls.push("sources");
      expect(sources).toEqual([
        { title: "必应搜索结果一", url: "https://www.bing.com/" },
        { title: "必应搜索结果二", url: "https://cn.bing.com/" },
      ]);
    });

    await expect(
      streamChat(sampleRequest, {
        fetcher: serverFetch,
        onDelta: (text) => calls.push(`delta:${text}`),
        onSources,
      }),
    ).resolves.toEqual({ truncated: false });

    expect(onSources).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["sources", "delta:基于搜索的回复"]);
  });

  it.each([
    'event: sources\ndata: {"sources":{"title":"对象而非数组","url":"https://www.bing.com/"}}\n\n',
    'event: sources\ndata: {"sources":[{"title":42,"url":"https://www.bing.com/"}]}\n\n',
    'event: sources\ndata: {"sources":[{"title":"缺少 url"}]}\n\n',
    'event: sources\ndata: {"sources":[null]}\n\n',
    'event: sources\ndata: {"other":[]}\n\n',
  ])("rejects malformed sources payloads (%s)", async (stream) => {
    serverFetch.mockResolvedValue(sseResponse(stream + 'event: done\ndata: {"truncated":false}\n\n'));

    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn(), onSources: vi.fn() }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code: "STREAM_ERROR" }));
  });

  it("validates sources payloads even when no onSources callback is provided", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: sources\ndata: {"sources":"invalid"}\n\n'),
    );

    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code: "STREAM_ERROR" }));
  });

  it("forwards webSearch flag in the request body", async () => {
    serverFetch.mockResolvedValue(
      sseResponse('event: done\ndata: {"truncated":false}\n\n'),
    );

    await streamChat(
      { ...sampleRequest, webSearch: true },
      { fetcher: serverFetch, onDelta: vi.fn() },
    );

    expect(serverFetch).toHaveBeenCalledWith("/api/chat", {
      body: JSON.stringify({ ...sampleRequest, webSearch: true }),
      credentials: "same-origin",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      method: "POST",
      signal: undefined,
    });
  });

  it("distinguishes offline and aborted requests", async () => {
    serverFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      streamChat(sampleRequest, { fetcher: serverFetch, onDelta: vi.fn() }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code: "NETWORK_ERROR" }));

    const controller = new AbortController();
    controller.abort();
    serverFetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(
      streamChat(sampleRequest, {
        fetcher: serverFetch,
        onDelta: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<ChatClientError>>({ code: "ABORTED" }));
  });
});
