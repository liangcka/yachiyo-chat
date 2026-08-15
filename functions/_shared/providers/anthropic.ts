import { buildSystemPrompt } from "../prompt";
import type { ClientChatRequest, ClientHistoryMessage } from "../validation";
import type { BuiltProviderRequest, ProviderAdapter, ProviderRequestInput } from "./registry";

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

export function buildAnthropicBody(request: ClientChatRequest, model: string): unknown {
  return {
    model,
    max_tokens: request.mode === "summary" ? 1024 : 2048,
    system: buildSystemPrompt(request.locale, request.mode),
    messages: buildAnthropicMessages(request.messages, request.locale),
    stream: true,
  };
}

export function extractAnthropicDeltaText(data: string): string | null {
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
  if (value.type !== "content_block_delta") return null;
  const delta = value.delta;
  if (typeof delta !== "object" || delta === null) return null;
  const text = (delta as Record<string, unknown>).text;
  if (text === undefined || text === null || text === "") return null;
  if (typeof text !== "string") {
    throw new TypeError("Invalid Anthropic SSE data");
  }
  return text;
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
  };
}
