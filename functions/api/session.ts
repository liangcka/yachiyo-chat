import {
  constantTimeEqual,
  hexToBytes,
  sha256Bytes,
} from "../_shared/crypto";
import {
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
  SESSION_MAX_AGE_SECONDS,
  sessionCookie,
  sessionFromRequest,
  signSession,
} from "../_shared/session";

interface SessionContext {
  request: Request;
  env: Env;
}

const mockAccessCode = "yachiyo-local-access";
const mockSigningSecret = "mock-only-yachiyo-session-secret-not-for-production";
const maximumBodyLength = 1_024;

function isSameOrigin(request: Request): boolean {
  const suppliedOrigin = request.headers.get("origin");
  return suppliedOrigin !== null && suppliedOrigin === new URL(request.url).origin;
}

function signingSecret(env: Env): string | null {
  if (env.APP_MODE === "mock") {
    return env.SESSION_SIGNING_SECRET || mockSigningSecret;
  }

  return typeof env.SESSION_SIGNING_SECRET === "string" &&
    env.SESSION_SIGNING_SECRET.length >= 32
    ? env.SESSION_SIGNING_SECRET
    : null;
}

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

async function parseAccessCode(request: Request): Promise<string | null> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return null;
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBodyLength) {
    return null;
  }

  const body = await request.text();
  if (body.length === 0 || body.length > maximumBodyLength) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const accessCode = (parsed as Record<string, unknown>).accessCode;
    if (typeof accessCode !== "string") {
      return null;
    }

    const normalized = accessCode.trim();
    const characterLength = [...normalized].length;
    return characterLength >= 16 && characterLength <= 128 ? normalized : null;
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
    const secret = signingSecret(context.env);
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
    if (!isSameOrigin(context.request)) {
      return problemResponse("ORIGIN_NOT_ALLOWED", 403);
    }

    const accessCode = await parseAccessCode(context.request);
    if (accessCode === null) {
      return problemResponse("INVALID_REQUEST", 400);
    }

    const secret = signingSecret(context.env);
    const limit = authAttemptLimit(context.env);
    const matches = await matchesAccessCode(accessCode, context.env);
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
      },
      secret,
    );

    return noContentResponse({ "set-cookie": sessionCookie(token) });
  } catch {
    return problemResponse("SERVICE_UNAVAILABLE", 503);
  }
}

export async function onRequestDelete(context: SessionContext): Promise<Response> {
  if (!isSameOrigin(context.request)) {
    return problemResponse("ORIGIN_NOT_ALLOWED", 403);
  }

  return noContentResponse({ "set-cookie": clearSessionCookie() });
}
