import { buildSystemPrompt } from "../prompt";
import type { ExtractedDelta, TokenUsage } from "../stream";
import type { ClientChatRequest, ClientHistoryMessage } from "../validation";
import type { EnrichedChatRequest } from "../web-search";
import type {
  BuiltProviderRequest,
  JudgeRequestInput,
  ProviderAdapter,
  ProviderRequestInput,
} from "./registry";

export interface OpenAICompatConfig {
  readonly endpoint: string;
  readonly defaultModel: string;
  readonly allowedModels: readonly string[];
  readonly supportsImage: boolean;
  readonly imageModels: readonly string[];
  /** 该 provider 的模型为推理型且支持 OpenAI 风格 reasoning_effort 参数（思考 token 计入 max_tokens，需显式控制） */
  readonly reasoningEffort?: boolean;
  /** 该 provider 支持 DeepSeek 原生思考协议（thinking: { type: "enabled"|"disabled" } 与 reasoning_effort 控制） */
  readonly deepseekThinking?: boolean;
  /** 该 provider 支持智谱 GLM 思考协议与模型分流（对支持的模型启用 thinking，并在 judge 时抑制） */
  readonly glmThinking?: boolean;
  /** 显式采样 temperature（智谱角色扮演推荐 0.8，范围 [0.0, 1.0]；若未配置则使用上游默认） */
  readonly defaultTemperature?: number;
}

const GLM_THINKING_MODEL_PREFIXES = ["glm-5", "glm-4.7", "glm-4.6", "glm-4.5"];

/** 智谱 GLM 系列中支持深度思考（Thinking）协议的模型代号前缀判断 */
export function isGlmThinkingModel(model: string): boolean {
  return GLM_THINKING_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));
}

interface OpenAITextPart {
  type: "text";
  text: string;
}

interface OpenAIImagePart {
  type: "image_url";
  image_url: { url: string };
}

type OpenAIMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | Array<OpenAITextPart | OpenAIImagePart> };

function mapHistoryMessage(
  message: ClientHistoryMessage,
  locale: ClientChatRequest["locale"],
  supportsImage: boolean,
): OpenAIMessage {
  if (message.role === "assistant") {
    return { role: "assistant", content: message.text };
  }
  if (message.imageDataUrl === undefined || !supportsImage) {
    return { role: "user", content: message.text };
  }
  const text =
    message.text.length > 0
      ? message.text
      : locale === "ja-JP"
        ? "この画像を見てください。"
        : "请看看这张图片。";
  return {
    role: "user",
    content: [
      { type: "text", text },
      { type: "image_url", image_url: { url: message.imageDataUrl } },
    ],
  };
}

export function buildOpenAICompatBody(
  request: EnrichedChatRequest,
  model: string,
  supportsImage: boolean,
  reasoningEffort = false,
  deepseekThinking = false,
  glmThinking = false,
  defaultTemperature?: number,
): unknown {
  const containsImage = request.messages.some((message) => message.imageDataUrl !== undefined);
  const enableGlmThinking = glmThinking && isGlmThinkingModel(model);
  const enableThinking = deepseekThinking || enableGlmThinking;
  return {
    model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(request.locale, request.mode, {
          webSearch: request.webSearch,
          smartSearch: request.smartSearch,
          searchResults: request.searchResults,
          currentTime: request.currentTime,
          previousTime: request.previousTime,
          lastMessageIntervalMs: request.lastMessageIntervalMs,
          messages: request.messages,
          multiBubble: request.multiBubble,
        }),
      },
      ...request.messages.map((message) => mapHistoryMessage(message, request.locale, supportsImage)),
    ],
    stream: true,
    stream_options: { include_usage: true },
    // 推理模型的思考 token 计入 max_tokens 预算，过小会被思考耗尽导致正文为空
    max_tokens: request.mode === "summary" ? 4096 : 8192,
    ...(reasoningEffort ? { reasoning_effort: containsImage ? "medium" : "low" } : {}),
    ...(enableThinking
      ? {
          thinking: { type: "enabled" as const },
          reasoning_effort: containsImage ? "medium" : "high",
        }
      : {}),
    ...(typeof defaultTemperature === "number" ? { temperature: defaultTemperature } : {}),
  };
}

