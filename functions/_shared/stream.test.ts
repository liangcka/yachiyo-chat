import { describe, expect, it, vi } from "vitest";
import { collectClientEvents, proxyStepFunStream } from "./stream";

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
});
