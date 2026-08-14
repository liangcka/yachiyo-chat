export type ChatLocale = "zh-CN" | "ja-JP";

export interface ClientHistoryMessage {
  role: "user" | "assistant";
  text: string;
  imageDataUrl?: string;
}

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

export type RequestMode = "chat" | "summary";

export interface ClientChatRequest {
  locale: ChatLocale;
  messages: ClientHistoryMessage[];
  mode?: RequestMode;
  provider?: ProviderId;
  apiKey?: string;
  model?: string;
}

export class ChatValidationError extends Error {
  readonly code = "INVALID_REQUEST";

  constructor() {
    super("Invalid chat request");
    this.name = "ChatValidationError";
  }
}

export const MAX_CHAT_BODY_BYTES = 3 * 1_024 * 1_024;

const maximumMessages = 20;
const maximumMessageCharacters = 4_000;
const maximumTotalCharacters = 24_000;
const maximumImageBytes = 2 * 1_024 * 1_024;
const maximumEncodedImageLength = Math.ceil(maximumImageBytes / 3) * 4;
const allowedTopLevelKeys = new Set(["locale", "messages", "mode", "provider", "apiKey", "model"]);
const allowedMessageKeys = new Set(["role", "text", "imageDataUrl"]);

function invalid(): never {
  throw new ChatValidationError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedUnicodeLength(value: string, maximum: number): number {
  let length = 0;
  const iterator = value[Symbol.iterator]();
  while (!iterator.next().done) {
    length += 1;
    if (length > maximum) {
      break;
    }
  }
  return length;
}

function decodedBase64Length(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function hasExpectedImageSignature(mimeType: string, base64: string): boolean {
  try {
    const header = atob(base64.slice(0, 24));
    const byte = (index: number) => header.charCodeAt(index);

    if (mimeType === "jpeg") {
      return byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff;
    }
    if (mimeType === "png") {
      return (
        byte(0) === 0x89 &&
        header.slice(1, 4) === "PNG" &&
        byte(4) === 0x0d &&
        byte(5) === 0x0a &&
        byte(6) === 0x1a &&
        byte(7) === 0x0a
      );
    }
    return header.slice(0, 4) === "RIFF" && header.slice(8, 12) === "WEBP";
  } catch {
    return false;
  }
}

function validateImageDataUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > maximumEncodedImageLength + 64) {
    return invalid();
  }

  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (match === null) {
    return invalid();
  }

  const mimeType = match[1];
  const base64 = match[2];
  if (
    mimeType === undefined ||
    base64 === undefined ||
    base64.length === 0 ||
    base64.length % 4 !== 0 ||
    decodedBase64Length(base64) > maximumImageBytes ||
    !hasExpectedImageSignature(mimeType, base64)
  ) {
    return invalid();
  }

  return value;
}

export function validateChatRequest(value: unknown): ClientChatRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, allowedTopLevelKeys)) {
    return invalid();
  }

  if (value.locale !== "zh-CN" && value.locale !== "ja-JP") {
    return invalid();
  }
  const rawMessages = value.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length < 1 || rawMessages.length > maximumMessages) {
    return invalid();
  }

  let totalCharacters = 0;
  const messages = rawMessages.map((message, index): ClientHistoryMessage => {
    if (!isRecord(message) || !hasOnlyKeys(message, allowedMessageKeys)) {
      return invalid();
    }
    if (message.role !== "user" && message.role !== "assistant") {
      return invalid();
    }
    if (typeof message.text !== "string") {
      return invalid();
    }

    const textLength = boundedUnicodeLength(message.text, maximumMessageCharacters);
    if (textLength > maximumMessageCharacters) {
      return invalid();
    }
    totalCharacters += textLength;
    if (totalCharacters > maximumTotalCharacters) {
      return invalid();
    }

    const isLastUserMessage =
      index === rawMessages.length - 1 && message.role === "user";
    let imageDataUrl: string | undefined;
    if (message.imageDataUrl !== undefined) {
      if (!isLastUserMessage) {
        return invalid();
      }
      imageDataUrl = validateImageDataUrl(message.imageDataUrl);
    }

    if (message.text.trim().length === 0 && imageDataUrl === undefined) {
      return invalid();
    }

    return imageDataUrl === undefined
      ? { role: message.role, text: message.text }
      : { role: message.role, text: message.text, imageDataUrl };
  });

  if (messages.at(-1)?.role !== "user") {
    return invalid();
  }

  if (value.mode !== undefined && value.mode !== "chat" && value.mode !== "summary") {
    return invalid();
  }

  const mode = value.mode as RequestMode | undefined;

  const hasProvider = value.provider !== undefined;
  const hasApiKey = value.apiKey !== undefined;
  const hasModel = value.model !== undefined;
  if (hasProvider !== hasApiKey || hasProvider !== hasModel) {
    return invalid();
  }

  if (!hasProvider) {
    return { locale: value.locale, messages, ...(mode !== undefined ? { mode } : {}) };
  }

  if (!isProviderId(value.provider)) {
    return invalid();
  }
  if (
    typeof value.apiKey !== "string" ||
    value.apiKey.trim().length < 20 ||
    value.apiKey.length > 512
  ) {
    return invalid();
  }
  if (typeof value.model !== "string" || value.model.length === 0 || value.model.length > 64) {
    return invalid();
  }

  return {
    locale: value.locale,
    messages,
    ...(mode !== undefined ? { mode } : {}),
    provider: value.provider,
    apiKey: value.apiKey,
    model: value.model,
  };
}

export async function readJsonBodyWithLimit(
  request: Request,
  maximumBytes = MAX_CHAT_BODY_BYTES,
): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      return invalid();
    }
  }

  if (request.body === null) {
    return invalid();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return invalid();
      }
      chunks.push(value);
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder("utf-8", { fatal: true }).decode(combined);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ChatValidationError) {
      throw error;
    }
    return invalid();
  }
}
