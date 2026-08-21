import { describe, expect, it } from "vitest";
import { copyFor } from "./messages";

describe("copyFor", () => {
  it("returns localized reference controls", () => {
    expect(copyFor("zh-CN").capture).toBe("拍摄");
    expect(copyFor("ja-JP").capture).toBe("撮影");
    expect(copyFor("zh-CN").voiceSoon).not.toBe(copyFor("ja-JP").voiceSoon);
  });

  it("returns localized web search copy for both languages", () => {
    expect(copyFor("zh-CN").webSearchTitle).toBe("联网搜索");
    expect(copyFor("zh-CN").webSearchDescription).toBe(
      "发送前先用必应搜索网络资料，回复将基于最新信息",
    );
    expect(copyFor("zh-CN").webSearchShowSources).toBe("显示引用来源");
    expect(copyFor("zh-CN").webSearchShowSourcesDescription).toBe("在联网回复下方显示参考来源链接");
    expect(copyFor("zh-CN").sourcesLabel).toBe("参考来源");
    expect(copyFor("ja-JP").webSearchTitle).toBe("ウェブ検索");
    expect(copyFor("ja-JP").webSearchDescription).toBe(
      "送信前にBingでウェブ検索し、最新情報をもとに返信します",
    );
    expect(copyFor("ja-JP").webSearchShowSources).toBe("引用ソースを表示");
    expect(copyFor("ja-JP").webSearchShowSourcesDescription).toBe(
      "ウェブ検索の返信の下に参考ソースへのリンクを表示します",
    );
    expect(copyFor("ja-JP").sourcesLabel).toBe("参考ソース");
  });

  it("keeps both dictionaries complete, non-empty, and immutable", () => {
    const chinese = copyFor("zh-CN");
    const japanese = copyFor("ja-JP");

    expect(Object.keys(chinese).sort()).toEqual(Object.keys(japanese).sort());
    const isNonEmptyString = (value: unknown) =>
      typeof value === "string" && value.trim().length > 0;
    expect(Object.values(chinese).every((value) => isNonEmptyString(value) || typeof value === "function")).toBe(true);
    expect(Object.values(japanese).every((value) => isNonEmptyString(value) || typeof value === "function")).toBe(true);
    expect(Object.isFrozen(chinese)).toBe(true);
    expect(Object.isFrozen(japanese)).toBe(true);
  });
});
