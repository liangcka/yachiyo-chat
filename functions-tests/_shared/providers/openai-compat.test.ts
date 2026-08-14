import { describe, expect, it } from "vitest";
import type { ClientChatRequest } from "../../../functions/_shared/validation";
import {
  buildOpenAICompatAdapter,
  buildOpenAICompatBody,
  extractOpenAIDeltaText,
} from "../../../functions/_shared/providers/openai-compat";

const textRequest: ClientChatRequest = {
  locale: "zh-CN",
  messages: [
    { role: "assistant", text: "彩叶~" },
    { role: "user", text: "今天有点累" },
  ],
};

describe("buildOpenAICompatBody", () => {
  it("maps history to OpenAI chat completions format with system prompt", () => {
    const body = buildOpenAICompatBody(textRequest, "gpt-5.6-luna", true) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
      stream: boolean;
      max_tokens: number;
    };

    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(2048);
    expect(body.messages[0]?.role).toBe("system");
    expect(typeof body.messages[0]?.content).toBe("string");
    expect(body.messages.slice(1)).toEqual([
      { role: "assistant", content: "彩叶~" },
      { role: "user", content: "今天有点累" },
    ]);
  });

  it("emits image content parts when the provider supports images", () => {
    const imageDataUrl = "data:image/webp;base64,UklGRgAAAABXRUJQ";
    const request: ClientChatRequest = {
      locale: "ja-JP",
      messages: [{ role: "user", text: "これは何？", imageDataUrl }],
    };
    const body = buildOpenAICompatBody(request, "gpt-5.6-luna", true) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "これは何？" },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    });
  });

  it("drops the image part when the provider does not support images", () => {
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "看图", imageDataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
    };
    const body = buildOpenAICompatBody(request, "deepseek-chat", false) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages[1]).toEqual({ role: "user", content: "看图" });
  });
});

describe("extractOpenAIDeltaText", () => {
  it("reads content from OpenAI-style delta events", () => {
    const data = JSON.stringify({ choices: [{ delta: { content: "彩叶" } }] });
    expect(extractOpenAIDeltaText(data)).toBe("彩叶");
  });

  it("returns null for [DONE] and empty content", () => {
    expect(extractOpenAIDeltaText("[DONE]")).toBeNull();
    const empty = JSON.stringify({ choices: [{ delta: { content: "" } }] });
    expect(extractOpenAIDeltaText(empty)).toBeNull();
  });

  it("returns null when choices are absent", () => {
    const noChoices = JSON.stringify({ choices: [] });
    expect(extractOpenAIDeltaText(noChoices)).toBeNull();
  });

  it("throws on malformed data", () => {
    expect(() => extractOpenAIDeltaText("not-json")).toThrow(TypeError);
    expect(() => extractOpenAIDeltaText(JSON.stringify({ error: "x" }))).toThrow(TypeError);
  });
});

describe("buildOpenAICompatAdapter", () => {
  const adapter = buildOpenAICompatAdapter("openai", {
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-5.6-luna",
    allowedModels: ["gpt-5.6-luna", "gpt-5.6-sol"],
    supportsImage: true,
    imageModels: ["gpt-5.6-luna", "gpt-5.6-sol"],
  });

  it("exposes the provider metadata", () => {
    expect(adapter.id).toBe("openai");
    expect(adapter.isOpenAICompat).toBe(true);
    expect(adapter.supportsImage).toBe(true);
    expect(adapter.imageModels).toEqual(["gpt-5.6-luna", "gpt-5.6-sol"]);
    expect(adapter.defaultModel).toBe("gpt-5.6-luna");
    expect(adapter.allowedModels).toEqual(["gpt-5.6-luna", "gpt-5.6-sol"]);
  });

  it("builds a Bearer-authenticated streaming request", () => {
    const built = adapter.buildRequest({
      request: textRequest,
      apiKey: "sk-" + "a".repeat(40),
      model: "gpt-5.6-luna",
    });

    expect(built.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(built.headers.authorization).toMatch(/^Bearer sk-/u);
    expect(built.headers.accept).toBe("text/event-stream");
    expect(built.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(built.body) as { model: string; stream: boolean };
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.stream).toBe(true);
  });
});
