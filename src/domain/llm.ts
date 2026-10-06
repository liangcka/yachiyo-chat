/**
 * 前端 LLM 厂商领域模型。
 *
 * 注意：本文件的 ProviderId/默认模型/可选模型/图片支持标志必须与
 * functions/_shared/providers/registry.ts 的 PROVIDERS 保持一致。
 * 前后端物理分离（src 与 functions 不互相 import），此处为 API 契约的镜像。
 */

export type ProviderId = "stepfun" | "deepseek" | "glm" | "openai" | "claude" | "gemini";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "stepfun",
  "deepseek",
  "glm",
  "openai",
  "claude",
  "gemini",
];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

export type ProviderGroup = "domestic" | "international";

export interface LlmProviderMeta {
  readonly id: ProviderId;
  readonly group: ProviderGroup;
  readonly label: string;
  readonly models: readonly string[];
  readonly defaultModel: string;
  /** 厂商官方/社区首选推荐模型，在 UI 中展示推荐图标与高亮标 */
  readonly recommendedModel?: string;
  /** 厂商提供的免费调用模型列表，在 UI 中展示免费徽章 */
  readonly freeModels?: readonly string[];
  /** 该厂商是否存在支持图片输入的视觉模型(设置面板提示用) */
  readonly supportsImage: boolean;
  /** 可发送图片的具体模型白名单;拍照/发图能力按所选模型判断 */
  readonly imageModels: readonly string[];
  readonly apiKeyHint: string;
}

export const PROVIDER_METADATA: Readonly<Record<ProviderId, LlmProviderMeta>> = Object.freeze({
  stepfun: {
    id: "stepfun",
    group: "domestic",
    label: "阶跃星辰 StepFun（Step Plan）",
    models: ["step-5-preview", "step-3.7-flash", "step-3.5-flash", "step-3.5-flash-2603"],
    defaultModel: "step-3.7-flash",
    recommendedModel: "step-3.7-flash",
    supportsImage: true,
    imageModels: ["step-5-preview", "step-3.7-flash"],
    apiKeyHint: "在 StepFun Step Plan 控制台获取 API Key",
  },
  deepseek: {
    id: "deepseek",
    group: "domestic",
    label: "DeepSeek",
    models: [
      "deepseek-flash",
      "deepseek-v4-pro",
    ],
    defaultModel: "deepseek-flash",
    recommendedModel: "deepseek-flash",
    supportsImage: true,
    imageModels: ["deepseek-flash"],
    apiKeyHint: "在 platform.deepseek.com 获取 API Key",
  },
  glm: {
    id: "glm",
    group: "domestic",
    label: "智谱 GLM",
    models: [
      "charglm-4",
      "glm-5.3",
      "glm-5.3-flash",
      "glm-4.6v-flash",
    ],
    defaultModel: "charglm-4",
    recommendedModel: "charglm-4",
    freeModels: ["glm-4.6v-flash"],
    supportsImage: true,
    imageModels: ["glm-5.3-flash", "glm-4.6v-flash"],
    apiKeyHint: "在 open.bigmodel.cn 控制台获取 API Key",
  },
  openai: {
    id: "openai",
    group: "international",
    label: "OpenAI (GPT)",
    models: [
      "gpt-6-astra",
      "gpt-6.1-sol",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ],
    defaultModel: "gpt-6-luna",
    recommendedModel: "gpt-6-luna",
    supportsImage: true,
    imageModels: [
      "gpt-6-astra",
      "gpt-6.1-sol",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ],
    apiKeyHint: "在 platform.openai.com 获取 API Key",
  },
  claude: {
    id: "claude",
    group: "international",
    label: "Anthropic (Claude)",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5"],
    defaultModel: "claude-sonnet-5-5",
    recommendedModel: "claude-sonnet-5-5",
    supportsImage: true,
    imageModels: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5"],
    apiKeyHint: "在 console.anthropic.com 获取 API Key",
  },
  gemini: {
    id: "gemini",
    group: "international",
    label: "Google (Gemini)",
    models: [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro",
      "gemini-3.1-flash-lite",
    ],
    defaultModel: "gemini-3.8-flash",
    recommendedModel: "gemini-3.8-flash",
    supportsImage: true,
    imageModels: [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro",
      "gemini-3.1-flash-lite",
    ],
    apiKeyHint: "在 aistudio.google.com 获取 API Key",
  },
});

export const DOMESTIC_PROVIDERS: readonly ProviderId[] = PROVIDER_IDS.filter(
  (id) => PROVIDER_METADATA[id].group === "domestic",
);
export const INTERNATIONAL_PROVIDERS: readonly ProviderId[] = PROVIDER_IDS.filter(
  (id) => PROVIDER_METADATA[id].group === "international",
);

export function getProviderMeta(id: ProviderId): LlmProviderMeta {
  return PROVIDER_METADATA[id];
}

/** IndexedDB llmSettings 表中每家厂商的配置记录 */
export interface LlmSettingsRecord {
  readonly provider: ProviderId;
  readonly apiKey: string;
  readonly model: string;
  readonly updatedAt: number;
}

/** 发送聊天请求时携带的激活配置（未配置 Key 时为 undefined，走服务端 fallback） */
export interface ActiveLlmConfig {
  readonly provider: ProviderId;
  readonly apiKey: string;
  readonly model: string;
}

/** 前端 API Key 宽松校验：非空、长度 20-512、可打印 ASCII（与后端 isValidApiKey 对齐） */
export function isValidApiKey(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 20 || trimmed.length > 512) return false;
  return /^[\x20-\x7E]+$/u.test(trimmed);
}

/**
 * 格式化模型在 UI 界面中的展示名称。
 *
 * 大小写规范：
 * - GLM 保持全大写（如 GLM-5.3、GLM-5.3-flash、GLM-4.6v-flash、charGLM-4）
 * - GPT 保持全大写（如 GPT-6-luna、GPT-5.6-sol）
 * - Gemini 开头首字母大写（如 Gemini-3.8-flash）
 * - Claude 开头首字母大写（如 Claude-sonnet-5-5）
 * - step 保持全小写（如 step-3.7-flash）
 * - 其他模型（如 deepseek 等）及型号后缀一律全小写（如 deepseek-flash）
 */
export function formatModelDisplayName(model: string): string {
  if (!model) return "";
  const lower = model.toLowerCase();
  if (lower === "charglm" || lower.startsWith("charglm-")) {
    return `charGLM${lower.slice(7)}`;
  }
  if (lower === "glm" || lower.startsWith("glm-")) {
    return `GLM${lower.slice(3)}`;
  }
  if (lower === "gpt" || lower.startsWith("gpt-")) {
    return `GPT${lower.slice(3)}`;
  }
  if (lower === "gemini" || lower.startsWith("gemini-")) {
    return `Gemini${lower.slice(6)}`;
  }
  if (lower === "claude" || lower.startsWith("claude-")) {
    return `Claude${lower.slice(6)}`;
  }
  return lower;
}

