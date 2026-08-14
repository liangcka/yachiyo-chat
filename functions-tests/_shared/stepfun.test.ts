import { describe, expect, it } from "vitest";
import type { ClientChatRequest } from "../../functions/_shared/validation";
import { buildStepFunBody, resolveStepFunConfiguration } from "../../functions/_shared/stepfun";

describe("buildStepFunBody", () => {
  it("maps text history to a low-effort streaming request", () => {
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [
        { role: "assistant", text: "彩叶~" },
        { role: "user", text: "今天有点累" },
      ],
    };

    const body = buildStepFunBody(request, "step-3.7-flash");

    expect(body).toMatchObject({
      model: "step-3.7-flash",
      stream: true,
      reasoning_effort: "low",
      max_tokens: 2048,
    });
    expect(body.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("月见八千代"),
    });
    expect(body.messages.slice(1)).toEqual([
      { role: "assistant", content: "彩叶~" },
      { role: "user", content: "今天有点累" },
    ]);
  });

  it("maps an image to OpenAI content parts and medium effort", () => {
    const imageDataUrl = "data:image/webp;base64,UklGRgAAAABXRUJQ";
    const request: ClientChatRequest = {
      locale: "ja-JP",
      messages: [{ role: "user", text: "これは何？", imageDataUrl }],
    };

    const body = buildStepFunBody(request, "step-3.7-flash");

    expect(body.reasoning_effort).toBe("medium");
    expect(body.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "これは何？" },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    });
  });

  it("accepts only the fixed Step Plan endpoint and requested model", () => {
    const valid = {
      STEPFUN_API_KEY: "test-key",
      STEPFUN_BASE_URL: "https://api.stepfun.com/step_plan/v1",
      STEPFUN_MODEL: "step-3.7-flash",
    };

    expect(resolveStepFunConfiguration(valid)).toEqual({
      endpoint: "https://api.stepfun.com/step_plan/v1/chat/completions",
      apiKey: "test-key",
      model: "step-3.7-flash",
    });
    expect(
      resolveStepFunConfiguration({
        ...valid,
        STEPFUN_BASE_URL: "https://attacker.test/step_plan/v1",
      }),
    ).toBeNull();
    expect(
      resolveStepFunConfiguration({ ...valid, STEPFUN_MODEL: "step-router-v1" }),
    ).toBeNull();
  });
});
