import { describe, expect, it } from "vitest";
import { splitAssistantMessage } from "./message-splitter";

describe("splitAssistantMessage", () => {
  it("returns a typing bubble when text is empty and streaming", () => {
    const result = splitAssistantMessage("", true);
    expect(result).toEqual([{ id: "bubble-0", isTyping: true, text: "" }]);
  });

  it("returns empty array when text is empty and not streaming", () => {
    const result = splitAssistantMessage("", false);
    expect(result).toEqual([]);
  });

  it("returns a single bubble for single-line text", () => {
    const result = splitAssistantMessage("彩叶~今天也辛苦啦！", false);
    expect(result).toEqual([
      { id: "bubble-0", isTyping: false, text: "彩叶~今天也辛苦啦！" },
    ]);
  });

  it("splits multi-line text separated by newlines into multiple bubbles", () => {
    const text =
      "哦~八千代知道哦（托腮，眼睛亮起来）\n" +
      "怎么突然聊这个？大半夜的，彩叶该不会正窝在被窝里看吧？www\n" +
      "是剧情太虐了，还是喜欢上哪个魔女了呀？说来听听嘛~";
    const result = splitAssistantMessage(text, false);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      id: "bubble-0",
      isTyping: false,
      text: "哦~八千代知道哦（托腮，眼睛亮起来）",
    });
    expect(result[1]).toEqual({
      id: "bubble-1",
      isTyping: false,
      text: "怎么突然聊这个？大半夜的，彩叶该不会正窝在被窝里看吧？www",
    });
    expect(result[2]).toEqual({
      id: "bubble-2",
      isTyping: false,
      text: "是剧情太虐了，还是喜欢上哪个魔女了呀？说来听听嘛~",
    });
  });

  it("splits text separated by explicit --- divider", () => {
    const text = "第一句话\n---\n第二句话";
    const result = splitAssistantMessage(text, false);
    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe("第一句话");
    expect(result[1]?.text).toBe("第二句话");
  });

  it("splits text separated by double newlines (empty lines)", () => {
    const text = "第一段话\n\n第二段话";
    const result = splitAssistantMessage(text, false);
    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe("第一段话");
    expect(result[1]?.text).toBe("第二段话");
  });

  it("appends an in-progress typing bubble when streaming ends with a newline", () => {
    const text = "哦~八千代知道哦（托腮，眼睛亮起来）\n";
    const result = splitAssistantMessage(text, true);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "bubble-0",
      isTyping: false,
      text: "哦~八千代知道哦（托腮，眼睛亮起来）",
    });
    expect(result[1]).toEqual({
      id: "bubble-1",
      isTyping: true,
      text: "",
    });
  });

  it("does not append a typing bubble when non-streaming ends with a newline", () => {
    const text = "哦~八千代知道哦（托腮，眼睛亮起来）\n";
    const result = splitAssistantMessage(text, false);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "bubble-0",
      isTyping: false,
      text: "哦~八千代知道哦（托腮，眼睛亮起来）",
    });
  });

  it("respects enabled=false to return a single bubble without splitting", () => {
    const text = "第一句\n第二句\n第三句";
    const result = splitAssistantMessage(text, false, false);
    expect(result).toEqual([
      { id: "bubble-0", isTyping: false, text: "第一句\n第二句\n第三句" },
    ]);
  });

  it("keeps code blocks intact within a single bubble rather than splitting lines", () => {
    const text =
      "看这段代码：\n" +
      "```typescript\n" +
      "const a = 1;\n" +
      "const b = 2;\n" +
      "```\n" +
      "是不是很清晰？";
    const result = splitAssistantMessage(text, false);
    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe("看这段代码：\n```typescript\nconst a = 1;\nconst b = 2;\n```");
    expect(result[1]?.text).toBe("是不是很清晰？");
  });

  it("keeps lists and intro headers grouped in one bubble", () => {
    const text =
      "推荐清单：\n" +
      "1. 魔法少女小圆\n" +
      "2. 命运石之门\n" +
      "3. 间谍过家家\n" +
      "你最想看哪部呢？";
    const result = splitAssistantMessage(text, false);
    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe("推荐清单：\n1. 魔法少女小圆\n2. 命运石之门\n3. 间谍过家家");
    expect(result[1]?.text).toBe("你最想看哪部呢？");
  });
});
