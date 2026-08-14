import {
  constantTimeEqual,
  hexToBytes,
  sha256Bytes,
} from "../_shared/crypto";
import {
  isJsonRequest,
  isSameOriginRequest,
  jsonResponse,
  noContentResponse,
  problemResponse,
} from "../_shared/http";
import {
  authAttemptKey,
  clearAuthFailures,
  getAuthAttemptState,
  recordAuthFailure,
} from "../_shared/rate-limit";
import {
  clearSessionCookie,
  resolveSessionSigningSecret,
  SESSION_MAX_AGE_SECONDS,
  sessionCookie,
  sessionFromRequest,
  signSession,
} from "../_shared/session";
import { readJsonBodyWithLimit } from "../_shared/validation";

interface SessionContext {
  request: Request;
  env: Env;
}

const mockAccessCode = "yachiyo-local-access";
const maximumBodyLength = 1_024;

function authAttemptLimit(env: Env): number | null {
  if (!/^\d+$/u.test(env.AUTH_ATTEMPT_LIMIT)) {
    return env.APP_MODE === "mock" ? 10 : null;
  }

  const parsed = Number(env.AUTH_ATTEMPT_LIMIT);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

function trustedAddress(request: Request): string {
  const supplied = request.headers.get("cf-connecting-ip")?.trim();
  if (
    supplied === undefined ||
    supplied.length < 3 ||
    supplied.length > 64 ||
    !/^[A-Fa-f0-9:.]+$/u.test(supplied)
  ) {
    return "anonymous";
  }

  return supplied;
}

interface SessionRequest {
  accessCode: string;
  deviceId?: string;
}

function isValidDeviceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

async function parseSessionRequest(request: Request): Promise<SessionRequest | null> {
  if (!isJsonRequest(request)) {
    return null;
  }

  try {
    const parsed = await readJsonBodyWithLimit(request, maximumBodyLength);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const accessCode = record.accessCode;
    if (typeof accessCode !== "string") {
      return null;
    }

    const normalized = accessCode.trim();
    const characterLength = [...normalized].length;
    if (characterLength < 16 || characterLength > 128) {
      return null;
    }

    // 设备标识非法时忽略,不写入 token;额度键随后回退到 sid
    const deviceId = isValidDeviceId(record.deviceId) ? record.deviceId : undefined;
    return { accessCode: normalized, deviceId };
  } catch {
    return null;
  }
}

async function matchesAccessCode(accessCode: string, env: Env): Promise<boolean | null> {
  const expected =
    env.APP_MODE === "mock"
      ? await sha256Bytes(mockAccessCode)
      : /^[A-Fa-f0-9]{64}$/u.test(env.ACCESS_CODE_SHA256)
        ? hexToBytes(env.ACCESS_CODE_SHA256)
        : null;

  if (expected === null) {
    return null;
  }

  return constantTimeEqual(await sha256Bytes(accessCode), expected);
}

export async function onRequestGet(context: SessionContext): Promise<Response> {
  try {
    const secret = resolveSessionSigningSecret(context.env);
    if (secret === null) {
      return problemResponse("CONFIGURATION_ERROR", 503);
    }

    const session = await sessionFromRequest(context.request, secret);
    return jsonResponse({ authenticated: session !== null });
  } catch {
    return problemResponse("SERVICE_UNAVAILABLE", 503);
  }
}

export async function onRequestPost(context: SessionContext): Promise<Response> {
  try {
    if (!isSameOriginRequest(context.request)) {
      return problemResponse("ORIGIN_NOT_ALLOWED", 403);
    }

    const sessionRequest = await parseSessionRequest(context.request);
    if (sessionRequest === null) {
      return problemResponse("INVALID_REQUEST", 400);
    }

    const secret = resolveSessionSigningSecret(context.env);
    const limit = authAttemptLimit(context.env);
    const matches = await matchesAccessCode(sessionRequest.accessCode, context.env);
    if (secret === null || limit === null || matches === null) {
      return problemResponse("CONFIGURATION_ERROR", 503);
    }

    const attemptKey = await authAttemptKey(trustedAddress(context.request), secret);

    try {
      const attemptState = await getAuthAttemptState(
        context.env.RATE_LIMIT_KV,
        attemptKey,
        limit,
      );
      if (!attemptState.allowed) {
        return problemResponse("AUTH_RATE_LIMITED", 429);
      }

      if (!matches) {
        await recordAuthFailure(context.env.RATE_LIMIT_KV, attemptKey);
        return problemResponse("ACCESS_DENIED", 403);
      }

      await clearAuthFailures(context.env.RATE_LIMIT_KV, attemptKey);
    } catch {
      // KV failures must not permit unlimited access-code guesses.
      return problemResponse("AUTH_RATE_LIMITED", 429);
    }

    const issuedAt = Date.now();
    const token = await signSession(
      {
        sid: crypto.randomUUID(),
        exp: issuedAt + SESSION_MAX_AGE_SECONDS * 1_000,
        ...(sessionRequest.deviceId === undefined
          ? {}
          : { deviceId: sessionRequest.deviceId }),
      },
      secret,
    );

    return noContentResponse({ "set-cookie": sessionCookie(token) });
  } catch {
    return problemResponse("SERVICE_UNAVAILABLE", 503);
  }
}

export async function onRequestDelete(context: SessionContext): Promise<Response> {
  if (!isSameOriginRequest(context.request)) {
    return problemResponse("ORIGIN_NOT_ALLOWED", 403);
  }

  return noContentResponse({ "set-cookie": clearSessionCookie() });
}
