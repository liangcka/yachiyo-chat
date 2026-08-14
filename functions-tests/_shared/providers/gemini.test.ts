import { describe, expect, it } from "vitest";
import type { ClientChatRequest } from "../../../functions/_shared/validation";
import {
  buildGeminiAdapter,
  buildGeminiBody,
  extractGeminiDeltaText,
} from "../../../functions/_shared/providers/gemini";

const textRequest: ClientChatRequest = {
  locale: "zh-CN",
  messages: [
    { role: "assistant", text: "彩叶~" },
    { role: "user", text: "今天有点累" },
  ],
};

describe("buildGeminiBody", () => {
  it("maps history to Gemini contents with systemInstruction and generationConfig", () => {
    const body = buildGeminiBody(textRequest) as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      systemInstruction: { parts: Array<{ text: string }> };
      generationConfig: { maxOutputTokens: number };
    };

    expect(body.contents).toEqual([
      { role: "model", parts: [{ text: "彩叶~" }] },
      { role: "user", parts: [{ text: "今天有点累" }] },
    ]);
    expect(body.systemInstruction.parts[0]?.text).toContain("月见八千代");
    expect(body.generationConfig.maxOutputTokens).toBe(2048);
  });

  it("sets 1024 maxOutputTokens and summary prompt for summary mode", () => {
    const body = buildGeminiBody({ ...textRequest, mode: "summary" }) as {
      systemInstruction: { parts: Array<{ text: string }> };
      generationConfig: { maxOutputTokens: number };
    };
    expect(body.systemInstruction.parts[0]?.text).toContain("记忆总结助手");
    expect(body.generationConfig.maxOutputTokens).toBe(1024);
  });

  it("maps image data URLs into Gemini inlineData parts", () => {
    const imageDataUrl = "data:image/jpeg;base64,/9j/4AAQ";
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "看图", imageDataUrl }],
    };
    const body = buildGeminiBody(request) as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };

    expect(body.contents[0]?.parts).toEqual([
      { text: "看图" },
      { inlineData: { mimeType: "image/jpeg", data: "/9j/4AAQ" } },
    ]);
  });
});

describe("extractGeminiDeltaText", () => {
  it("joins text parts from candidates", () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "彩叶" }, { text: "辛苦啦" }], role: "model" } }],
    });
    expect(extractGeminiDeltaText(data)).toBe("彩叶辛苦啦");
  });

  it("returns null for [DONE] and empty candidates", () => {
    expect(extractGeminiDeltaText("[DONE]")).toBeNull();
    const empty = JSON.stringify({ candidates: [] });
    expect(extractGeminiDeltaText(empty)).toBeNull();
  });

  it("throws on malformed data", () => {
    expect(() => extractGeminiDeltaText("not-json")).toThrow(TypeError);
  });
});

describe("buildGeminiAdapter", () => {
  const adapter = buildGeminiAdapter();

  it("exposes the gemini provider metadata", () => {
    expect(adapter.id).toBe("gemini");
    expect(adapter.isOpenAICompat).toBe(false);
    expect(adapter.supportsImage).toBe(true);
    expect(adapter.defaultModel).toBe("gemini-3.6-flash");
    expect(adapter.allowedModels).toContain("gemini-3.5-flash");
  });

  it("builds a streamGenerateContent URL with x-goog-api-key header", () => {
    const built = adapter.buildRequest({
      request: textRequest,
      apiKey: "AIza" + "a".repeat(35),
      model: "gemini-3.6-flash",
    });

    expect(built.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse",
    );
    expect(built.headers["x-goog-api-key"]).toMatch(/^AIza/u);
    expect(built.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(built.body) as { contents: unknown[]; generationConfig: { maxOutputTokens: number } };
    expect(Array.isArray(body.contents)).toBe(true);
    expect(body.generationConfig.maxOutputTokens).toBe(2048);
  });
});
