import { Capacitor } from "@capacitor/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, cycleApiOrigin, currentApiOrigin } from "./api-origins";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));

const primaryOrigin = "https://yachiyochat.amtale.cn";
const fallbackOrigin = "https://yachiyo-chat-brn.pages.dev";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("api-origins (web)", () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });

  it("keeps same-origin relative requests without failover", async () => {
    const fetcher = vi.fn(async () => new Response("ok"));
    const response = await apiFetch("/api/session", { method: "GET" }, { fetcher });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/session", { method: "GET" });
  });

  it("rethrows network failures without retrying (single candidate)", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(apiFetch("/api/session", { method: "GET" }, { fetcher })).rejects.toThrow(
      TypeError,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not cycle origins on the web build", () => {
    const storage = memoryStorage();

    expect(cycleApiOrigin(storage)).toBe("");
    expect(currentApiOrigin(storage)).toBe("");
  });
});

describe("api-origins (native)", () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  });

  it("targets the primary origin by default", () => {
    expect(currentApiOrigin(memoryStorage())).toBe(primaryOrigin);
  });

  it("falls back to the secondary origin on network failure and remembers it", async () => {
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("ok"));
    const storage = memoryStorage();

    const response = await apiFetch(
      "/api/session",
      { method: "POST", body: "{}", headers: { "content-type": "application/json" } },
      { fetcher, storage },
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${primaryOrigin}/api/session`);
    expect(fetcher.mock.calls[1]?.[0]).toBe(`${fallbackOrigin}/api/session`);
    expect(storage.getItem("yachiyo-api-origin-v1")).toBe(fallbackOrigin);
    // 下一次请求直接走记住的线路
    await apiFetch("/api/session", { method: "GET" }, { fetcher, storage });
    expect(fetcher.mock.calls[2]?.[0]).toBe(`${fallbackOrigin}/api/session`);
  });

  it("does not fall back on HTTP error responses", async () => {
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response("denied", { status: 503 }));
    const storage = memoryStorage();

    const response = await apiFetch("/api/session", { method: "POST", body: "{}" }, { fetcher, storage });

    expect(response.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(storage.getItem("yachiyo-api-origin-v1")).toBeNull();
  });

  it("rethrows abort errors without failover", async () => {
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValue(new DOMException("Aborted", "AbortError"));

    await expect(
      apiFetch("/api/chat", { method: "POST", body: "{}" }, { fetcher, storage: memoryStorage() }),
    ).rejects.toThrow(DOMException);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("throws the original error when every candidate fails", async () => {
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      apiFetch("/api/session", { method: "POST", body: "{}" }, { fetcher, storage: memoryStorage() }),
    ).rejects.toThrow(TypeError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("skips failover when the request body cannot be re-sent", async () => {
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const stream = new ReadableStream<Uint8Array>();

    await expect(
      apiFetch("/api/chat", { method: "POST", body: stream }, { fetcher, storage: memoryStorage() }),
    ).rejects.toThrow(TypeError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("cycles through candidate origins for manual line switching", () => {
    const storage = memoryStorage();

    expect(cycleApiOrigin(storage)).toBe(fallbackOrigin);
    expect(currentApiOrigin(storage)).toBe(fallbackOrigin);
    expect(cycleApiOrigin(storage)).toBe(primaryOrigin);
    expect(currentApiOrigin(storage)).toBe(primaryOrigin);
  });

  it("ignores stored origins that are no longer candidates", () => {
    const storage = memoryStorage();
    storage.setItem("yachiyo-api-origin-v1", "https://stale.example.com");

    expect(currentApiOrigin(storage)).toBe(primaryOrigin);
  });
});
