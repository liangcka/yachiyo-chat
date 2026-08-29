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

  it("adds depth and memory-trust instructions to the runtime block", () => {
    const zhPrompt = buildSystemPrompt("zh-CN");

    expect(zhPrompt).toContain("真实意图与情绪");
    expect(zhPrompt).toContain("不得敷衍带过");
    expect(zhPrompt).toContain("既定事实");
    expect(zhPrompt.indexOf("既定事实")).toBeLessThan(zhPrompt.indexOf("最多200个Unicode字符"));

    const jaPrompt = buildSystemPrompt("ja-JP");
    expect(jaPrompt).toContain("本当の意図と感情");
    expect(jaPrompt).toContain("確定した事実");
  });

  it("builds dedicated memory summarizer prompt in summary mode", () => {
    const zhPrompt = buildSystemPrompt("zh-CN", "summary");
    expect(zhPrompt).toContain("对话记忆整理助手");
    expect(zhPrompt).toContain("<conversation_memory>");
    expect(zhPrompt).toContain("<user_profile>");
    expect(zhPrompt).toContain("核心事实");
    expect(zhPrompt).toContain("双方约定");
    expect(zhPrompt).toContain("不要带八千代角色口癖");
    expect(zhPrompt).not.toContain("最多200个Unicode字符");

    const jaPrompt = buildSystemPrompt("ja-JP", "summary");
    expect(jaPrompt).toContain("会話メモリー管理アシスタント");
    expect(jaPrompt).toContain("<conversation_memory>");
    expect(jaPrompt).toContain("<user_profile>");
    expect(jaPrompt).toContain("核心的事実");
  });

  it("relaxes the runtime output cap to 1000 characters when web search is on", () => {
    for (const locale of ["zh-CN", "ja-JP"] as const) {
      const prompt = buildSystemPrompt(locale, "chat", { webSearch: true });
      expect(prompt).toContain("输出最多1000个Unicode字符，优先50至200字符");
      expect(prompt).not.toContain("200个Unicode字符");
    }
  });

  it("appends the numbered web search results block after the runtime section", () => {
    const prompt = buildSystemPrompt("zh-CN", "chat", {
      webSearch: true,
      searchResults: [
        { title: "上海天气", url: "https://weather.example.cn/", snippet: "今日多云，24至30度。" },
        { title: "第二来源", url: "https://news.example.org/", snippet: "摘要内容。" },
      ],
    });

    expect(prompt.indexOf("</runtime>")).toBeLessThan(prompt.indexOf("<web_search_results>"));
    expect(prompt).toContain("以下是针对用户最新消息的网络搜索结果，按相关度排序：");
    expect(prompt).toContain("[1] 上海天气（https://weather.example.cn/）\n今日多云，24至30度。");
    expect(prompt).toContain("[2] 第二来源（https://news.example.org/）\n摘要内容。");
    expect(prompt).toContain("联网模式已开启");
    expect(prompt).toContain("用 [1]、[2] 这样的数字序号标注引用的来源");
    expect(prompt).toContain("以它们为准，不要固执旧答案");
  });

  it("prefers fetched page content over the snippet when present", () => {
    const prompt = buildSystemPrompt("zh-CN", "chat", {
      webSearch: true,
      searchResults: [
        {
          title: "上海天气",
          url: "https://weather.example.cn/",
          snippet: "今日多云。",
          content: "这是抓取到的完整页面正文，包含比 RSS 摘要更详细的天气信息。",
        },
        { title: "第二来源", url: "https://news.example.org/", snippet: "摘要内容。" },
      ],
    });

    expect(prompt).toContain(
      "[1] 上海天气（https://weather.example.cn/）\n这是抓取到的完整页面正文，包含比 RSS 摘要更详细的天气信息。",
    );
    expect(prompt).not.toContain("[1] 上海天气（https://weather.example.cn/）\n今日多云。");
    expect(prompt).toContain("[2] 第二来源（https://news.example.org/）\n摘要内容。");
  });

  it("renders the Japanese web search block instructions", () => {
    const prompt = buildSystemPrompt("ja-JP", "chat", {
      webSearch: true,
      searchResults: [{ title: "天気", url: "https://weather.example.jp/", snippet: "晴れ。" }],
    });

    expect(prompt).toContain("<web_search_results>");
    expect(prompt).toContain("[1] 天気（https://weather.example.jp/）\n晴れ。");
    expect(prompt).toContain("ウェブ検索モードが有効です");
    expect(prompt).toContain("[1]、[2] のような数字で引用した出典の番号");
  });

  it("annotates sources with publish dates and recency guidance in smart mode", () => {
    const prompt = buildSystemPrompt("zh-CN", "chat", {
      webSearch: true,
      smartSearch: true,
      searchResults: [
        {
          title: "Gemini 3.7 Flash",
          url: "https://deepmind.google/models/gemini/flash/",
          snippet: "最新模型。",
          publishedAt: "2026-08-20",
        },
        { title: "旧消息", url: "https://legacy.example.com/", snippet: "无日期。" },
      ],
    });

    expect(prompt).toContain(
      "[1] Gemini 3.7 Flash（https://deepmind.google/models/gemini/flash/，发布于2026-08-20）\n最新模型。",
    );
    expect(prompt).toContain("[2] 旧消息（https://legacy.example.com/，发布日期未知）\n无日期。");
    expect(prompt).toContain("优先采信发布日期更新、来自官方或权威站点的结果");
    expect(prompt).toContain("以发布日期最近的结果为准");
  });

  it("keeps the plain source format without smart mode", () => {
    const prompt = buildSystemPrompt("zh-CN", "chat", {
      webSearch: true,
      searchResults: [
        {
          title: "带日期结果",
          url: "https://example.com/",
          snippet: "摘要。",
          publishedAt: "2026-08-20",
        },
      ],
    });

    expect(prompt).toContain("[1] 带日期结果（https://example.com/）\n摘要。");
    expect(prompt).not.toContain("发布于2026-08-20");
    expect(prompt).not.toContain("优先采信发布日期更新");
  });

  it("injects the provided current time into the runtime prompt", () => {
    const zhPrompt = buildSystemPrompt("zh-CN", "chat", {
      currentTime: "2026-08-27 11:09:37 星期四",
    });
    expect(zhPrompt).toContain("当前现实时间：2026-08-27 11:09:37 星期四。请结合当前时间与时段（如早晚问候、季节时令等）进行自然贴切的互动。");

    const jaPrompt = buildSystemPrompt("ja-JP", "chat", {
      currentTime: "2026-08-27 11:09:37 木曜日",
    });
    expect(jaPrompt).toContain("現在の現実時間：2026-08-27 11:09:37 木曜日。時間帯や季節に応じた挨拶や話題を自然に反映してください。");
  });

  it("injects fallback server time when currentTime is not specified", () => {
    const zhPrompt = buildSystemPrompt("zh-CN");
    expect(zhPrompt).toMatch(/当前现实时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} 星期[日一二三四五六] \(UTC\)。/u);

    const jaPrompt = buildSystemPrompt("ja-JP");
    expect(jaPrompt).toMatch(/現在の現実時間：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [日月火水木金土]曜日 \(UTC\)。/u);
  });

  it("keeps summary mode unchanged regardless of web search options", () => {
    const prompt = buildSystemPrompt("zh-CN", "summary", {
      webSearch: true,
      searchResults: [{ title: "t", url: "https://example.com/", snippet: "s" }],
      currentTime: "2026-08-27 11:09:37 星期四",
    });

    expect(prompt).toContain("对话记忆整理助手");
    expect(prompt).not.toContain("<web_search_results>");
    expect(prompt).not.toContain("1000个Unicode字符");
    expect(prompt).not.toContain("当前现实时间");
  });
});
