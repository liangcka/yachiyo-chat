import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App, type AppRepository, type AppServices, type SessionService } from "../App";
import { YachiyoDatabase } from "../data/db";
import type { ChatMessage, Conversation, Locale, StoredImage } from "../domain/chat";
import type { ProcessedImage } from "../features/capture/image-processor";
import type { StreamChatFunction } from "../app/use-chat-controller";
import { ChatClientError } from "../services/chat-client";
import { LlmSettingsService } from "../services/llm-settings";
import { SessionClientError } from "../services/session-client";
import { WebSearchSettingsService } from "../services/web-search-settings";

class MemoryRepository implements AppRepository {
  conversations: Conversation[] = [];
  messages: ChatMessage[] = [];
  images: StoredImage[] = [];
  locale: Locale = "zh-CN";
  private sequence = 0;

  async createConversation(locale: Locale, now = Date.now()): Promise<Conversation> {
    const conversation: Conversation = {
      createdAt: now,
      id: `conversation-${++this.sequence}`,
      locale,
      title: locale === "ja-JP" ? "新しい会話" : "新的对话",
      updatedAt: now,
    };
    this.conversations.push(conversation);
    return conversation;
  }

  async listConversations(): Promise<Conversation[]> {
    return [...this.conversations].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return this.conversations.find((conversation) => conversation.id === id);
  }

  async renameConversation(id: string, title: string): Promise<void> {
    const conversation = await this.getConversation(id);
    if (conversation !== undefined) conversation.title = title.trim();
  }

  async updateConversationSummary(
    id: string,
    summary: string,
    now = Date.now(),
    compressedUpTo?: number,
  ): Promise<void> {
    const conversation = await this.getConversation(id);
    if (conversation !== undefined) {
      conversation.summary = summary;
      conversation.lastCompressedAt = now;
      if (compressedUpTo !== undefined) conversation.compressedUpTo = compressedUpTo;
      conversation.updatedAt = now;
    }
  }

  private userMemory = "";

  async getUserMemory(): Promise<string> {
    return this.userMemory;
  }

  async updateUserMemory(memory: string): Promise<void> {
    this.userMemory = memory;
  }

  async deleteConversation(id: string): Promise<void> {
    this.conversations = this.conversations.filter((conversation) => conversation.id !== id);
    this.messages = this.messages.filter((message) => message.conversationId !== id);
    this.images = this.images.filter((image) => image.conversationId !== id);
  }

  async listMessages(conversationId: string): Promise<ChatMessage[]> {
    return this.messages
      .filter((message) => message.conversationId === conversationId)
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  async putMessage(message: ChatMessage): Promise<void> {
    this.messages = [...this.messages.filter(({ id }) => id !== message.id), { ...message }];
    const conversation = await this.getConversation(message.conversationId);
    if (conversation !== undefined) conversation.updatedAt = Math.max(conversation.updatedAt, message.createdAt);
  }

  async replaceMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
    this.messages = this.messages.filter((message) => message.conversationId !== conversationId);
    this.messages.push(...messages);
    const conversation = await this.getConversation(conversationId);
    if (conversation !== undefined) conversation.updatedAt = Date.now();
  }

  async deleteMessagesFrom(conversationId: string, fromCreatedAt: number): Promise<void> {
    this.messages = this.messages.filter(
      (message) => !(message.conversationId === conversationId && message.createdAt >= fromCreatedAt),
    );
  }

  async putImage(image: StoredImage): Promise<void> {
    this.images = [...this.images.filter(({ id }) => id !== image.id), image];
  }

  async getImage(id: string): Promise<StoredImage | undefined> {
    return this.images.find((image) => image.id === id);
  }

  async setLocale(locale: Locale): Promise<void> {
    this.locale = locale;
  }

  async getLocale(): Promise<Locale> {
    return this.locale;
  }

  async setConversationLocale(id: string, locale: Locale): Promise<void> {
    const conversation = await this.getConversation(id);
    if (conversation !== undefined) conversation.locale = locale;
  }

