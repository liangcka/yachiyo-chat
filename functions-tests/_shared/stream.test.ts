import { describe, expect, it, vi } from "vitest";
import { collectClientEvents, proxyStepFunStream } from "../../functions/_shared/stream";

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
});
