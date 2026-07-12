import { createPagesEventContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signSession, verifySession } from "../../functions/_shared/session";
import { onRequestDelete, onRequestGet, onRequestPost } from "../../functions/api/session";

const origin = "https://yachiyo.test";

function postRequest(accessCode: string, ip = "203.0.113.10"): Request {
  return new Request(`${origin}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify({ accessCode }),
  });
}

async function post(accessCode: string, ip?: string): Promise<Response> {
  return onRequestPost(
    createPagesEventContext<typeof onRequestPost>({
      request: postRequest(accessCode, ip),
      params: {},
      data: {},
    }),
  );
}

function oversizedStreamingRequest(contentLength?: string): {
  cancel: ReturnType<typeof vi.fn>;
  request: Request;
} {
  const cancel = vi.fn();
  let emitted = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!emitted) {
        emitted = true;
        controller.enqueue(new Uint8Array(1_025).fill(0x20));
        return;
      }
      controller.enqueue(new TextEncoder().encode('{"accessCode":"correct horse moonlight"}'));
      controller.close();
    },
    cancel,
  });
  const headers = new Headers({
    "content-type": "application/json",
    origin,
    "cf-connecting-ip": "203.0.113.90",
  });
  if (contentLength !== undefined) {
    headers.set("content-length", contentLength);
  }

  return {
    cancel,
    request: new Request(`${origin}/api/session`, {
      method: "POST",
      headers,
      body,
    }),
  };
}

beforeEach(async () => {
  const keys = await env.RATE_LIMIT_KV.list();
  await Promise.all(keys.keys.map(({ name }) => env.RATE_LIMIT_KV.delete(name)));
});

describe("POST /api/session", () => {
  it("issues a secure HttpOnly cookie for the configured access code", async () => {
    const response = await post("correct horse moonlight");

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(
      /^yachiyo_session=.+; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Strict$/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects malformed and incorrect access codes without details", async () => {
    const malformed = await post("short");
    const incorrect = await post("this access code is wrong", "203.0.113.11");

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
    expect(incorrect.status).toBe(403);
    expect(await incorrect.json()).toEqual({ error: { code: "ACCESS_DENIED" } });
  });

  it("rate-limits an eleventh failed attempt from one privacy-preserving bucket", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await post("this access code is wrong", "203.0.113.12")).status).toBe(403);
    }

    const response = await post("this access code is wrong", "203.0.113.12");

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: "AUTH_RATE_LIMITED" } });
  });

  it("clears previous failures after a successful login", async () => {
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await post("this access code is wrong", "203.0.113.13");
    }
    expect((await post("correct horse moonlight", "203.0.113.13")).status).toBe(204);

    expect((await post("this access code is wrong", "203.0.113.13")).status).toBe(403);
  });

  it("rejects cross-origin requests", async () => {
    const request = postRequest("correct horse moonlight");
    request.headers.set("origin", "https://attacker.test");

    const response = await onRequestPost(
      createPagesEventContext<typeof onRequestPost>({ request, params: {}, data: {} }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "ORIGIN_NOT_ALLOWED" } });
  });

  it.each([undefined, "1"])(
    "stream-limits an oversized body when Content-Length is %s",
    async (contentLength) => {
      const { cancel, request } = oversizedStreamingRequest(contentLength);

      const response = await onRequestPost(
        createPagesEventContext<typeof onRequestPost>({ request, params: {}, data: {} }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST" } });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
});

describe("session verification", () => {
  it("reports unauthenticated without a cookie and authenticated with a valid cookie", async () => {
    const anonymous = await onRequestGet(
      createPagesEventContext<typeof onRequestGet>({
        request: new Request(`${origin}/api/session`),
        params: {},
        data: {},
      }),
    );
    const login = await post("correct horse moonlight", "203.0.113.14");
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const authenticated = await onRequestGet(
      createPagesEventContext<typeof onRequestGet>({
        request: new Request(`${origin}/api/session`, { headers: { cookie } }),
        params: {},
        data: {},
      }),
    );

    expect(await anonymous.json()).toEqual({ authenticated: false });
    expect(await authenticated.json()).toEqual({ authenticated: true });
  });

  it("rejects tampered and expired signed sessions", async () => {
    const valid = await signSession(
      { sid: "session-id", exp: Date.parse("2026-07-12T00:00:00.000Z") },
      env.SESSION_SIGNING_SECRET,
    );
    const tampered = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;

    expect(
      await verifySession(valid, env.SESSION_SIGNING_SECRET, Date.parse("2026-07-11T00:00:00Z")),
    ).toEqual({ sid: "session-id", exp: Date.parse("2026-07-12T00:00:00.000Z") });
    expect(
      await verifySession(tampered, env.SESSION_SIGNING_SECRET, Date.parse("2026-07-11T00:00:00Z")),
    ).toBeNull();
    expect(
      await verifySession(valid, env.SESSION_SIGNING_SECRET, Date.parse("2026-07-12T00:00:00Z")),
    ).toBeNull();
  });

  it("clears the device cookie on sign out", async () => {
    const response = await onRequestDelete(
      createPagesEventContext<typeof onRequestDelete>({
        request: new Request(`${origin}/api/session`, {
          method: "DELETE",
          headers: { origin },
        }),
        params: {},
        data: {},
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(
      /^yachiyo_session=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Strict$/,
    );
  });
});