  async clearAll(): Promise<void> {
    this.conversations = [];
    this.messages = [];
    this.images = [];
    this.locale = "zh-CN";
  }
}

const processedImage: ProcessedImage = {
  blob: new Blob(["safe-image"], { type: "image/jpeg" }),
  dataUrl: "data:image/jpeg;base64,c2FmZS1pbWFnZQ==",
  height: 480,
  mimeType: "image/jpeg",
  width: 640,
};

function fakeServices(options: {
  authenticated?: boolean;
  authenticateError?: SessionClientError;
  llmSettings?: LlmSettingsService;
  repository?: MemoryRepository;
  stream?: StreamChatFunction;
  webSearchSettings?: WebSearchSettingsService;
} = {}): AppServices & { repository: MemoryRepository; session: SessionService } {
  const session: SessionService = {
    authenticate: vi.fn(async () => {
      if (options.authenticateError !== undefined) throw options.authenticateError;
    }),
    check: vi.fn(async () => options.authenticated ?? true),
    signOut: vi.fn(async () => undefined),
  };
  return {
    processImage: vi.fn(async () => processedImage),
    repository: options.repository ?? new MemoryRepository(),
    session,
    streamChat:
      options.stream ??
      vi.fn<StreamChatFunction>(async (_request, streamOptions) => {
        streamOptions.onDelta("先休息一下吧~（轻轻握住你的手）");
        return { truncated: false };
      }),
    ...(options.llmSettings === undefined ? {} : { llmSettings: options.llmSettings }),
    ...(options.webSearchSettings === undefined
      ? {}
      : { webSearchSettings: options.webSearchSettings }),
  };
}

