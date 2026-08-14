import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionClient, SessionClientError } from "./session-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SessionClient", () => {
  let serverFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  let client: SessionClient;

  beforeEach(() => {
    serverFetch = vi.fn<typeof fetch>();
    client = new SessionClient(serverFetch, () => "test-device-123");
  });

  it("checks the same-origin session with credentials", async () => {
    serverFetch.mockResolvedValue(jsonResponse({ authenticated: true }));

    await expect(client.check()).resolves.toBe(true);
    expect(serverFetch).toHaveBeenCalledWith("/api/session", {
      credentials: "same-origin",
      method: "GET",
      signal: undefined,
    });
  });

  it("invokes browser fetch without rebinding its receiver", async () => {
    const bindingSensitiveFetch = vi.fn(function (this: unknown) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      return Promise.resolve(jsonResponse({ authenticated: false }));
    }) as unknown as typeof fetch;
    const bindingSafeClient = new SessionClient(bindingSensitiveFetch);

    await expect(bindingSafeClient.check()).resolves.toBe(false);
  });

  it("authenticates without retaining or logging the access code", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const secret = "correct horse moonlight";
    serverFetch.mockResolvedValue(new Response(null, { status: 204 }));

    await client.authenticate(secret);

    const [, init] = serverFetch.mock.calls[0] ?? [];
    expect(serverFetch).toHaveBeenCalledWith("/api/session", {
      body: JSON.stringify({ accessCode: secret, deviceId: "test-device-123" }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: undefined,
    });
    expect(init?.body).toBe(
      JSON.stringify({ accessCode: secret, deviceId: "test-device-123" }),
    );
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("maps only stable server problem codes", async () => {
    serverFetch.mockResolvedValue(
      jsonResponse({ error: { code: "AUTH_RATE_LIMITED", detail: "do not expose" } }, 429),
    );

    await expect(client.authenticate("wrong")).rejects.toMatchObject({
      code: "AUTH_RATE_LIMITED",
      status: 429,
    });
  });

  it("maps network failures and supports sign out", async () => {
    serverFetch.mockRejectedValueOnce(new Error("socket detail"));
    await expect(client.check()).rejects.toEqual(
      expect.objectContaining<Partial<SessionClientError>>({ code: "NETWORK_ERROR" }),
    );

    serverFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.signOut();
    expect(serverFetch).toHaveBeenLastCalledWith("/api/session", {
      credentials: "same-origin",
      method: "DELETE",
      signal: undefined,
    });
  });
});
