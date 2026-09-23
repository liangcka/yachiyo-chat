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

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const ALLOWED_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro",
  "gemini-3.1-flash-lite",
] as const;

interface GeminiTextPart {
  text: string;
}

interface GeminiInlinePart {
  inlineData: { mimeType: string; data: string };
}

type GeminiPart = GeminiTextPart | GeminiInlinePart;

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function parseImageDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  if (match === null) return null;
  const ext = match[1];
  const base64 = match[2];
  if (ext === undefined || base64 === undefined) return null;
  const mimeType = ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  return { mimeType, data: base64 };
}

function mapHistoryMessage(
  message: ClientHistoryMessage,
  locale: ClientChatRequest["locale"],
): GeminiContent {
  const role: GeminiContent["role"] = message.role === "assistant" ? "model" : "user";
  if (message.imageDataUrl === undefined) {
    return { role, parts: [{ text: message.text }] };
  }
  const image = parseImageDataUrl(message.imageDataUrl);
  if (image === null) {
    return { role, parts: [{ text: message.text }] };
  }
  const text =
    message.text.length > 0
      ? message.text
      : locale === "ja-JP"
        ? "この画像を見てください。"
        : "请看看这张图片。";
  return {
    role,
    parts: [{ text }, { inlineData: image }],
  };
}

export function buildGeminiContents(
  rawMessages: ClientHistoryMessage[],
  locale: ClientChatRequest["locale"],
): GeminiContent[] {
  const mapped = rawMessages.map((message) => mapHistoryMessage(message, locale));
  const merged: GeminiContent[] = [];

  for (const message of mapped) {
    if (merged.length === 0) {
      if (message.role !== "user") {
        continue;
      }
      merged.push({ role: message.role, parts: [...message.parts] });
      continue;
    }

    const prev = merged[merged.length - 1]!;
    if (prev.role === message.role) {
      prev.parts = [...prev.parts, ...message.parts];
    } else {
      merged.push({ role: message.role, parts: [...message.parts] });
    }
  }

  return merged;
}