describe("App flows", () => {
  it("authenticates and switches the complete interface to Japanese", async () => {
    const user = userEvent.setup();
    const services = fakeServices({ authenticated: false });
    render(<App services={services} />);

    const accessCode = await screen.findByLabelText("访问码");
    await user.type(accessCode, "correct horse moonlight");
    await user.click(screen.getByRole("button", { name: "进入" }));
    expect(await screen.findByPlaceholderText("什么都可以告诉我")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "菜单" }));
    await user.click(screen.getByRole("button", { name: "日本語" }));
    await waitFor(() => expect(screen.getByPlaceholderText("何でも話してね")).toBeInTheDocument());
    expect(services.repository.locale).toBe("ja-JP");
    expect(document.documentElement.lang).toBe("ja-JP");
    expect(services.session.authenticate).toHaveBeenCalledWith("correct horse moonlight");
  });

  it("clears and refocuses the access field after a wrong code", async () => {
    const user = userEvent.setup();
    render(
      <App
        services={fakeServices({
          authenticated: false,
          authenticateError: new SessionClientError("ACCESS_DENIED", 403),
        })}
      />,
    );
    const input = await screen.findByLabelText("访问码");
    await user.type(input, "this code is incorrect");
    await user.click(screen.getByRole("button", { name: "进入" }));

    expect(await screen.findByText("访问码不正确，请重试。")).toBeVisible();
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("sends text, streams a reply, and persists both messages", async () => {
    const user = userEvent.setup();
    const services = fakeServices();
    render(<App services={services} />);
    const composer = await screen.findByPlaceholderText("什么都可以告诉我");

    await user.type(composer, "今天有点累");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("先休息一下吧~（轻轻握住你的手）")).toBeVisible();
    expect(services.repository.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", text: "今天有点累" }),
        expect.objectContaining({ role: "assistant", status: "complete", text: "先休息一下吧~（轻轻握住你的手）" }),
      ]),
    );
  });

  it("toggles web search, sends webSearch requests, and renders or hides source links", async () => {
    const user = userEvent.setup();
    const db = new YachiyoDatabase(`yachiyo-app-web-search-${crypto.randomUUID()}`);
    const webSearchSettings = new WebSearchSettingsService(db);
    const sources = [
      { title: "必应搜索结果一", url: "https://www.bing.com/" },
      { title: "必应搜索结果二", url: "https://cn.bing.com/" },
    ];
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      if (request.webSearch === true) options.onSources?.(sources);
      options.onDelta("基于搜索的回复");
      return { truncated: false };
    });
    const services = fakeServices({ stream, webSearchSettings });
    const view = render(<App services={services} />);

    try {
      const composer = await screen.findByPlaceholderText("什么都可以告诉我");

      // 默认关闭：请求不携带 webSearch，也不渲染来源
      await user.type(composer, "今天上海天气");
      await user.click(screen.getByRole("button", { name: "发送" }));
      await waitFor(() => expect(stream).toHaveBeenCalledOnce());
      expect(stream.mock.calls[0]?.[0].webSearch).toBeUndefined();
      expect(screen.queryByLabelText("参考来源")).not.toBeInTheDocument();

      // 菜单 → 技能 → 开启联网搜索
      await user.click(screen.getByRole("button", { name: "菜单" }));
      await user.click(screen.getByRole("button", { name: "技能" }));
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "新建对话" })).not.toBeInTheDocument(),
      );
      await user.click(screen.getByRole("button", { name: "切换技能启用状态: 联网搜索" }));
      await user.click(screen.getByRole("button", { name: "关闭菜单" }));
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "切换技能启用状态: 联网搜索" }),
        ).not.toBeInTheDocument(),
      );

      // 开启后：请求携带 webSearch: true，回复下方渲染参考来源链接
      await user.type(composer, "明天呢");
      await user.click(screen.getByRole("button", { name: "发送" }));
      await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
      expect(stream.mock.calls[1]?.[0].webSearch).toBe(true);

      const sourcesRegion = await screen.findByLabelText("参考来源");
      const firstLink = within(sourcesRegion).getByRole("link", { name: "必应搜索结果一" });
      expect(firstLink).toHaveAttribute("href", "https://www.bing.com/");
      expect(firstLink).toHaveAttribute("target", "_blank");
      expect(firstLink).toHaveAttribute("rel", "noopener noreferrer");
      expect(
        within(sourcesRegion).getByRole("link", { name: "必应搜索结果二" }),
      ).toHaveAttribute("href", "https://cn.bing.com/");

      // 消息数据中的 sources 随消息持久化保留
      expect(
        services.repository.messages.find((message) => message.sources !== undefined)?.sources,
      ).toEqual(sources);

      // 关闭"显示引用来源"后不再渲染来源列表
      await user.click(screen.getByRole("button", { name: "菜单" }));
      await user.click(screen.getByRole("button", { name: "技能" }));
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "新建对话" })).not.toBeInTheDocument(),
      );
      await user.click(screen.getByRole("button", { name: "切换技能启用状态: 显示引用来源" }));
      await user.click(screen.getByRole("button", { name: "关闭菜单" }));
      await waitFor(() => expect(screen.queryByLabelText("参考来源")).not.toBeInTheDocument());

      // 持久化的开关状态已更新
      expect(await webSearchSettings.getWebSearchSettings()).toEqual({
        enabled: true,
        showSources: false,
        smart: false,
      });
    } finally {
      view.unmount();
      db.close();
      await db.delete();
    }
  });

  it("restores the active LLM config before the first message after reload", async () => {
    const user = userEvent.setup();
    const db = new YachiyoDatabase(`yachiyo-app-llm-${crypto.randomUUID()}`);
    const llmSettings = new LlmSettingsService(db);
    const apiKey = "sk-step-plan-abcdefghijklmnopqrstuvwxyz012345";
    await llmSettings.saveProvider("stepfun", apiKey, "step-3.7-flash");
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      options.onDelta("这是模型返回的动态回答");
      return { truncated: false };
    });
    const view = render(<App services={fakeServices({ llmSettings, stream })} />);

    try {
      const composer = await screen.findByPlaceholderText("什么都可以告诉我");
      await user.type(composer, "这次不要固定回复");
      await user.click(screen.getByRole("button", { name: "发送" }));

      await waitFor(() => expect(stream).toHaveBeenCalledOnce());
      expect(stream.mock.calls[0]?.[0]).toMatchObject({
        apiKey,
        model: "step-3.7-flash",
        provider: "stepfun",
      });
    } finally {
      view.unmount();
      db.close();
      await db.delete();
    }
  });

  it("restores the active LLM config after signing in to an expired session", async () => {
    const user = userEvent.setup();
    const db = new YachiyoDatabase(`yachiyo-app-llm-login-${crypto.randomUUID()}`);
    const llmSettings = new LlmSettingsService(db);
    const apiKey = "sk-step-plan-abcdefghijklmnopqrstuvwxyz012345";
    await llmSettings.saveProvider("stepfun", apiKey, "step-3.7-flash");
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      options.onDelta("这是模型返回的动态回答");
      return { truncated: false };
    });
    const services = fakeServices({ authenticated: false, llmSettings, stream });
    const view = render(<App services={services} />);

    try {
      const accessCode = await screen.findByLabelText("访问码");
      await user.type(accessCode, "correct horse moonlight");
      await user.click(screen.getByRole("button", { name: "进入" }));

      const composer = await screen.findByPlaceholderText("什么都可以告诉我");
      await user.type(composer, "登录后也不要固定回复");
      await user.click(screen.getByRole("button", { name: "发送" }));

      await waitFor(() => expect(stream).toHaveBeenCalledOnce());
      expect(stream.mock.calls[0]?.[0]).toMatchObject({
        apiKey,
        model: "step-3.7-flash",
        provider: "stepfun",
      });
    } finally {
      view.unmount();
      db.close();
      await db.delete();
    }
  });

  it("stops an active stream while retaining its partial response", async () => {
    const user = userEvent.setup();
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      options.onDelta("先别勉强自己");
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    render(<App services={fakeServices({ stream })} />);
    const composer = await screen.findByPlaceholderText("什么都可以告诉我");
    await user.type(composer, "等等");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("先别勉强自己")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "停止" }));

    await waitFor(() =>
      expect(screen.getAllByRole("article", { name: "八千代的回复" }).at(-1)).toHaveAttribute(
        "data-status",
        "stopped",
      ),
    );
  });

  it("stops an active stream before signing out", async () => {
    const user = userEvent.setup();
    const events: string[] = [];
    let streamSignal: AbortSignal | undefined;
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      streamSignal = options.signal;
      options.onDelta("还在慢慢写");
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => {
            events.push("stream-aborted");
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    });
    const services = fakeServices({ stream });
    services.session.signOut = vi.fn(async () => {
      events.push("session-signed-out");
    });
    render(<App services={services} />);
    const composer = await screen.findByPlaceholderText("什么都可以告诉我");
    await user.type(composer, "写到一半");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("还在慢慢写")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "菜单" }));
    await user.click(screen.getByRole("button", { name: "退出访问" }));

    await waitFor(() => expect(services.session.signOut).toHaveBeenCalledOnce());
    expect(streamSignal?.aborted).toBe(true);
    expect(events).toEqual(["stream-aborted", "session-signed-out"]);
    expect(await screen.findByLabelText("访问码")).toBeVisible();
  });

  it("previews, removes, and sends a processed camera image", async () => {
    const user = userEvent.setup();
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      options.onDelta("照片里的光很温柔呢~（凑近看了看）");
      return { truncated: false };
    });
    const services = fakeServices({ stream });
    const { container } = render(<App services={services} />);
    await screen.findByRole("button", { name: "拍摄" });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["jpeg"], "photo.jpg", { type: "image/jpeg" });

    await user.upload(input, file);
    expect(await screen.findByRole("button", { name: "移除图片" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "移除图片" }));
    expect(screen.queryByRole("button", { name: "移除图片" })).not.toBeInTheDocument();

    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(stream).toHaveBeenCalled());
    expect(stream.mock.calls[0]?.[0].messages.at(-1)).toMatchObject({
      imageDataUrl: processedImage.dataUrl,
      role: "user",
      text: "",
    });
  });

  it("pastes and sends a processed image directly from composer without clicking capture", async () => {
    const user = userEvent.setup();
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      options.onDelta("直接粘贴的图片也收到啦！");
      return { truncated: false };
    });
    const services = fakeServices({ stream });
    render(<App services={services} />);
    const textarea = await screen.findByPlaceholderText("什么都可以告诉我");

    const file = new File(["png"], "clipboard.png", { type: "image/png" });
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ getAsFile: () => file, type: "image/png" }],
      },
    });

    expect(await screen.findByRole("button", { name: "移除图片" })).toBeVisible();
    await user.type(textarea, "这是我粘贴的图片");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(stream).toHaveBeenCalled());
    expect(stream.mock.calls[0]?.[0].messages.at(-1)).toMatchObject({
      imageDataUrl: processedImage.dataUrl,
      role: "user",
      text: "这是我粘贴的图片",
    });
  });

  it("creates, renames, deletes, and clears local conversations behind confirmations", async () => {
    const user = userEvent.setup();
    const services = fakeServices();
    render(<App services={services} />);
    await screen.findByPlaceholderText("什么都可以告诉我");

    await user.click(screen.getByRole("button", { name: "菜单" }));
    await user.click(screen.getByRole("button", { name: "新建对话" }));
    await waitFor(() => expect(services.repository.conversations).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "菜单" }));
    await user.click(screen.getByRole("button", { name: "历史记录" }));
    const history = screen.getByRole("dialog", { name: "历史记录" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(2);

    const firstItem = within(history).getAllByRole("listitem")[0];
    await user.click(within(firstItem).getByRole("button", { name: "重命名" }));
    const renameInput = within(firstItem).getByRole("textbox");
    await user.clear(renameInput);
    await user.type(renameInput, "夏夜");
    await user.click(within(firstItem).getByRole("button", { name: "确定" }));
    expect(await within(history).findByText("夏夜")).toBeVisible();

    await user.click(within(firstItem).getByRole("button", { name: "删除" }));
    await user.click(within(firstItem).getByRole("button", { name: "确定" }));
    await waitFor(() => expect(services.repository.conversations).toHaveLength(1));

    await user.click(within(history).getByRole("button", { name: "关闭菜单" }));
    await user.click(screen.getByRole("button", { name: "菜单" }));
    await user.click(screen.getByRole("button", { name: "清除本地数据" }));
    await user.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(services.repository.conversations).toHaveLength(1));
    expect(services.repository.messages).toHaveLength(0);
  });

  it("shows quota feedback and returns to the gate on session expiry without deleting history", async () => {
    const user = userEvent.setup();
    const repository = new MemoryRepository();
    const stream = vi
      .fn<StreamChatFunction>()
      .mockRejectedValueOnce(new ChatClientError("DAILY_QUOTA_EXCEEDED"))
      .mockRejectedValueOnce(new ChatClientError("SESSION_REQUIRED"));
    render(<App services={fakeServices({ repository, stream })} />);
    const composer = await screen.findByPlaceholderText("什么都可以告诉我");
    await user.type(composer, "第一条");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("今天的对话次数已用完，请明天再来。")).toBeVisible();

    await user.clear(composer);
    await user.type(composer, "第二条");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByLabelText("访问码")).toBeVisible();
    expect(repository.messages.some(({ text }) => text === "第一条")).toBe(true);
    expect(repository.messages.some(({ text }) => text === "第二条")).toBe(true);
  });

  it("does not offer an AI retry when saving a message fails", async () => {
    const user = userEvent.setup();
    const services = fakeServices();
    render(<App services={services} />);
    const composer = await screen.findByPlaceholderText("什么都可以告诉我");
    vi.spyOn(services.repository, "putMessage").mockRejectedValue(new Error("storage unavailable"));

    await user.type(composer, "请记住这句话");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect((await screen.findAllByText("本地空间不足，请先清理历史记录。")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("offers an AI retry after a recoverable provider failure", async () => {
    const user = userEvent.setup();
    const stream = vi.fn<StreamChatFunction>().mockRejectedValue(new ChatClientError("PROVIDER_ERROR"));
    render(<App services={fakeServices({ stream })} />);
    const composer = await screen.findByPlaceholderText("什么都可以告诉我");

    await user.type(composer, "再试着回答一次");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByRole("button", { name: "重试" })).toBeVisible();
  });

  it("does not offer an AI retry for an invalid generation request", async () => {
    const user = userEvent.setup();
    const stream = vi.fn<StreamChatFunction>().mockRejectedValue(new ChatClientError("INVALID_REQUEST"));
    render(<App services={fakeServices({ stream })} />);
    const composer = await screen.findByPlaceholderText("什么都可以告诉我");

    await user.type(composer, "无法处理的请求");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect((await screen.findAllByText("暂时连接不上，再试一次吧。")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("does not offer an AI retry when the conversation limit is reached", async () => {
    const user = userEvent.setup();
    const services = fakeServices();
    render(<App services={services} />);
    await screen.findByPlaceholderText("什么都可以告诉我");
    vi.spyOn(services.repository, "createConversation").mockRejectedValue(
      new Error("conversation limit reached"),
    );

    await user.click(screen.getByRole("button", { name: "菜单" }));
    await user.click(screen.getByRole("button", { name: "新建对话" }));

    expect((await screen.findAllByText("本地最多保留 30 段对话，请先删除一段。")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("keeps local history readable but disables network actions while offline", async () => {
    let online = false;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => online,
    });
    const services = fakeServices();
    render(<App services={services} />);

    const composer = await screen.findByPlaceholderText("什么都可以告诉我");
    expect(composer).toBeDisabled();
    expect(screen.getByRole("button", { name: "拍摄" })).toBeDisabled();
    expect(screen.getByText("当前离线，可查看本地记录")).toBeVisible();

    act(() => {
      online = true;
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(composer).toBeEnabled());
  });

  it("recalls the latest user message and restores its text into the composer", async () => {
    const user = userEvent.setup();
    const stream = vi.fn<StreamChatFunction>(async (_req, options) => {
      options.onDelta("AI的回复");
      return { truncated: false };
    });
    render(<App services={fakeServices({ stream })} />);
    const composer = await screen.findByPlaceholderText("什么都可以告诉我");

    await user.type(composer, "这是一条要撤回的消息");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await screen.findByText("AI的回复");
    expect(screen.getByText("这是一条要撤回的消息")).toBeInTheDocument();

    const userBubble = screen.getByRole("article", { name: "我的消息" });
    fireEvent.contextMenu(userBubble);

    const recallBtn = screen.getByRole("menuitem", { name: "撤回" });
    await user.click(recallBtn);

    const log = screen.getByRole("log");
    await waitFor(() => {
      expect(within(log).queryByText("这是一条要撤回的消息")).not.toBeInTheDocument();
      expect(within(log).queryByText("AI的回复")).not.toBeInTheDocument();
    });

    expect(composer).toHaveValue("这是一条要撤回的消息");
    expect((await screen.findAllByText("已撤回最新一条消息")).length).toBeGreaterThan(0);

    // Send a second message right away without refreshing
    await user.clear(composer);
    await user.type(composer, "第二条消息");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await screen.findByText("AI的回复");
    expect(screen.getByText("第二条消息")).toBeInTheDocument();

    // Test regenerating from the ASSISTANT reply bubble
    const assistantBubble = screen.getByRole("article", { name: "八千代的回复" });
    fireEvent.contextMenu(assistantBubble);

    const regenerateBtn = screen.getByRole("menuitem", { name: "重新生成" });
    await user.click(regenerateBtn);

    await waitFor(() => {
      expect(stream).toHaveBeenCalledTimes(3);
    });

    // Now recall from the user bubble
    const latestUserBubble = screen.getByRole("article", { name: "我的消息" });
    fireEvent.contextMenu(latestUserBubble);

    const recallBtn2 = screen.getByRole("menuitem", { name: "撤回" });
    await user.click(recallBtn2);

    await waitFor(() => {
      expect(within(log).queryByText("第二条消息")).not.toBeInTheDocument();
    });
    expect(composer).toHaveValue("第二条消息");
  });
});
