import {
  isJsonRequest,
  isSameOriginRequest,
  problemResponse,
} from "../_shared/http";
import { consumeDailyQuota } from "../_shared/rate-limit";
import {
  resolveSessionSigningSecret,
  sessionFromRequest,
} from "../_shared/session";
import {
  requestStepFun,
  resolveStepFunConfiguration,
} from "../_shared/stepfun";
import { mockChatResponse, proxyProviderStream, proxyStepFunStream } from "../_shared/stream";
import {
  ChatValidationError,
  readJsonBodyWithLimit,
  validateChatRequest,
  type ClientChatRequest,
} from "../_shared/validation";
import { getProvider, isAllowedModel, isValidApiKey } from "../_shared/providers/registry";

interface ChatContext {
  request: Request;
  env: Env;
}

function dailyRequestLimit(env: Env): number | null {
  if (!/^\d+$/u.test(env.DAILY_REQUEST_LIMIT)) {
    return env.APP_MODE === "mock" ? 100 : null;
  }

  const parsed = Number(env.DAILY_REQUEST_LIMIT);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 10_000 ? parsed : null;
}

function requestContainsImage(request: ClientChatRequest): boolean {
  return request.messages.some((message) => message.imageDataUrl !== undefined);
}

interface UpstreamFetchHandle {
  signal: AbortSignal;
  deadlineSignal: AbortSignal;
  isTimedOut: () => boolean;
  abort: () => void;
  cleanup: () => void;
}

function prepareUpstreamFetch(context: ChatContext): UpstreamFetchHandle {
  const controller = new AbortController();
  const deadlineController = new AbortController();
  let timedOut = false;
  const onClientAbort = () => controller.abort();
  context.request.signal.addEventListener("abort", onClientAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    deadlineController.abort();
    controller.abort();
  }, 30_000);
  return {
    signal: controller.signal,
    deadlineSignal: deadlineController.signal,
    isTimedOut: () => timedOut,
    abort: () => controller.abort(),
    cleanup: () => {
      clearTimeout(timeout);
      context.request.signal.removeEventListener("abort", onClientAbort);
    },
  };
}

function validateUpstreamResponse(upstream: Response): boolean {
  const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
  return upstream.ok && upstream.body !== null && contentType.includes("text/event-stream");
}

export async function onRequestPost(context: ChatContext): Promise<Response> {
  if (!isSameOriginRequest(context.request)) {
    return problemResponse("ORIGIN_NOT_ALLOWED", 403);
  }
  if (!isJsonRequest(context.request)) {
    return problemResponse("INVALID_REQUEST", 400);
  }

  const signingSecret = resolveSessionSigningSecret(context.env);
  if (signingSecret === null) {
    return problemResponse("CONFIGURATION_ERROR", 503);
  }

  const session = await sessionFromRequest(context.request, signingSecret);
  if (session === null) {
    return problemResponse("SESSION_REQUIRED", 401);
  }

  let request;
  try {
    request = validateChatRequest(await readJsonBodyWithLimit(context.request));
  } catch (error) {
    if (error instanceof ChatValidationError) {
      return problemResponse("INVALID_REQUEST", 400);
    }
    return problemResponse("SERVICE_UNAVAILABLE", 503);
  }

  if (request.provider !== undefined && request.apiKey !== undefined && request.model !== undefined) {
    return handleUserKeyRequest(context, request);
  }
  if (context.env.APP_MODE === "mock") {
    return mockChatResponse(request.locale, request.mode);
  }

  const limit = dailyRequestLimit(context.env);
  if (limit === null) {
    return problemResponse("CONFIGURATION_ERROR", 503);
  }

  try {
    const quota = await consumeDailyQuota(
      context.env.RATE_LIMIT_KV,
      session.deviceId ?? session.sid,
      limit,
    );
    if (!quota.allowed) {
      return problemResponse("DAILY_QUOTA_EXCEEDED", 429);
    }
  } catch {
    return problemResponse("QUOTA_UNAVAILABLE", 503);
  }

  return handleServerFallback(context, request);
}

async function handleUserKeyRequest(
  context: ChatContext,
  request: ClientChatRequest,
): Promise<Response> {
  const provider = getProvider(request.provider!);
  if (!isAllowedModel(provider, request.model)) {
    return problemResponse("INVALID_REQUEST", 400);
  }
  if (!isValidApiKey(request.apiKey)) {
    return problemResponse("INVALID_REQUEST", 400);
  }
  if (requestContainsImage(request) && !provider.imageModels.includes(request.model)) {
    return problemResponse("INVALID_REQUEST", 400);
  }
  const built = provider.buildRequest({
    request,
    apiKey: request.apiKey!,
    model: request.model!,
  });
  const handle = prepareUpstreamFetch(context);
  let upstream: Response;
  try {
    upstream = await fetch(built.url, {
      method: "POST",
      headers: built.headers,
      body: built.body,
      signal: handle.signal,
    });
  } catch {
    handle.cleanup();
    return handle.isTimedOut()
      ? problemResponse("PROVIDER_TIMEOUT", 504)
      : problemResponse("PROVIDER_UNAVAILABLE", 502);
  }
  if (!validateUpstreamResponse(upstream)) {
    handle.cleanup();
    await upstream.body?.cancel();
    if (upstream.status === 401 || upstream.status === 403) {
      return problemResponse("PROVIDER_AUTH_FAILED", 502);
    }
    if (upstream.status === 402 || upstream.status === 429) {
      return problemResponse("PROVIDER_QUOTA_EXCEEDED", 502);
    }
    return problemResponse("PROVIDER_ERROR", 502);
  }
  const maxCharacters = request.mode === "summary" ? 1000 : 200;
  return proxyProviderStream(
    upstream,
    {
      abort: handle.abort,
      clientSignal: context.request.signal,
      maxCharacters,
      onFinalize: handle.cleanup,
      signal: handle.deadlineSignal,
    },
    provider.extractDeltaText,
  );
}

async function handleServerFallback(
  context: ChatContext,
  request: ClientChatRequest,
): Promise<Response> {
  const providerConfiguration = resolveStepFunConfiguration(context.env);
  if (providerConfiguration === null) {
    return problemResponse("CONFIGURATION_ERROR", 503);
  }
  const handle = prepareUpstreamFetch(context);
  let upstream: Response;
  try {
    upstream = await requestStepFun(request, providerConfiguration, handle.signal);
  } catch {
    handle.cleanup();
    return handle.isTimedOut()
      ? problemResponse("PROVIDER_TIMEOUT", 504)
      : problemResponse("PROVIDER_UNAVAILABLE", 502);
  }
  if (!validateUpstreamResponse(upstream)) {
    handle.cleanup();
    await upstream.body?.cancel();
    return problemResponse("PROVIDER_ERROR", 502);
  }
  const maxCharacters = request.mode === "summary" ? 1000 : 200;
  return proxyStepFunStream(upstream, {
    abort: handle.abort,
    clientSignal: context.request.signal,
    maxCharacters,
    onFinalize: handle.cleanup,
    signal: handle.deadlineSignal,
  });
}
