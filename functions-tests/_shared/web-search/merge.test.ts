import { describe, expect, it } from "vitest";
import {
  dedupeByDomain,
  maximumSmartResults,
  maximumStandardResults,
  mergeRoundRobin,
  mergeSearchResults,
  registrableDomain,
} from "../../../functions/_shared/web-search/merge";
import type { WebSearchResult } from "../../../functions/_shared/web-search/types";

function makeResult(id: string, url?: string): WebSearchResult {
  return {
    title: `标题-${id}`,
    url: url ?? `https://example.com/page-${id}`,
    snippet: `摘要-${id}`,
  };
}

describe("mergeRoundRobin", () => {
  it("returns an empty array when input lists are empty or maxResults is zero", () => {
    expect(mergeRoundRobin([])).toEqual([]);
    expect(mergeRoundRobin([[], []])).toEqual([]);
    expect(mergeRoundRobin([[makeResult("1")]], 0)).toEqual([]);
    expect(mergeRoundRobin([[makeResult("1")]], -1)).toEqual([]);
  });

  it("interleaves items from multiple lists in rank order (Round-Robin)", () => {
    const listA = [makeResult("a0"), makeResult("a1"), makeResult("a2")];
    const listB = [makeResult("b0"), makeResult("b1"), makeResult("b2")];
    const listC = [makeResult("c0"), makeResult("c1"), makeResult("c2")];

    const merged = mergeRoundRobin([listA, listB, listC], 10);
    expect(merged.map((r) => r.title)).toEqual([
      "标题-a0",
      "标题-b0",
      "标题-c0",
      "标题-a1",
      "标题-b1",
      "标题-c1",
      "标题-a2",
      "标题-b2",
      "标题-c2",
    ]);
  });

  it("handles lists of unequal length without gaps or errors", () => {
    const listA = [makeResult("a0"), makeResult("a1"), makeResult("a2")];
    const listB = [makeResult("b0")];
    const listC = [makeResult("c0"), makeResult("c1")];

    const merged = mergeRoundRobin([listA, listB, listC], 10);
    expect(merged.map((r) => r.title)).toEqual([
      "标题-a0",
      "标题-b0",
      "标题-c0",
      "标题-a1",
      "标题-c1",
      "标题-a2",
    ]);
  });

  it("deduplicates identical URLs across lists and retains first occurrence", () => {
    const listA = [
      makeResult("shared-0", "https://site.org/shared"),
      makeResult("a1", "https://site.org/a1"),
    ];
    const listB = [
      makeResult("shared-duplicate", "https://site.org/shared"),
      makeResult("b1", "https://site.org/b1"),
    ];

    const merged = mergeRoundRobin([listA, listB], 10);
    expect(merged).toHaveLength(3);
    expect(merged.map((r) => r.title)).toEqual(["标题-shared-0", "标题-a1", "标题-b1"]);
  });

  it("stops immediately when maxResults is reached", () => {
    const listA = [makeResult("a0"), makeResult("a1"), makeResult("a2")];
    const listB = [makeResult("b0"), makeResult("b1"), makeResult("b2")];

    const merged = mergeRoundRobin([listA, listB], 3);
    expect(merged).toHaveLength(3);
    expect(merged.map((r) => r.title)).toEqual(["标题-a0", "标题-b0", "标题-a1"]);

    const standardMerged = mergeRoundRobin([listA, listB], maximumStandardResults);
    expect(standardMerged).toHaveLength(maximumStandardResults);
  });
});

describe("mergeSearchResults", () => {
  it("interleaves primary and secondary results with maximumSmartResults limit", () => {
    const primary = Array.from({ length: 7 }, (_, i) => makeResult(`p${i}`));
    const secondary = Array.from({ length: 7 }, (_, i) => makeResult(`s${i}`));

    const merged = mergeSearchResults(primary, secondary);
    expect(merged).toHaveLength(maximumSmartResults); // 10
    expect(merged[0]?.title).toBe("标题-p0");
    expect(merged[1]?.title).toBe("标题-s0");
    expect(merged[2]?.title).toBe("标题-p1");
    expect(merged[3]?.title).toBe("标题-s1");
  });
});

describe("registrableDomain", () => {
  it("extracts domain correctly for two-label hostnames", () => {
    expect(registrableDomain("https://example.com/path")).toBe("example.com");
    expect(registrableDomain("https://baidu.cn/search")).toBe("baidu.cn");
  });

  it("extracts registrable domain for multi-level suffixes like .co.jp or .com.cn", () => {
    expect(registrableDomain("https://sub.blog.example.co.jp/")).toBe("example.co.jp");
    expect(registrableDomain("https://news.api.sina.com.cn/story")).toBe("sina.com.cn");
    expect(registrableDomain("https://lab.univ.ac.jp/index")).toBe("univ.ac.jp");
  });

  it("returns hostname for short hostnames or null for invalid URLs", () => {
    expect(registrableDomain("https://localhost/")).toBe("localhost");
    expect(registrableDomain("invalid-url")).toBeNull();
  });
});

describe("dedupeByDomain", () => {
  it("keeps at most two results per registrable domain", () => {
    const results: WebSearchResult[] = [
      makeResult("1", "https://news.example.com/1"),
      makeResult("2", "https://blog.example.com/2"),
      makeResult("3", "https://forum.example.com/3"), // 超过2条，应丢弃
      makeResult("4", "https://other.org/4"),
    ];

    const deduped = dedupeByDomain(results);
    expect(deduped).toHaveLength(3);
    expect(deduped.map((r) => r.title)).toEqual(["标题-1", "标题-2", "标题-4"]);
  });

  it("preserves results with unparseable domain", () => {
    const results: WebSearchResult[] = [
      makeResult("1", "not-a-valid-url"),
      makeResult("2", "not-a-valid-url-2"),
    ];
    expect(dedupeByDomain(results)).toHaveLength(2);
  });
});