export function buildGeminiBody(request: EnrichedChatRequest): unknown {
  const useGoogleSearch = request.webSearch === true && request.mode !== "summary";
  return {
    contents: buildGeminiContents(request.messages, request.locale),
    ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
    systemInstruction: {
      parts: [
        {
          text: buildSystemPrompt(request.locale, request.mode, {
            webSearch: request.webSearch,
            smartSearch: request.smartSearch,
            searchResults: request.searchResults,
            currentTime: request.currentTime,
          }),
        },
      ],
    },
    // Gemini 3 系列默认开启 thinking 且思考 token 计入 maxOutputTokens，
    // 预算过小会被思考耗尽导致正文为空；thinkingLevel low 适配角色聊天场景
    generationConfig: {
      maxOutputTokens: request.mode === "summary" ? 4096 : 8192,
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
}

export function extractGeminiDeltaText(data: string): ExtractedDelta {
  if (data === "[DONE]") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new TypeError("Invalid Gemini SSE data");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("Invalid Gemini SSE data");
  }
  const value = parsed as Record<string, unknown>;

  let usage: TokenUsage | undefined;
  const usageMeta = value.usageMetadata as Record<string, unknown> | undefined;
  if (typeof usageMeta === "object" && usageMeta !== null) {
    const p = typeof usageMeta.promptTokenCount === "number" ? usageMeta.promptTokenCount : undefined;
    const c = typeof usageMeta.candidatesTokenCount === "number" ? usageMeta.candidatesTokenCount : undefined;
    const t = typeof usageMeta.totalTokenCount === "number" ? usageMeta.totalTokenCount : undefined;
    if (p !== undefined || c !== undefined || t !== undefined) {
      usage = {
        ...(p !== undefined ? { promptTokens: p } : {}),
        ...(c !== undefined ? { completionTokens: c } : {}),
        ...(t !== undefined ? { totalTokens: t } : {}),
      };
    }
  }

  const candidates = value.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return usage !== undefined ? { usage } : null;
  }
  const first = candidates[0];
  if (typeof first !== "object" || first === null) {
    throw new TypeError("Invalid Gemini SSE data");
  }
  const content = (first as Record<string, unknown>).content;
  if (typeof content !== "object" || content === null) {
    return usage !== undefined ? { usage } : null;
  }
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return usage !== undefined ? { usage } : null;
  }

  let contentText = "";
  let thoughtText = "";
  for (const part of parts) {
    if (typeof part === "object" && part !== null) {
      const p = part as Record<string, unknown>;
      const text = typeof p.text === "string" ? p.text : "";
      if (text.length > 0) {
        if (p.thought === true) {
          thoughtText += text;
        } else {
          contentText += text;
        }
      }
    }
  }

  let sources: Array<{ title: string; url: string }> | undefined;
  const groundingMeta = (first.groundingMetadata ?? value.groundingMetadata) as Record<string, unknown> | undefined;
  if (typeof groundingMeta === "object" && groundingMeta !== null) {
    const chunks = groundingMeta.groundingChunks;
    if (Array.isArray(chunks) && chunks.length > 0) {
      const extracted: Array<{ title: string; url: string }> = [];
      for (const chunk of chunks) {
        if (typeof chunk === "object" && chunk !== null) {
          const web = (chunk as Record<string, unknown>).web as Record<string, unknown> | undefined;
          if (typeof web === "object" && web !== null && typeof web.uri === "string" && web.uri.length > 0) {
            const title = typeof web.title === "string" && web.title.length > 0 ? web.title : web.uri;
            extracted.push({ title, url: web.uri });
          }
        }
      }
      if (extracted.length > 0) {
        sources = extracted;
      }
    }
  }

  const resContent = contentText.length > 0 ? contentText : null;
  const resThought = thoughtText.length > 0 ? thoughtText : null;
  if (resContent === null && resThought === null && usage === undefined && sources === undefined) {
    return null;
  }
  return {
    content: resContent,
    thought: resThought,
    ...(usage !== undefined ? { usage } : {}),
    ...(sources !== undefined ? { sources } : {}),
  };
}

/** 非流式 judge 响应：提取 candidates[0].content.parts 的完整文本 */
export function extractGeminiJudgeText(responseJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidates = (parsed as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  if (typeof first !== "object" || first === null) return null;
  const content = (first as Record<string, unknown>).content;
  if (typeof content !== "object" || content === null) return null;
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const text = parts
    .map((part): string => {
      if (typeof part !== "object" || part === null) return "";
      const value = (part as Record<string, unknown>).text;
      return typeof value === "string" ? value : "";
    })
    .join("");
  return text.length > 0 ? text : null;
}

export function buildGeminiAdapter(): ProviderAdapter {
  return {
    id: "gemini",
    isOpenAICompat: false,
    hasNativeWebSearch: true,
    supportsImage: true,
    imageModels: [...ALLOWED_MODELS],
    defaultModel: "gemini-3.8-flash",
    allowedModels: ALLOWED_MODELS,
    buildRequest(input: ProviderRequestInput): BuiltProviderRequest {
      const body = buildGeminiBody(input.request);
      const url = `${GEMINI_BASE}/models/${encodeURIComponent(input.model)}:streamGenerateContent?alt=sse`;
      return {
        url,
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
          "x-goog-api-key": input.apiKey,
        },
        body: JSON.stringify(body),
      };
    },
    extractDeltaText: extractGeminiDeltaText,
    buildJudgeRequest(input: JudgeRequestInput): BuiltProviderRequest {
      const body = {
        contents: input.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.text }],
        })),
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        generationConfig: {
          // 思考 token 计入 maxOutputTokens，512 足够 YES/NO 输出
          maxOutputTokens: 512,
          thinkingConfig: { thinkingLevel: "low" },
        },
      };
      const url = `${GEMINI_BASE}/models/${encodeURIComponent(input.model)}:generateContent`;
      return {
        url,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-goog-api-key": input.apiKey,
        },
        body: JSON.stringify(body),
      };
    },
    extractJudgeText: extractGeminiJudgeText,
  };
}
