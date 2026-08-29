import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "../../functions/_shared/providers/registry";
import {
  buildJudgeMessages,
  judgeSearchNeed,
  parseJudgeVerdict,
} from "../../functions/_shared/search-judge";
import type { ClientHistoryMessage } from "../../functions/_shared/validation";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("buildJudgeMessages", () => {
  it("selects the latest four text messages in chronological order", () => {
    const messages: ClientHistoryMessage[] = [
      { role: "user", text: "最早的消息" },
      { role: "assistant", text: "最早的回复" },
      { role: "user", text: "第二问" },
      { role: "assistant", text: "第二答" },
      { role: "user", text: "最新问题" },
    ];

    expect(buildJudgeMessages(messages)).toEqual([
      { role: "user", text: "第二问" },
      { role: "assistant", text: "第二答" },
      { role: "user", text: "最新问题" },
    ]);
  });

  it("returns null when the latest user message has no text (image-only)", () => {
    expect(buildJudgeMessages([{ role: "user", text: "", imageDataUrl: "data:image/png;base64,x" }])).toBeNull();
    expect(buildJudgeMessages([{ role: "user", text: "   " }])).toBeNull();
  });

  it("skips injected context messages and image-only history entries", () => {
    const messages: ClientHistoryMessage[] = [
      { role: "user", text: "【前情提要】背景记忆" },
      { role: "assistant", text: "好的" },
      { role: "user", text: "", imageDataUrl: "data:image/png;base64,x" },
      { role: "assistant", text: "看到了" },
      { role: "user", text: "上海天气" },
    ];

    // 注入消息与纯图片被跳过；连续 assistant 合并后位于开头，再按 Anthropic 兼容规则丢弃
    expect(buildJudgeMessages(messages)).toEqual([{ role: "user", text: "上海天气" }]);
  });

  it("drops leading assistant messages for anthropic-compatible ordering", () => {
    const messages: ClientHistoryMessage[] = [
      { role: "assistant", text: "彩叶~" },
      { role: "user", text: "你好" },
      { role: "assistant", text: "彩叶~你好！" },
      { role: "user", text: "上海天气" },
    ];

    expect(buildJudgeMessages(messages)).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "彩叶~你好！" },
      { role: "user", text: "上海天气" },
    ]);
  });

  it("truncates each message to 500 Unicode characters", () => {
    const long = "长".repeat(600);
    expect(buildJudgeMessages([{ role: "user", text: long }])).toEqual([
      { role: "user", text: "长".repeat(500) },
    ]);
  });
});

describe("parseJudgeVerdict", () => {
  it("accepts YES/NO with case and suffix tolerance", () => {
    expect(parseJudgeVerdict("YES")).toBe(true);
    expect(parseJudgeVerdict("yes")).toBe(true);
    expect(parseJudgeVerdict("YES。")).toBe(true);
    expect(parseJudgeVerdict(" No! ")).toBe(false);
    expect(parseJudgeVerdict("NO")).toBe(false);
  });

  it("returns null for unrecognizable output", () => {
    expect(parseJudgeVerdict("")).toBeNull();
    expect(parseJudgeVerdict("我觉得需要")).toBeNull();
    expect(parseJudgeVerdict("可能吧")).toBeNull();
  });
});

describe("judgeSearchNeed", () => {
  const adapter = PROVIDERS.openai;
  const messages: ClientHistoryMessage[] = [{ role: "user", text: "今天上海天气怎么样" }];

  function openaiJudgeBody(verdict: string): string {
    return JSON.stringify({ choices: [{ message: { content: verdict } }] });
  }

  it("returns the verdict on a successful judge call", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(openaiJudgeBody("YES"), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      judgeSearchNeed(adapter, "sk-" + "a".repeat(40), "gpt-5.6-luna", messages, undefined),
    ).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.accept).toBe("application/json");
    const body = JSON.parse(init?.body as string) as {
      stream: boolean;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(512);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "今天上海天气怎么样" });
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain("搜索意图判断器");
    expect(body.messages[0]?.content).toContain("网络流行语、游戏黑话、热梗、概念定义");
  });

  it("returns null without fetching when the latest message is image-only", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      judgeSearchNeed(adapter, "sk-" + "a".repeat(40), "gpt-5.6-luna", [{ role: "user", text: "" }], undefined),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for non-200 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 503 })),
    );

    await expect(
      judgeSearchNeed(adapter, "sk-" + "a".repeat(40), "gpt-5.6-luna", messages, undefined),
    ).resolves.toBeNull();
  });

  it("returns null for unparseable judge output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
        async () => new Response("not-json", { status: 200 }),
      ),
    );

    await expect(
      judgeSearchNeed(adapter, "sk-" + "a".repeat(40), "gpt-5.6-luna", messages, undefined),
    ).resolves.toBeNull();
  });

  it("returns null when the verdict text is unrecognizable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
        async () => new Response(openaiJudgeBody("我觉得可以"), { status: 200 }),
      ),
    );

    await expect(
      judgeSearchNeed(adapter, "sk-" + "a".repeat(40), "gpt-5.6-luna", messages, undefined),
    ).resolves.toBeNull();
  });

  it("silently degrades after the 4-second timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );

    const pending = judgeSearchNeed(adapter, "sk-" + "a".repeat(40), "gpt-5.6-luna", messages, undefined);
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(pending).resolves.toBeNull();
  });

  it("aborts the judge fetch when the caller signal fires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );

    const controller = new AbortController();
    const pending = judgeSearchNeed(adapter, "sk-" + "a".repeat(40), "gpt-5.6-luna", messages, controller.signal);
    controller.abort();

    await expect(pending).resolves.toBeNull();
  });
});

describe("judgeSearchNeed (gemini & claude adapters)", () => {
  it("builds non-streaming judge requests for gemini", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "NO" }] } }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      judgeSearchNeed(PROVIDERS.gemini, "g" + "a".repeat(39), "gemini-3.7-flash", [{ role: "user", text: "你好" }], undefined),
    ).resolves.toBe(false);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.accept).toBe("application/json");
  });

  it("builds non-streaming judge requests for claude", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ content: [{ type: "text", text: "YES" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      judgeSearchNeed(PROVIDERS.claude, "sk-ant-" + "a".repeat(40), "claude-sonnet-5", [{ role: "user", text: "最新新闻" }], undefined),
    ).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(init?.body as string) as { stream: boolean; max_tokens: number };
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(256);
  });
});
