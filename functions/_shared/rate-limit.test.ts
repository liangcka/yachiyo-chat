import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  authAttemptKey,
  clearAuthFailures,
  consumeDailyQuota,
  getAuthAttemptState,
  recordAuthFailure,
} from "./rate-limit";

describe("daily chat quota", () => {
  beforeEach(async () => {
    const keys = await env.RATE_LIMIT_KV.list();
    await Promise.all(keys.keys.map(({ name }) => env.RATE_LIMIT_KV.delete(name)));
  });

  it("allows requests through the limit and rejects the next request", async () => {
    const now = new Date("2026-07-11T08:00:00.000Z");

    expect(await consumeDailyQuota(env.RATE_LIMIT_KV, "session-a", 2, now)).toMatchObject({
      allowed: true,
      used: 1,
      limit: 2,
    });
    expect(await consumeDailyQuota(env.RATE_LIMIT_KV, "session-a", 2, now)).toMatchObject({
      allowed: true,
      used: 2,
      limit: 2,
    });
    expect(await consumeDailyQuota(env.RATE_LIMIT_KV, "session-a", 2, now)).toMatchObject({
      allowed: false,
      used: 2,
      limit: 2,
    });
  });

  it("starts a new counter on the next UTC date", async () => {
    await consumeDailyQuota(
      env.RATE_LIMIT_KV,
      "session-b",
      1,
      new Date("2026-07-11T23:59:59.000Z"),
    );

    expect(
      await consumeDailyQuota(
        env.RATE_LIMIT_KV,
        "session-b",
        1,
        new Date("2026-07-12T00:00:01.000Z"),
      ),
    ).toMatchObject({ allowed: true, used: 1 });
  });
});

describe("access-code attempt limits", () => {
  beforeEach(async () => {
    const keys = await env.RATE_LIMIT_KV.list();
    await Promise.all(keys.keys.map(({ name }) => env.RATE_LIMIT_KV.delete(name)));
  });

  it("uses a stable HMAC key without storing the source IP", async () => {
    const key = await authAttemptKey("203.0.113.7", env.SESSION_SIGNING_SECRET);

    expect(key).toMatch(/^auth:[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.7");
    expect(await authAttemptKey("203.0.113.7", env.SESSION_SIGNING_SECRET)).toBe(key);
  });

  it("counts failures for fifteen minutes and can clear the bucket", async () => {
    const now = new Date("2026-07-11T08:00:00.000Z");
    const key = await authAttemptKey("203.0.113.8", env.SESSION_SIGNING_SECRET);

    await recordAuthFailure(env.RATE_LIMIT_KV, key, now);
    await recordAuthFailure(env.RATE_LIMIT_KV, key, now);

    expect(await getAuthAttemptState(env.RATE_LIMIT_KV, key, 2, now)).toMatchObject({
      allowed: false,
      failures: 2,
    });

    await clearAuthFailures(env.RATE_LIMIT_KV, key);

    expect(await getAuthAttemptState(env.RATE_LIMIT_KV, key, 2, now)).toMatchObject({
      allowed: true,
      failures: 0,
    });
  });

  it("resets an expired failure window", async () => {
    const started = new Date("2026-07-11T08:00:00.000Z");
    const expired = new Date("2026-07-11T08:15:01.000Z");
    const key = await authAttemptKey("203.0.113.9", env.SESSION_SIGNING_SECRET);
    await recordAuthFailure(env.RATE_LIMIT_KV, key, started);

    expect(await getAuthAttemptState(env.RATE_LIMIT_KV, key, 1, expired)).toMatchObject({
      allowed: true,
      failures: 0,
    });
  });
});
