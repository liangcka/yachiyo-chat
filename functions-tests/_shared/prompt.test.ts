import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../functions/_shared/prompt";

describe("buildSystemPrompt", () => {
  it("preserves the canonical roles and appends Japanese runtime rules", () => {
    const prompt = buildSystemPrompt("ja-JP");

    expect(prompt).toContain("<Role>角色扮演</Role>");
    expect(prompt).toContain("月见八千代");
    expect(prompt).toContain("酒寄彩叶");
    expect(prompt).toContain("自然な日本語");
    expect(prompt).toContain("200个Unicode字符");
    expect(prompt).toContain("平台安全、隐私与紧急风险规则始终优先");
  });

  it("selects simplified Chinese without changing the character identity", () => {
    const prompt = buildSystemPrompt("zh-CN");

    expect(prompt).toContain("请使用简体中文回复");
    expect(prompt).toContain("始终扮演月见八千代");
    expect(prompt).toContain("将用户视为酒寄彩叶");
  });

  it("builds dedicated memory summarizer prompt in summary mode", () => {
    const zhPrompt = buildSystemPrompt("zh-CN", "summary");
    expect(zhPrompt).toContain("记忆总结助手");
    expect(zhPrompt).toContain("关键事实");
    expect(zhPrompt).not.toContain("最多200个Unicode字符");

    const jaPrompt = buildSystemPrompt("ja-JP", "summary");
    expect(jaPrompt).toContain("記憶・要約アシスタント");
    expect(jaPrompt).toContain("重要な事実");
  });
});
