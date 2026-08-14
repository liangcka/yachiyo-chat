import {
  base64UrlDecode,
  base64UrlEncode,
  constantTimeEqual,
  hmacSha256,
  utf8Bytes,
} from "./crypto";

export interface SessionPayload {
  sid: string;
  exp: number;
  /** 本设备持久化标识,用于按设备统计每日额度;旧 token 无此字段时回退到 sid */
  deviceId?: string;
}

export const SESSION_COOKIE = "yachiyo_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const maxTokenLength = 1_024;
const mockSigningSecret = "mock-only-yachiyo-session-secret-not-for-production";
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sid !== "string" ||
    candidate.sid.length === 0 ||
    candidate.sid.length > 128 ||
    typeof candidate.exp !== "number" ||
    !Number.isSafeInteger(candidate.exp) ||
    candidate.exp <= 0
  ) {
    return false;
  }

  if (candidate.deviceId === undefined) {
    return true;
  }

  return (
    typeof candidate.deviceId === "string" &&
    candidate.deviceId.length >= 1 &&
    candidate.deviceId.length <= 128 &&
    /^[A-Za-z0-9_-]+$/u.test(candidate.deviceId)
  );
}

export async function signSession(
  payload: SessionPayload,
  secret: string,
): Promise<string> {
  if (!isSessionPayload(payload) || secret.length === 0) {
    throw new TypeError("Invalid session signing input");
  }

  const encodedPayload = base64UrlEncode(
    utf8Bytes(
      JSON.stringify({
        sid: payload.sid,
        exp: payload.exp,
        ...(payload.deviceId === undefined ? {} : { deviceId: payload.deviceId }),
      }),
    ),
  );
  const signature = await hmacSha256(secret, encodedPayload);
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

export async function verifySession(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<SessionPayload | null> {
  if (token.length === 0 || token.length > maxTokenLength || secret.length === 0) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    return null;
  }

  try {
    const [encodedPayload, encodedSignature] = parts as [string, string];
    const suppliedSignature = base64UrlDecode(encodedSignature);
    const expectedSignature = await hmacSha256(secret, encodedPayload);

    if (!constantTimeEqual(suppliedSignature, expectedSignature)) {
      return null;
    }

    const parsed: unknown = JSON.parse(textDecoder.decode(base64UrlDecode(encodedPayload)));
    if (!isSessionPayload(parsed) || parsed.exp <= now) {
      return null;
    }

    return {
      sid: parsed.sid,
      exp: parsed.exp,
      ...(parsed.deviceId === undefined ? {} : { deviceId: parsed.deviceId }),
    };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function sessionTokenFromCookie(cookieHeader: string | null): string | null {
  if (cookieHeader === null) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    if (name === SESSION_COOKIE) {
      return part.slice(separator + 1).trim() || null;
    }
  }

  return null;
}

export async function sessionFromRequest(
  request: Request,
  secret: string,
  now = Date.now(),
): Promise<SessionPayload | null> {
  const token = sessionTokenFromCookie(request.headers.get("cookie"));
  return token === null ? null : verifySession(token, secret, now);
}

export function resolveSessionSigningSecret(
  env: Pick<Env, "APP_MODE" | "SESSION_SIGNING_SECRET">,
): string | null {
  if (env.APP_MODE === "mock") {
    return env.SESSION_SIGNING_SECRET || mockSigningSecret;
  }

  return typeof env.SESSION_SIGNING_SECRET === "string" &&
    env.SESSION_SIGNING_SECRET.length >= 32
    ? env.SESSION_SIGNING_SECRET
    : null;
}
