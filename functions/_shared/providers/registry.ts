import { type ClientChatRequest, type ProviderId, PROVIDER_IDS, isProviderId } from "../validation";
import type { EnrichedChatRequest } from "../web-search";
import { buildOpenAICompatAdapter } from "./openai-compat";
import { buildAnthropicAdapter } from "./anthropic";
import { buildGeminiAdapter } from "./gemini";

export { type ProviderId, PROVIDER_IDS, isProviderId };

export interface ProviderRequestInput {
  request: EnrichedChatRequest;
  apiKey: string;
  model: string;
}

/** 搜索意图判断请求的输入：简短 judge prompt + 最近若干轮纯文本消息 */
export interface JudgeRequestInput {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ReadonlyArray<{ role: "user" | "assistant"; text: string }>;
}

export interface BuiltProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  /** true 表示 upstream SSE 已是 OpenAI 兼容格式，可直接复用通用解析器 */
  readonly isOpenAICompat: boolean;
  /** 该厂商是否存在支持图片输入的视觉模型 */
  readonly supportsImage: boolean;
  /** 可发送图片的具体模型白名单；后端按所选模型校验图片请求 */
  readonly imageModels: readonly string[];
  readonly defaultModel: string;
  readonly allowedModels: readonly string[];
  buildRequest(input: ProviderRequestInput): BuiltProviderRequest;
  /** 解析 upstream SSE 的单条 data，返回增量文本；null 表示无内容或结束信号 */
  extractDeltaText(data: string): string | null;
  /** 构造非流式的搜索意图判断请求（小 token 预算、低思考档位） */
  buildJudgeRequest(input: JudgeRequestInput): BuiltProviderRequest;
  /** 解析非流式判断响应 JSON 的完整文本；null 表示无内容 */
  extractJudgeText(responseJson: string): string | null;
}

const openaiCompatProviders = {
  stepfun: {
    endpoint: "https://api.stepfun.com/step_plan/v1/chat/completions",
    defaultModel: "step-3.7-flash",
    allowedModels: ["step-3.7-flash", "step-3.5-flash", "step-3.5-flash-2603"],
    supportsImage: true,
    imageModels: ["step-3.7-flash"],
    reasoningEffort: true,
  },
  deepseek: {
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    defaultModel: "deepseek-v4-flash",
    allowedModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
    supportsImage: false,
    imageModels: [],
  },
  glm: {
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    defaultModel: "glm-4.7-flash",
    allowedModels: ["glm-5.2", "glm-4.7-flash", "glm-4.6", "glm-4.6v-flash", "glm-4v-flash"],
    supportsImage: true,
    imageModels: ["glm-4.6v-flash", "glm-4v-flash"],
  },
  openai: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-5.6-luna",
    allowedModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-4.1", "gpt-4.1-mini"],
    supportsImage: true,
    imageModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-4.1", "gpt-4.1-mini"],
  },
} as const;

export const PROVIDERS: Readonly<Record<ProviderId, ProviderAdapter>> = Object.freeze({
  stepfun: buildOpenAICompatAdapter("stepfun", openaiCompatProviders.stepfun),
  deepseek: buildOpenAICompatAdapter("deepseek", openaiCompatProviders.deepseek),
  glm: buildOpenAICompatAdapter("glm", openaiCompatProviders.glm),
  openai: buildOpenAICompatAdapter("openai", openaiCompatProviders.openai),
  claude: buildAnthropicAdapter(),
  gemini: buildGeminiAdapter(),
});

export function getProvider(id: ProviderId): ProviderAdapter {
  return PROVIDERS[id];
}

export function isAllowedModel(provider: ProviderAdapter, model: unknown): model is string {
  return typeof model === "string" && (provider.allowedModels as readonly string[]).includes(model);
}

export function isValidApiKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 20 || trimmed.length > 512) return false;
  // 仅允许可打印 ASCII，避免注入与控制字符
  return /^[\x20-\x7E]+$/u.test(trimmed);
}

export type { ClientChatRequest };
