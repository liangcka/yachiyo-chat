import { bytesToHex, hmacSha256 } from "./crypto";

export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
  resetsAt: string;
}

export interface AuthAttemptState {
  allowed: boolean;
  failures: number;
  retryAt?: string;
}

interface StoredAuthAttemptState {
  failures: number;
  expiresAt: number;
}

const authWindowMilliseconds = 15 * 60 * 1_000;

function assertPositiveLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("Limit must be a positive integer");
  }
}

function parseCounter(value: string | null): number {
  if (value === null || !/^\d+$/u.test(value)) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseAuthAttemptState(value: string | null): StoredAuthAttemptState | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.failures !== "number" ||
      !Number.isSafeInteger(candidate.failures) ||
      candidate.failures < 0 ||
      typeof candidate.expiresAt !== "number" ||
      !Number.isSafeInteger(candidate.expiresAt)
    ) {
      return null;
    }

    return {
      failures: candidate.failures,
      expiresAt: candidate.expiresAt,
    };
  } catch {
    return null;
  }
}

export async function consumeDailyQuota(
  kv: KVNamespace,
  sessionId: string,
  limit: number,
  now = new Date(),
): Promise<QuotaResult> {
  assertPositiveLimit(limit);
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId) || Number.isNaN(now.getTime())) {
    throw new TypeError("Invalid quota input");
  }

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const date = `${year.toString().padStart(4, "0")}-${(month + 1)
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  const nextMidnight = Date.UTC(year, month, day + 1);
  const resetsAt = new Date(nextMidnight).toISOString();
  const key = `quota:${date}:${sessionId}`;
  const observed = parseCounter(await kv.get(key));

  if (observed >= limit) {
    return { allowed: false, used: observed, limit, resetsAt };
  }

  const used = observed + 1;
  const storageExpiry = nextMidnight + 2 * 60 * 60 * 1_000;
  const expirationTtl = Math.max(60, Math.ceil((storageExpiry - now.getTime()) / 1_000));

  // Workers KV is eventually consistent, so this is a best-effort small-group
  // quota rather than a transactional global counter. One request performs one
  // observed read and one write; production should pair this with an edge rule.
  await kv.put(key, used.toString(), { expirationTtl });

  return { allowed: true, used, limit, resetsAt };
}

export async function authAttemptKey(address: string, secret: string): Promise<string> {
  const digest = await hmacSha256(secret, `auth-attempt:${address}`);
  return `auth:${bytesToHex(digest)}`;
}

export async function getAuthAttemptState(
  kv: KVNamespace,
  key: string,
  limit: number,
  now = new Date(),
): Promise<AuthAttemptState> {
  assertPositiveLimit(limit);
  const state = parseAuthAttemptState(await kv.get(key));

  if (state === null) {
    return { allowed: true, failures: 0 };
  }

  if (state.expiresAt <= now.getTime()) {
    await kv.delete(key);
    return { allowed: true, failures: 0 };
  }

  return {
    allowed: state.failures < limit,
    failures: state.failures,
    retryAt: new Date(state.expiresAt).toISOString(),
  };
}

export async function recordAuthFailure(
  kv: KVNamespace,
  key: string,
  now = new Date(),
): Promise<StoredAuthAttemptState> {
  const timestamp = now.getTime();
  const previous = parseAuthAttemptState(await kv.get(key));
  const active = previous !== null && previous.expiresAt > timestamp;
  const next: StoredAuthAttemptState = {
    failures: active ? previous.failures + 1 : 1,
    expiresAt: active ? previous.expiresAt : timestamp + authWindowMilliseconds,
  };
  const expirationTtl = Math.max(60, Math.ceil((next.expiresAt - timestamp) / 1_000));

  await kv.put(key, JSON.stringify(next), { expirationTtl });
  return next;
}

export async function clearAuthFailures(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}
