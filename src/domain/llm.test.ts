import { describe, expect, it } from "vitest";
import {
  DOMESTIC_PROVIDERS,
  INTERNATIONAL_PROVIDERS,
  PROVIDER_IDS,
  PROVIDER_METADATA,
  formatModelDisplayName,
  getProviderMeta,
  isProviderId,
  isValidApiKey,
} from "./llm";

describe("ProviderId", () => {
  it("exposes six supported providers", () => {
    expect(PROVIDER_IDS).toEqual(["stepfun", "deepseek", "glm", "openai", "claude", "gemini"]);
  });

  it("narrows known ids and rejects unknown values", () => {
    expect(isProviderId("openai")).toBe(true);
    expect(isProviderId("claude")).toBe(true);
    expect(isProviderId("unknown")).toBe(false);
    expect(isProviderId(123)).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
  });
});

describe("PROVIDER_METADATA", () => {
  it("covers every provider id", () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_METADATA[id]).toBeDefined();
      expect(PROVIDER_METADATA[id].id).toBe(id);
    }
  });

  it("keeps defaultModel within each model list", () => {
    for (const id of PROVIDER_IDS) {
      const meta = PROVIDER_METADATA[id];
      expect(meta.models).toContain(meta.defaultModel);
    }
  });

  it("splits providers into domestic and international groups", () => {
    expect(DOMESTIC_PROVIDERS).toEqual(["stepfun", "deepseek", "glm"]);
    expect(INTERNATIONAL_PROVIDERS).toEqual(["openai", "claude", "gemini"]);
    expect([...DOMESTIC_PROVIDERS, ...INTERNATIONAL_PROVIDERS].sort()).toEqual(
      [...PROVIDER_IDS].sort(),
    );
  });

  it("reports image support flags aligned with backend", () => {
    expect(PROVIDER_METADATA.stepfun.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.deepseek.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.glm.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.openai.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.claude.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.gemini.supportsImage).toBe(true);
  });

  it("limits imageModels to the models that actually accept images", () => {
    expect(PROVIDER_METADATA.stepfun.imageModels).toEqual(["step-5-preview", "step-3.7-flash"]);
    expect(PROVIDER_METADATA.deepseek.imageModels).toEqual(["deepseek-flash"]);
    expect(PROVIDER_METADATA.glm.imageModels).toEqual(["glm-5.3-flash", "glm-4.6v-flash"]);
    for (const id of PROVIDER_IDS) {
      for (const model of PROVIDER_METADATA[id].imageModels) {
        expect(PROVIDER_METADATA[id].models).toContain(model);
      }
      if (PROVIDER_METADATA[id].recommendedModel !== undefined) {
        expect(PROVIDER_METADATA[id].models).toContain(PROVIDER_METADATA[id].recommendedModel);
      }
      if (PROVIDER_METADATA[id].freeModels !== undefined) {
        for (const model of PROVIDER_METADATA[id].freeModels!) {
          expect(PROVIDER_METADATA[id].models).toContain(model);
        }
      }
    }
  });

  it("getProviderMeta returns the matching metadata", () => {
    expect(getProviderMeta("glm").label).toBe("智谱 GLM");
  });
});

describe("isValidApiKey", () => {
  it("accepts printable ASCII strings within length bounds", () => {
    expect(isValidApiKey("sk-" + "a".repeat(20))).toBe(true);
    expect(isValidApiKey("sk-ant-api03-abcdef0123456789")).toBe(true);
  });

  it("rejects too short, too long, and non-ASCII values", () => {
    expect(isValidApiKey("short")).toBe(false);
    expect(isValidApiKey("a".repeat(600))).toBe(false);
    expect(isValidApiKey("含中文的key-abcdefghij")).toBe(false);
    // 内部会 trim，两侧空格不影响判定
    expect(isValidApiKey("  " + "a".repeat(20) + "  ")).toBe(true);
  });
});

describe("formatModelDisplayName", () => {
  it("formats GLM models in uppercase and charGLM-4 with GLM uppercase", () => {
    expect(formatModelDisplayName("glm-5.3")).toBe("GLM-5.3");
    expect(formatModelDisplayName("glm-5.3-flash")).toBe("GLM-5.3-flash");
    expect(formatModelDisplayName("glm-4.6v-flash")).toBe("GLM-4.6v-flash");
    expect(formatModelDisplayName("charglm-4")).toBe("charGLM-4");
  });

  it("formats Gemini models with capitalized first letter", () => {
    expect(formatModelDisplayName("gemini-3.8-flash")).toBe("Gemini-3.8-flash");
    expect(formatModelDisplayName("gemini-3.7-flash")).toBe("Gemini-3.7-flash");
    expect(formatModelDisplayName("gemini-3.1-pro")).toBe("Gemini-3.1-pro");
  });

  it("formats Claude models with capitalized first letter", () => {
    expect(formatModelDisplayName("claude-sonnet-5-5")).toBe("Claude-sonnet-5-5");
    expect(formatModelDisplayName("claude-opus-5-5")).toBe("Claude-opus-5-5");
    expect(formatModelDisplayName("claude-haiku-5")).toBe("Claude-haiku-5");
  });

  it("formats GPT models in uppercase GPT with lowercase model suffix", () => {
    expect(formatModelDisplayName("gpt-6-luna")).toBe("GPT-6-luna");
    expect(formatModelDisplayName("gpt-5.6-sol")).toBe("GPT-5.6-sol");
    expect(formatModelDisplayName("gpt-6.1-sol")).toBe("GPT-6.1-sol");
  });

  it("keeps step, deepseek and other models in lowercase", () => {
    expect(formatModelDisplayName("step-3.7-flash")).toBe("step-3.7-flash");
    expect(formatModelDisplayName("step-5-preview")).toBe("step-5-preview");
    expect(formatModelDisplayName("deepseek-flash")).toBe("deepseek-flash");
    expect(formatModelDisplayName("deepseek-v4-pro")).toBe("deepseek-v4-pro");
  });

  it("normalizes uppercase inputs according to formatting rules", () => {
    expect(formatModelDisplayName("GLM-5.3")).toBe("GLM-5.3");
    expect(formatModelDisplayName("GEMINI-3.8-FLASH")).toBe("Gemini-3.8-flash");
    expect(formatModelDisplayName("CLAUDE-SONNET-5-5")).toBe("Claude-sonnet-5-5");
    expect(formatModelDisplayName("GPT-6-LUNA")).toBe("GPT-6-luna");
    expect(formatModelDisplayName("STEP-3.7-FLASH")).toBe("step-3.7-flash");
  });
});

