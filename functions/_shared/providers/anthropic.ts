import { buildSystemPrompt } from "../prompt";
import type { ExtractedDelta } from "../stream";
import type { ClientChatRequest, ClientHistoryMessage } from "../validation";
import type { EnrichedChatRequest } from "../web-search";
import type {
  BuiltProviderRequest,
  JudgeRequestInput,
  ProviderAdapter,
  ProviderRequestInput,
} from "./registry";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ALLOWED_MODELS = [
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
] as const;

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

type AnthropicContent = string | Array<AnthropicTextBlock | AnthropicImageBlock>;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContent;
}

function parseImageDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  if (match === null) return null;
  const ext = match[1];
  const base64 = match[2];
  if (ext === undefined || base64 === undefined) return null;
  const mediaType = ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  return { mediaType, data: base64 };
}

function mapHistoryMessage(
  message: ClientHistoryMessage,
  locale: ClientChatRequest["locale"],
): AnthropicMessage {
  if (message.role === "assistant") {
    return { role: "assistant", content: message.text };
  }
  if (message.imageDataUrl === undefined) {
    return { role: "user", content: message.text };
  }
  const image = parseImageDataUrl(message.imageDataUrl);
  if (image === null) {
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
      { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
    ],
  };
}

function toAnthropicBlocks(content: AnthropicContent): Array<AnthropicTextBlock | AnthropicImageBlock> {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  return content;
}

export function buildAnthropicMessages(
  rawMessages: ClientHistoryMessage[],
  locale: ClientChatRequest["locale"],
): AnthropicMessage[] {
  const mapped = rawMessages.map((message) => mapHistoryMessage(message, locale));
  const merged: AnthropicMessage[] = [];

  for (const message of mapped) {
    if (merged.length === 0) {
      if (message.role !== "user") {
        continue;
      }
      merged.push({ ...message });
      continue;
    }

    const prev = merged[merged.length - 1]!;
    if (prev.role === message.role) {
      if (typeof prev.content === "string" && typeof message.content === "string") {
        if (prev.content.length === 0) {
          prev.content = message.content;
        } else if (message.content.length > 0) {
          prev.content = `${prev.content}\n\n${message.content}`;
        }
      } else {
        const prevBlocks = toAnthropicBlocks(prev.content);
        const currBlocks = toAnthropicBlocks(message.content);
        prev.content = [...prevBlocks, ...currBlocks];
      }
    } else {
      merged.push({ ...message });
    }
  }

  return merged;
}

export function buildAnthropicBody(request: EnrichedChatRequest, model: string): unknown {
  return {
    model,
    max_tokens: request.mode === "summary" ? 1024 : 2048,
    system: buildSystemPrompt(request.locale, request.mode, {
      webSearch: request.webSearch,
      smartSearch: request.smartSearch,
      searchResults: request.searchResults,
      currentTime: request.currentTime,
    }),
    messages: buildAnthropicMessages(request.messages, request.locale),
    stream: true,
  };
}

export function extractAnthropicDeltaText(data: string): ExtractedDelta {
  if (data === "[DONE]") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new TypeError("Invalid Anthropic SSE data");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("Invalid Anthropic SSE data");
  }
  const value = parsed as Record<string, unknown>;

  if (value.type === "message_start") {
    const msg = value.message as Record<string, unknown> | undefined;
    const msgUsage = msg?.usage as Record<string, unknown> | undefined;
    const inputTokens = typeof msgUsage?.input_tokens === "number" ? msgUsage.input_tokens : undefined;
    if (inputTokens !== undefined) {
      return { usage: { promptTokens: inputTokens } };
    }
    return null;
  }

  if (value.type === "message_delta") {
    const deltaUsage = value.usage as Record<string, unknown> | undefined;
    const outputTokens = typeof deltaUsage?.output_tokens === "number" ? deltaUsage.output_tokens : undefined;
    if (outputTokens !== undefined) {
      return { usage: { completionTokens: outputTokens } };
    }
    return null;
  }

  if (value.type === "content_block_delta") {
    const delta = value.delta as Record<string, unknown> | undefined;
    if (typeof delta !== "object" || delta === null) return null;

    if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking.length > 0) {
      return { thought: delta.thinking };
    }
    if ((delta.type === "text_delta" || delta.type === undefined) && typeof delta.text === "string" && delta.text.length > 0) {
      return { content: delta.text };
    }
  }

  return null;
}

/** 非流式 judge 响应：拼接 content 数组中的 text 块 */
export function extractAnthropicJudgeText(responseJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const content = (parsed as Record<string, unknown>).content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const text = content
    .map((block): string => {
      if (typeof block !== "object" || block === null) return "";
      const value = block as Record<string, unknown>;
      return value.type === "text" && typeof value.text === "string" ? value.text : "";
    })
    .join("");
  return text.length > 0 ? text : null;
}

export function buildAnthropicAdapter(): ProviderAdapter {
  return {
    id: "claude",
    isOpenAICompat: false,
    supportsImage: true,
    imageModels: [...ALLOWED_MODELS],
    defaultModel: "claude-sonnet-5",
    allowedModels: ALLOWED_MODELS,
    buildRequest(input: ProviderRequestInput): BuiltProviderRequest {
      const body = buildAnthropicBody(input.request, input.model);
      return {
        url: ANTHROPIC_ENDPOINT,
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
          "anthropic-version": ANTHROPIC_VERSION,
          "x-api-key": input.apiKey,
        },
        body: JSON.stringify(body),
      };
    },
    extractDeltaText: extractAnthropicDeltaText,
    buildJudgeRequest(input: JudgeRequestInput): BuiltProviderRequest {
      const body = {
        model: input.model,
        max_tokens: 256,
        system: input.systemPrompt,
        messages: input.messages.map((message) => ({
          role: message.role,
          content: message.text,
        })),
        stream: false,
      };
      return {
        url: ANTHROPIC_ENDPOINT,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "anthropic-version": ANTHROPIC_VERSION,
          "x-api-key": input.apiKey,
        },
        body: JSON.stringify(body),
      };
    },
    extractJudgeText: extractAnthropicJudgeText,
  };
}