function isRawUsage(
  value: unknown,
): value is { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } {
  return typeof value === "object" && value !== null;
}

export function extractOpenAIDeltaText(data: string): ExtractedDelta {
  if (data === "[DONE]") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new TypeError("Invalid OpenAI SSE data");
  }
  if (typeof parsed !== "object" || parsed === null || "error" in parsed) {
    throw new TypeError("Invalid OpenAI SSE data");
  }
  const recordObj = parsed as Record<string, unknown>;
  let usage: TokenUsage | undefined;
  if (isRawUsage(recordObj.usage)) {
    const p = recordObj.usage.prompt_tokens;
    const c = recordObj.usage.completion_tokens;
    const t = recordObj.usage.total_tokens;
    usage = {
      ...(typeof p === "number" ? { promptTokens: p } : {}),
      ...(typeof c === "number" ? { completionTokens: c } : {}),
      ...(typeof t === "number" ? { totalTokens: t } : {}),
    };
  }

  const choices = recordObj.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return usage !== undefined ? { usage } : null;
  }
  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    throw new TypeError("Invalid OpenAI SSE data");
  }
  const delta = (first as Record<string, unknown>).delta;
  if (typeof delta !== "object" || delta === null) {
    throw new TypeError("Invalid OpenAI SSE data");
  }
  const deltaObj = delta as Record<string, unknown>;
  const content =
    typeof deltaObj.content === "string" && deltaObj.content.length > 0 ? deltaObj.content : null;
  const thought =
    typeof deltaObj.reasoning_content === "string" && deltaObj.reasoning_content.length > 0
      ? deltaObj.reasoning_content
      : typeof deltaObj.reasoning === "string" && deltaObj.reasoning.length > 0
        ? deltaObj.reasoning
        : null;

  if (content === null && thought === null && usage === undefined) {
    return null;
  }
  return {
    content,
    thought,
    ...(usage !== undefined ? { usage } : {}),
  };
}

/** 非流式 judge 响应：提取 choices[0].message.content 完整文本 */
export function extractOpenAIJudgeText(responseJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const choices = (parsed as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string" || content.length === 0) return null;
  return content;
}

export function buildOpenAICompatAdapter(
  id: ProviderAdapter["id"],
  config: OpenAICompatConfig,
): ProviderAdapter {
  return {
    id,
    isOpenAICompat: true,
    supportsImage: config.supportsImage,
    imageModels: config.imageModels,
    defaultModel: config.defaultModel,
    allowedModels: config.allowedModels,
    buildRequest(input: ProviderRequestInput): BuiltProviderRequest {
      const body = buildOpenAICompatBody(
        input.request,
        input.model,
        config.supportsImage,
        config.reasoningEffort === true,
        config.deepseekThinking === true,
        config.glmThinking === true,
        config.defaultTemperature,
      );
      return {
        url: config.endpoint,
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      };
    },
    extractDeltaText: extractOpenAIDeltaText,
    buildJudgeRequest(input: JudgeRequestInput): BuiltProviderRequest {
      const isGlmThinking = config.glmThinking === true && isGlmThinkingModel(input.model);
      const body = {
        model: input.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          ...input.messages.map((message) => ({ role: message.role, content: message.text })),
        ],
        stream: false,
        // 推理模型的思考 token 计入 max_tokens 预算，512 足够 YES/NO 输出
        max_tokens: 512,
        ...(config.reasoningEffort === true ? { reasoning_effort: "low" as const } : {}),
        ...(config.deepseekThinking === true
          ? {
              thinking: { type: "disabled" as const },
              reasoning_effort: "low" as const,
            }
          : {}),
        ...(isGlmThinking ? { reasoning_effort: "low" as const } : {}),
        // 判断类请求固定使用低温度保证判定稳定性
        temperature: 0.1,
      };
      return {
        url: config.endpoint,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      };
    },
    extractJudgeText: extractOpenAIJudgeText,
  };
}
