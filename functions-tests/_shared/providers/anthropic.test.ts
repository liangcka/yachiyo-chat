import { describe, expect, it } from "vitest";
import type { ClientChatRequest } from "../../../functions/_shared/validation";
import {
  buildAnthropicAdapter,
  buildAnthropicBody,
  extractAnthropicDeltaText,
} from "../../../functions/_shared/providers/anthropic";

const textRequest: ClientChatRequest = {
  locale: "zh-CN",
  messages: [
    { role: "assistant", text: "彩叶~" },
    { role: "user", text: "今天有点累" },
  ],
};

describe("buildAnthropicBody", () => {
  it("drops leading assistant message so history starts with user and lifts system prompt", () => {
    const body = buildAnthropicBody(textRequest, "claude-sonnet-5") as {
      model: string;
      system: string;
      messages: Array<{ role: string; content: unknown }>;
      stream: boolean;
      max_tokens: number;
    };

    expect(body.model).toBe("claude-sonnet-5");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(2048);
    expect(typeof body.system).toBe("string");
    expect(body.system).toContain("月见八千代");
    expect(body.messages).toEqual([
      { role: "user", content: "今天有点累" },
    ]);
  });

  it("merges adjacent same-role messages to enforce strict user/assistant alternation", () => {
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [
        { role: "user", text: "前情提要记忆" },
        { role: "assistant", text: "已记住记忆" },
        { role: "assistant", text: "彩叶~" },
        { role: "user", text: "第一句" },
        { role: "user", text: "第二句" },
      ],
    };
    const body = buildAnthropicBody(request, "claude-sonnet-5") as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages).toEqual([
      { role: "user", content: "前情提要记忆" },
      { role: "assistant", content: "已记住记忆\n\n彩叶~" },
      { role: "user", content: "第一句\n\n第二句" },
    ]);
  });

  it("maps image data URLs into Anthropic image blocks and merges image blocks for adjacent user turns", () => {
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [
        { role: "user", text: "看图", imageDataUrl },
        { role: "user", text: "好看吗？" },
      ],
    };
    const body = buildAnthropicBody(request, "claude-sonnet-5") as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "看图" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
        { type: "text", text: "好看吗？" },
      ],
    });
  });
});

describe("extractAnthropicDeltaText", () => {
  it("reads text from content_block_delta events", () => {
    const data = JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "彩叶" },
    });
    expect(extractAnthropicDeltaText(data)).toBe("彩叶");
  });

  it("returns null for non-delta events and [DONE]", () => {
    expect(extractAnthropicDeltaText("[DONE]")).toBeNull();
    const start = JSON.stringify({ type: "message_start", message: {} });
    expect(extractAnthropicDeltaText(start)).toBeNull();
  });

  it("throws on malformed data", () => {
    expect(() => extractAnthropicDeltaText("not-json")).toThrow(TypeError);
  });
});

describe("buildAnthropicAdapter", () => {
  const adapter = buildAnthropicAdapter();

  it("exposes the claude provider metadata", () => {
    expect(adapter.id).toBe("claude");
    expect(adapter.isOpenAICompat).toBe(false);
    expect(adapter.supportsImage).toBe(true);
    expect(adapter.defaultModel).toBe("claude-sonnet-5");
    expect(adapter.allowedModels).toContain("claude-opus-5");
  });

  it("builds an x-api-key authenticated request with anthropic-version", () => {
    const built = adapter.buildRequest({
      request: textRequest,
      apiKey: "sk-ant-" + "a".repeat(40),
      model: "claude-sonnet-5",
    });

    expect(built.url).toBe("https://api.anthropic.com/v1/messages");
    expect(built.headers["x-api-key"]).toMatch(/^sk-ant-/u);
    expect(built.headers["anthropic-version"]).toBe("2023-06-01");
    expect(built.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(built.body) as { model: string; stream: boolean; system: string };
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.stream).toBe(true);
    expect(typeof body.system).toBe("string");
  });
});
