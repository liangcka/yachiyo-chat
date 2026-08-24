import { onRequest } from "../../functions/api/_middleware";
import { describe, expect, it, vi } from "vitest";

const apiOrigin = "https://yachiyochat.amtale.cn";

function optionsRequest(origin: string): Request {
  return new Request(`${apiOrigin}/api/chat`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
}

function invoke(request: Request, upstream: Response): Promise<Response> {
  const next = vi.fn().mockResolvedValue(upstream);
  return onRequest({ request, next }) as Promise<Response>;
}

describe("/api middleware CORS", () => {
  it("answers the preflight for the native app origin", async () => {
    const response = await invoke(
      optionsRequest("https://localhost"),
      new Response(null, { status: 404 }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, DELETE, OPTIONS",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("rejects preflights from unknown origins", async () => {
    const response = await invoke(
      optionsRequest("https://attacker.test"),
      new Response(null, { status: 404 }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "ORIGIN_NOT_ALLOWED" } });
  });

  it("attaches CORS headers to upstream responses for the native app origin", async () => {
    const upstream = new Response('{"authenticated":true}', {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

    const response = await invoke(
      new Request(`${apiOrigin}/api/session`, {
        headers: { origin: "https://localhost" },
      }),
      upstream,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.text()).toBe('{"authenticated":true}');
  });

  it("leaves same-origin responses untouched", async () => {
    const upstream = new Response('{"authenticated":false}', {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

    const response = await invoke(
      new Request(`${apiOrigin}/api/session`, {
        headers: { origin: apiOrigin },
      }),
      upstream,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
