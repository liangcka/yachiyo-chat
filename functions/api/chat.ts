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
import { mockChatResponse, proxyStepFunStream } from "../_shared/stream";
import {
  ChatValidationError,
  readJsonBodyWithLimit,
  validateChatRequest,
} from "../_shared/validation";

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

  const limit = dailyRequestLimit(context.env);
  const providerConfiguration =
    context.env.APP_MODE === "mock" ? null : resolveStepFunConfiguration(context.env);
  if (limit === null || (context.env.APP_MODE !== "mock" && providerConfiguration === null)) {
    return problemResponse("CONFIGURATION_ERROR", 503);
  }

  try {
    const quota = await consumeDailyQuota(
      context.env.RATE_LIMIT_KV,
      session.sid,
      limit,
    );
    if (!quota.allowed) {
      return problemResponse("DAILY_QUOTA_EXCEEDED", 429);
    }
  } catch {
    return problemResponse("QUOTA_UNAVAILABLE", 503);
  }

  if (context.env.APP_MODE === "mock") {
    return mockChatResponse(request.locale);
  }

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
  const cleanup = () => {
    clearTimeout(timeout);
    context.request.signal.removeEventListener("abort", onClientAbort);
  };

  let upstream: Response;
  try {
    upstream = await requestStepFun(request, providerConfiguration!, controller.signal);
  } catch {
    cleanup();
    return timedOut
      ? problemResponse("PROVIDER_TIMEOUT", 504)
      : problemResponse("PROVIDER_UNAVAILABLE", 502);
  }

  const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
  if (!upstream.ok || upstream.body === null || !contentType.includes("text/event-stream")) {
    cleanup();
    await upstream.body?.cancel();
    return problemResponse("PROVIDER_ERROR", 502);
  }

  return proxyStepFunStream(upstream, {
    abort: () => controller.abort(),
    clientSignal: context.request.signal,
    onFinalize: cleanup,
    signal: deadlineController.signal,
  });
}
