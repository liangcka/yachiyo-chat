import { describe, expect, it } from "vitest";
import { ChatValidationError, validateChatRequest } from "./validation";

const smallPng = "data:image/png;base64,iVBORw0KGgo=";

function validRequest(): unknown {
  return {
    locale: "zh-CN",
    messages: [
      { role: "assistant", text: "彩叶~今天也辛苦啦！" },
      { role: "user", text: "陪我聊一会儿吧" },
    ],
  };
}

describe("validateChatRequest", () => {
  it("accepts bounded text and one image on the last user message", () => {
    const result = validateChatRequest({
      locale: "ja-JP",
      messages: [{ role: "user", text: "", imageDataUrl: smallPng }],
    });

    expect(result).toEqual({
      locale: "ja-JP",
      messages: [{ role: "user", text: "", imageDataUrl: smallPng }],
    });
  });

  it("rejects unknown fields at every input level", () => {
    expect(() =>
      validateChatRequest({ ...(validRequest() as object), debug: true }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: [{ role: "user", text: "你好", hidden: "value" }],
      }),
    ).toThrow(ChatValidationError);
  });

  it("enforces message, per-message, and total Unicode bounds", () => {
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: Array.from({ length: 21 }, (_, index) => ({
          role: index === 20 ? "user" : "assistant",
          text: "好",
        })),
      }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: [{ role: "user", text: "🌙".repeat(4_001) }],
      }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: Array.from({ length: 7 }, (_, index) => ({
          role: index === 6 ? "user" : "assistant",
          text: "八".repeat(4_000),
        })),
      }),
    ).toThrow(ChatValidationError);
  });

  it("rejects misplaced, unsupported, and oversized images", () => {
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: [
          { role: "user", text: "旧图", imageDataUrl: smallPng },
          { role: "user", text: "现在" },
        ],
      }),
    ).toThrow(ChatValidationError);
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: [
          { role: "user", text: "看看", imageDataUrl: "data:image/gif;base64,R0lGODlh" },
        ],
      }),
    ).toThrow(ChatValidationError);

    const oversizedBase64 = "A".repeat(2_796_208);
    expect(() =>
      validateChatRequest({
        locale: "zh-CN",
        messages: [
          {
            role: "user",
            text: "看看",
            imageDataUrl: `data:image/jpeg;base64,${oversizedBase64}`,
          },
        ],
      }),
    ).toThrow(ChatValidationError);
  });
});
