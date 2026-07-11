import { describe, expect, it } from "vitest";
import { copyFor } from "./messages";

describe("copyFor", () => {
  it("returns localized reference controls", () => {
    expect(copyFor("zh-CN").capture).toBe("拍摄");
    expect(copyFor("ja-JP").capture).toBe("撮影");
    expect(copyFor("zh-CN").voiceSoon).not.toBe(copyFor("ja-JP").voiceSoon);
  });

  it("keeps both dictionaries complete, non-empty, and immutable", () => {
    const chinese = copyFor("zh-CN");
    const japanese = copyFor("ja-JP");

    expect(Object.keys(chinese).sort()).toEqual(Object.keys(japanese).sort());
    expect(Object.values(chinese).every((value) => value.trim().length > 0)).toBe(true);
    expect(Object.values(japanese).every((value) => value.trim().length > 0)).toBe(true);
    expect(Object.isFrozen(chinese)).toBe(true);
    expect(Object.isFrozen(japanese)).toBe(true);
  });
});
