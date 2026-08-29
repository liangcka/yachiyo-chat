import { describe, expect, it } from "vitest";
import { SearchOrchestrator } from "../../../functions/_shared/web-search/orchestrator";
import { BaseWebSearchProvider } from "../../../functions/_shared/web-search/providers/base";
import { WebSearchProviderRegistry } from "../../../functions/_shared/web-search/providers/registry";
import type { WebSearchRequest } from "../../../functions/_shared/web-search/providers/types";
import type { WebSearchResult } from "../../../functions/_shared/web-search/types";

class MockProvider extends BaseWebSearchProvider {
  public aborted = false;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly isAvailable: boolean,
    private readonly delayMs: number,
    private readonly mockResults: WebSearchResult[] | Error,
  ) {
    super();
  }

  available(): boolean {
    return this.isAvailable;
  }

  async search(_request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult[]> {
    if (signal?.aborted) {
      this.aborted = true;
      throw new Error("aborted");
    }

    return new Promise<WebSearchResult[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.mockResults instanceof Error) {
          reject(this.mockResults);
        } else {
          resolve(this.mockResults);
        }
      }, this.delayMs);

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            this.aborted = true;
            clearTimeout(timer);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      }
    });
  }
}

describe("SearchOrchestrator", () => {
  it("returns empty array for empty or whitespace query", async () => {
    const orchestrator = new SearchOrchestrator();
    expect(await orchestrator.search({ query: "" })).toEqual([]);
    expect(await orchestrator.search({ query: ["  ", ""] })).toEqual([]);
  });

  it("runs batch of 2 in parallel and picks first non-empty success, aborting the slower provider", async () => {
    const p1 = new MockProvider("p1", "Provider 1", true, 100, [
      { title: "慢结果", url: "https://example.com/slow", snippet: "慢" },
    ]);
    const p2 = new MockProvider("p2", "Provider 2", true, 10, [
      { title: "快结果", url: "https://example.com/fast", snippet: "快" },
    ]);

    const registry = new WebSearchProviderRegistry([p1, p2]);
    const orchestrator = new SearchOrchestrator({ registry });

    const results = await orchestrator.search({ query: "测试查询" });
    expect(results).toEqual([
      { title: "快结果", url: "https://example.com/fast", snippet: "快" },
    ]);
    expect(p1.aborted).toBe(true);
  });

  it("cascades to next batch when first batch all fail or return empty", async () => {
    const p1 = new MockProvider("p1", "Provider 1", true, 10, new Error("API down"));
    const p2 = new MockProvider("p2", "Provider 2", true, 15, []);
    const p3 = new MockProvider("p3", "Provider 3", true, 10, [
      { title: "二批成功结果", url: "https://example.com/p3", snippet: "内容" },
    ]);

    const registry = new WebSearchProviderRegistry([p1, p2, p3]);
    const orchestrator = new SearchOrchestrator({ registry });

    const results = await orchestrator.search({ query: "测试查询" });
    expect(results).toEqual([
      { title: "二批成功结果", url: "https://example.com/p3", snippet: "内容" },
    ]);
  });

  it("skips unavailable providers", async () => {
    const p1 = new MockProvider("p1", "Provider 1", false, 0, [
      { title: "不可用", url: "https://example.com/p1", snippet: "内容" },
    ]);
    const p2 = new MockProvider("p2", "Provider 2", true, 10, [
      { title: "可用", url: "https://example.com/p2", snippet: "内容" },
    ]);

    const registry = new WebSearchProviderRegistry([p1, p2]);
    const orchestrator = new SearchOrchestrator({ registry });

    const results = await orchestrator.search({ query: "测试" });
    expect(results).toEqual([
      { title: "可用", url: "https://example.com/p2", snippet: "内容" },
    ]);
  });

  it("behaves identically to serial execution when only one provider is available", async () => {
    const p1 = new MockProvider("p1", "Provider 1", true, 10, [
      { title: "单一结果", url: "https://example.com/single", snippet: "内容" },
    ]);

    const registry = new WebSearchProviderRegistry([p1]);
    const orchestrator = new SearchOrchestrator({ registry });

    const results = await orchestrator.search({ query: "测试" });
    expect(results).toEqual([
      { title: "单一结果", url: "https://example.com/single", snippet: "内容" },
    ]);
  });

  it("aborts all running providers when caller AbortSignal fires", async () => {
    const p1 = new MockProvider("p1", "Provider 1", true, 200, [
      { title: "P1", url: "https://example.com/p1", snippet: "内容" },
    ]);
    const p2 = new MockProvider("p2", "Provider 2", true, 200, [
      { title: "P2", url: "https://example.com/p2", snippet: "内容" },
    ]);

    const registry = new WebSearchProviderRegistry([p1, p2]);
    const orchestrator = new SearchOrchestrator({ registry });

    const controller = new AbortController();
    const searchPromise = orchestrator.search({ query: "测试", signal: controller.signal });
    controller.abort();

    const results = await searchPromise;
    expect(results).toEqual([]);
    expect(p1.aborted).toBe(true);
    expect(p2.aborted).toBe(true);
  });

  it("applies domain deduplication and maxResults limit", async () => {
    const p1 = new MockProvider("p1", "Provider 1", true, 10, [
      { title: "A1", url: "https://site.example.com/1", snippet: "1" },
      { title: "A2", url: "https://site.example.com/2", snippet: "2" },
      { title: "A3", url: "https://site.example.com/3", snippet: "3" }, // Should be dropped (>2 per domain)
      { title: "B1", url: "https://other.example.org/1", snippet: "1" },
    ]);

    const registry = new WebSearchProviderRegistry([p1]);
    const orchestrator = new SearchOrchestrator({ registry });

    const results = await orchestrator.search({ query: "测试", locale: "zh-CN", smart: false });
    expect(results.map((r) => r.title)).toEqual(["A1", "A2", "B1"]);
  });
});
