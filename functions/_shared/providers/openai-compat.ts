import { buildSystemPrompt } from "../prompt";
import type { ClientChatRequest, ClientHistoryMessage } from "../validation";
import type { BuiltProviderRequest, ProviderAdapter, ProviderRequestInput } from "./registry";

export interface OpenAICompatConfig {
  readonly endpoint: string;
  readonly defaultModel: string;
  readonly allowedModels: readonly string[];
  readonly supportsImage: boolean;
  readonly imageModels: readonly string[];
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
  request: ClientChatRequest,
  model: string,
  supportsImage: boolean,
): unknown {
  return {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(request.locale, request.mode) },
      ...request.messages.map((message) => mapHistoryMessage(message, request.locale, supportsImage)),
    ],
    stream: true,
    max_tokens: request.mode === "summary" ? 1024 : 2048,
  };
}

export function extractOpenAIDeltaText(data: string): string | null {
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
  const choices = (parsed as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    throw new TypeError("Invalid OpenAI SSE data");
  }
  const delta = (first as Record<string, unknown>).delta;
  if (typeof delta !== "object" || delta === null) return null;
  const content = (delta as Record<string, unknown>).content;
  if (content === undefined || content === null || content === "") return null;
  if (typeof content !== "string") {
    throw new TypeError("Invalid OpenAI SSE data");
  }
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
      const body = buildOpenAICompatBody(input.request, input.model, config.supportsImage);
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
  };
}
