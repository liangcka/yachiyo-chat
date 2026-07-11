import { buildSystemPrompt } from "./prompt";
import type { ClientChatRequest, ClientHistoryMessage } from "./validation";

interface StepFunTextPart {
  type: "text";
  text: string;
}

interface StepFunImagePart {
  type: "image_url";
  image_url: { url: string; detail: "low" };
}

type StepFunMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | Array<StepFunTextPart | StepFunImagePart> };

export interface StepFunRequestBody {
  model: string;
  messages: StepFunMessage[];
  stream: true;
  reasoning_effort: "low" | "medium";
  max_tokens: 384;
}

export interface StepFunConfiguration {
  endpoint: string;
  apiKey: string;
  model: "step-3.7-flash";
}

function mapHistoryMessage(
  message: ClientHistoryMessage,
  locale: ClientChatRequest["locale"],
): StepFunMessage {
  if (message.role === "assistant") {
    return { role: "assistant", content: message.text };
  }
  if (message.imageDataUrl === undefined) {
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
      {
        type: "image_url",
        image_url: { url: message.imageDataUrl, detail: "low" },
      },
    ],
  };
}

export function buildStepFunBody(
  request: ClientChatRequest,
  model: string,
): StepFunRequestBody {
  const containsImage = request.messages.some((message) => message.imageDataUrl !== undefined);
  return {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(request.locale) },
      ...request.messages.map((message) => mapHistoryMessage(message, request.locale)),
    ],
    stream: true,
    reasoning_effort: containsImage ? "medium" : "low",
    max_tokens: 384,
  };
}

export function resolveStepFunConfiguration(
  env: Pick<Env, "STEPFUN_API_KEY" | "STEPFUN_BASE_URL" | "STEPFUN_MODEL">,
): StepFunConfiguration | null {
  if (
    typeof env.STEPFUN_API_KEY !== "string" ||
    env.STEPFUN_API_KEY.length === 0 ||
    env.STEPFUN_API_KEY.length > 512 ||
    env.STEPFUN_API_KEY !== env.STEPFUN_API_KEY.trim() ||
    env.STEPFUN_MODEL !== "step-3.7-flash"
  ) {
    return null;
  }

  try {
    const baseUrl = new URL(env.STEPFUN_BASE_URL);
    const pathname = baseUrl.pathname.replace(/\/+$/u, "");
    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.hostname !== "api.stepfun.com" ||
      baseUrl.port !== "" ||
      baseUrl.username !== "" ||
      baseUrl.password !== "" ||
      baseUrl.search !== "" ||
      baseUrl.hash !== "" ||
      pathname !== "/step_plan/v1"
    ) {
      return null;
    }

    return {
      endpoint: `${baseUrl.origin}${pathname}/chat/completions`,
      apiKey: env.STEPFUN_API_KEY,
      model: "step-3.7-flash",
    };
  } catch {
    return null;
  }
}

export async function requestStepFun(
  request: ClientChatRequest,
  configuration: StepFunConfiguration,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(configuration.endpoint, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      authorization: `Bearer ${configuration.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildStepFunBody(request, configuration.model)),
    signal,
  });
}
