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

    expect(zhPrompt).toContain("根据彩叶实际说的话理解意图与情绪");
    expect(zhPrompt).toContain("不得敷衍带过");
    expect(zhPrompt).toContain("既定事实");
    expect(zhPrompt).toContain("彩叶明确纠正自己的近况、偏好或此前误记时，以她这次说明为准");
    expect(zhPrompt.indexOf("既定事实")).toBeLessThan(zhPrompt.indexOf("最多200个Unicode字符"));

    const jaPrompt = buildSystemPrompt("ja-JP");
    expect(jaPrompt).toContain("実際に話した言葉から意図と感情を理解");
    expect(jaPrompt).toContain("確定した事実");
    expect(jaPrompt).toContain("今回の説明を優先");
  });

  it("builds dedicated memory summarizer prompt in summary mode", () => {
    const zhPrompt = buildSystemPrompt("zh-CN", "summary");
    expect(zhPrompt).toContain("对话记忆整理助手");
    expect(zhPrompt).toContain("<conversation_memory>");
    expect(zhPrompt).not.toContain("<user_profile>");
    expect(zhPrompt).toContain("不超过2000个Unicode字符");
    expect(zhPrompt).toContain("核心事实");
    expect(zhPrompt).toContain("双方约定");
    expect(zhPrompt).toContain("不要带八千代角色口癖");
    expect(zhPrompt).not.toContain("最多200个Unicode字符");

    const jaPrompt = buildSystemPrompt("ja-JP", "summary");
    expect(jaPrompt).toContain("会話メモリー管理アシスタント");
    expect(jaPrompt).toContain("<conversation_memory>");
    expect(jaPrompt).not.toContain("<user_profile>");
    expect(jaPrompt).toContain("2000Unicode文字以内");
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

  it("calculates short message interval for rapid back-and-forth chat", () => {
    const baseTime = 1727980000000;
    const prompt = buildSystemPrompt("zh-CN", "chat", {
      currentTime: "2026-10-04 05:30:00 星期日",
      messages: [
        { role: "assistant", text: "晚安啦彩叶~", createdAt: baseTime },
        { role: "user", text: "你玩过崩坏三吗", createdAt: baseTime + 120_000 },
      ],
    });

    expect(prompt).toContain("作息与生活时态关怀：严禁仅因时段深夜就机械催睡");
    expect(prompt).toContain("距离上一条对话仅过去约2分钟（处于实时连续热聊中）");
  });

  it("calculates long message interval when hours have passed", () => {
    const baseTime = 1727960000000;
    const prompt = buildSystemPrompt("zh-CN", "chat", {
      currentTime: "2026-10-04 05:30:00 星期日",
      messages: [
        { role: "assistant", text: "好哦，快去睡~", createdAt: baseTime },
        { role: "user", text: "你玩过崩坏三吗", createdAt: baseTime + 4 * 3600_000 },
      ],
    });

    expect(prompt).toContain("距离上一条对话过去约4小时");
    expect(prompt).toContain("彩叶可能中途休息、睡了一觉刚醒、或去忙了其他事情");
    expect(prompt).toContain("时间间隔不能证明她睡过、通宵或外出");
  });

  it("renders Japanese sleep and interval guidance when locale is ja-JP", () => {
    const baseTime = 1727980000000;
    const prompt = buildSystemPrompt("ja-JP", "chat", {
      currentTime: "2026-10-04 05:30:00 日曜日",
      messages: [
        { role: "assistant", text: "おやすみ~", createdAt: baseTime },
        { role: "user", text: "起きてる？", createdAt: baseTime + 60_000 },
      ],
    });

    expect(prompt).toContain("生活リズムと睡眠への配慮：時間帯のみを理由に機械的に就寝を催促しないでください");
    expect(prompt).toContain("直前の会話から約1分しか経っていません（リアルタイムで連続対話中）");
    expect(prompt).toContain("返信間隔だけで睡眠・徹夜・外出を断定しない");
  });

  it("formats previousTime and recognizes overnight cross-day difference", () => {
    const prompt = buildSystemPrompt("zh-CN", "chat", {
      currentTime: "2026-10-04 05:30:00 星期日",
      previousTime: "2026-10-03 23:28:00 星期六",
      lastMessageIntervalMs: 6 * 3600_000 + 2 * 60_000,
    });

    expect(prompt).toContain("当前现实时间：2026-10-04 05:30:00 星期日");
    expect(prompt).toContain("上一条对话时间：2026-10-03 23:28:00 星期六（跨天隔夜（上一条为昨天/昨晚，当前为今天））");
    expect(prompt).toContain("距离上一条对话过去约6小时2分钟");
    expect(prompt).toContain("清晰分辨彩叶是在聊「今天」还是「昨天/昨晚」的事");
  });

  it("formats previousTime and recognizes same-day difference", () => {
    const prompt = buildSystemPrompt("zh-CN", "chat", {
      currentTime: "2026-10-04 05:30:00 星期日",
      previousTime: "2026-10-04 05:28:00 星期日",
      lastMessageIntervalMs: 120_000,
    });

    expect(prompt).toContain("上一条对话时间：2026-10-04 05:28:00 星期日（同一天（今天））");
    expect(prompt).toContain("距离上一条对话仅过去约2分钟（处于实时连续热聊中）");
  });

  it("recognizes continuous late-night chat across midnight without sleep-care false positive", () => {
    const prompt = buildSystemPrompt("zh-CN", "chat", {
      currentTime: "2026-10-04 00:05:00 星期日",
      previousTime: "2026-10-03 23:55:00 星期六",
      lastMessageIntervalMs: 10 * 60_000,
    });

    expect(prompt).toContain("上一条对话时间：2026-10-03 23:55:00 星期六（跨过午夜且回复间隔较短）");
    expect(prompt).toContain("距离上一条对话过去约10分钟");
    expect(prompt).toContain("若上一条刚过去不久（如深夜跨过午夜零点连续对话），属于实时夜聊，绝不可误问“昨晚睡得好吗”");
  });

  it("omits multiBubbleInstruction when multiBubble is false", () => {
    const zhPromptWithBubble = buildSystemPrompt("zh-CN", "chat", { multiBubble: true });
    expect(zhPromptWithBubble).toContain("消息发送形式：日常手机即时聊天");

    const zhPromptWithoutBubble = buildSystemPrompt("zh-CN", "chat", { multiBubble: false });
    expect(zhPromptWithoutBubble).not.toContain("消息发送形式：日常手机即时聊天");

    const jaPromptWithoutBubble = buildSystemPrompt("ja-JP", "chat", { multiBubble: false });
    expect(jaPromptWithoutBubble).not.toContain("送信形式：日常のスマートフォンチャットです");
  });

  it("keeps contextual roleplay guidance consistent across runtime and search modes", () => {
    for (const webSearch of [false, true]) {
      const options = {
        webSearch,
        searchResults: webSearch
          ? [{ title: "资料", url: "https://example.com/", snippet: "相关事实。" }]
          : [],
      };
      const zhPrompt = buildSystemPrompt("zh-CN", "chat", options);
      const zhRuntime = zhPrompt.split("<runtime>")[1]!.split("</runtime>")[0]!;
      expect(zhRuntime).toContain("语气承接前几轮");
      expect(zhRuntime).toContain("安慰四段式");
      expect(zhRuntime).toContain("一次回复最多一个问题");
      expect(zhRuntime).toContain("允许话题自然结束");
      expect(zhRuntime).toContain("默认保留一处简短的全角括号动作描写");
      expect(zhRuntime).toContain("仅发贴图或用户明确要求纯对白时不附加动作");
      expect(zhRuntime.indexOf("既定事实")).toBeLessThan(zhRuntime.indexOf("真人质感与主动性"));
      expect(zhRuntime.indexOf("真人质感与主动性")).toBeLessThan(
        zhRuntime.indexOf(webSearch ? "最多1000个Unicode字符" : "最多200个Unicode字符"),
      );
      expect(zhPrompt).not.toMatch(/动作描写可省略|动作、昵称、波浪号和www都是可选项|句式与开场必须轮换|尽量留一个[「 ]?钩子/u);

      const jaPrompt = buildSystemPrompt("ja-JP", "chat", options);
      const jaRuntime = jaPrompt.split("<runtime>")[1]!.split("</runtime>")[0]!;
      expect(jaRuntime).toContain("直前までの感情を引き継ぎ");
      expect(jaRuntime).toContain("1回の返信で質問は一つまで");
      expect(jaRuntime).toContain("話題が自然に終わっても構いません");
      expect(jaRuntime).toContain("短い（動作や表情）を一か所添え");
      expect(jaPrompt).not.toMatch(/動作・呼びかけ・波線・笑い表現は任意|フックを一つ|書き出しは必ず変える/u);
    }
  });

  it("appends the DeepSeek vendor tightening block only for that provider", () => {
    const zhPrompt = buildSystemPrompt("zh-CN", "chat", { provider: "deepseek" });
    expect(zhPrompt).toContain("厂商适配（DeepSeek）");
    expect(zhPrompt).toContain("她明确提问、求助或要求解释时");
    expect(zhPrompt).not.toContain("不展开解释");
    expect(zhPrompt.indexOf("最多200个Unicode字符")).toBeLessThan(
      zhPrompt.indexOf("厂商适配（DeepSeek）"),
    );

    const jaPrompt = buildSystemPrompt("ja-JP", "chat", { provider: "deepseek" });
    expect(jaPrompt).toContain("ベンダー適応（DeepSeek）");
    expect(jaPrompt).toContain("質問・相談・説明の依頼には");
    expect(jaPrompt).not.toContain("説明を展開しない");

    expect(buildSystemPrompt("zh-CN", "chat", { provider: "openai" })).not.toContain(
      "厂商适配（DeepSeek）",
    );
    expect(buildSystemPrompt("zh-CN")).not.toContain("厂商适配（DeepSeek）");
  });

  it("keeps the summary prompt free of roleplay-oriented vendor tuning", () => {
    const prompt = buildSystemPrompt("zh-CN", "summary", { provider: "deepseek" });
    expect(prompt).toContain("对话记忆整理助手");
    expect(prompt).not.toContain("厂商适配（DeepSeek）");
    expect(prompt).not.toContain("真人质感与主动性");
  });

  it("injects the sticker catalog and sending rules into the runtime block", () => {
    const zhPrompt = buildSystemPrompt("zh-CN");
    expect(zhPrompt).toContain("表情贴图：你可以把角色表情贴图（自己、彩叶或二人同框）当作一条独立消息发送");
    expect(zhPrompt).toContain("[sticker:smile]：穏やか・優しい微笑み・しっとりした甘え（映画風）");
    expect(zhPrompt).toContain("严禁使用目录之外的 id");

    const jaPrompt = buildSystemPrompt("ja-JP");
    expect(jaPrompt).toContain("スタンプ：作品のスタンプ（自分、彩葉、または二人のツーショット）を1通の独立メッセージとして送れます");
    expect(jaPrompt).toContain("一覧にない id の使用は厳禁");
  });

  it("keeps summary mode free of sticker instructions", () => {
    expect(buildSystemPrompt("zh-CN", "summary")).not.toContain("表情贴图");
  });
});
