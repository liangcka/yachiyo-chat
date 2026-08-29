import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../domain/chat";
import type { ProcessedImage } from "../features/capture/image-processor";
import { copyFor } from "../i18n/messages";
import { Composer } from "./Composer";
import { ControlDock } from "./ControlDock";
import { ConversationView } from "./ConversationView";
import { SkillsPanel } from "./SkillsPanel";
import { TopControls } from "./TopControls";

describe("reference chat components", () => {
  it("renders the reference controls with localized labels", () => {
    const onSettings = vi.fn();
    const onUnavailable = vi.fn();
    render(
      <ControlDock
        copy={copyFor("zh-CN")}
        onSettings={onSettings}
        onUnavailable={onUnavailable}
      />,
    );

    expect(screen.getByRole("button", { name: "设置" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "情绪功能即将开放" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "扬声器功能即将开放" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "麦克风功能即将开放" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "情绪功能即将开放" }));
    expect(onSettings).toHaveBeenCalledOnce();
    expect(onUnavailable).toHaveBeenCalledWith("情绪功能即将开放");
  });

  it("renders menu and localized camera controls", () => {
    const onMenu = vi.fn();
    render(
      <TopControls
        copy={copyFor("ja-JP")}
        onCaptureError={vi.fn()}
        onImage={vi.fn()}
        onMenu={onMenu}
      />,
    );

    const menuButton = screen.getByRole("button", { name: "メニュー" });
    const menuIcon = menuButton.querySelector("svg");
    expect(menuIcon).not.toBeNull();
    expect(menuIcon?.querySelectorAll("path, line")).toHaveLength(2);

    fireEvent.click(menuButton);
    expect(onMenu).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "撮影" })).toBeEnabled();
  });

  it("separates assistant and user messages in a readable live log", () => {
    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "assistant",
        role: "assistant",
        status: "complete",
        text: "彩叶~今天也辛苦啦！",
      },
      {
        conversationId: "one",
        createdAt: 2,
        id: "user",
        role: "user",
        status: "complete",
        text: "谢谢你",
      },
    ];
    render(<ConversationView locale="zh-CN" messages={messages} />);

    expect(screen.getByRole("log")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "八千代的回复" })).toHaveTextContent(
      "彩叶~今天也辛苦啦！",
    );
    expect(screen.getByRole("article", { name: "我的消息" })).toHaveClass(
      "message-bubble--user",
    );
  });

  it("follows streaming updates only while the reader stays near the bottom", () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    const firstMessage: ChatMessage = {
      conversationId: "one",
      createdAt: 1,
      id: "assistant-one",
      role: "assistant",
      status: "streaming",
      text: "",
    };
    const view = render(<ConversationView locale="zh-CN" messages={[firstMessage]} />);
    const conversation = view.container.querySelector<HTMLElement>(".conversation-view");
    expect(conversation).not.toBeNull();
    Object.defineProperties(conversation, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });

    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "end" });

    fireEvent.scroll(conversation!);
    scrollIntoView.mockClear();
    view.rerender(
      <ConversationView
        locale="zh-CN"
        messages={[{ ...firstMessage, text: "用户正在向上阅读" }]}
      />,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    conversation!.scrollTop = 540;
    fireEvent.scroll(conversation!);
    view.rerender(
      <ConversationView
        locale="zh-CN"
        messages={[{ ...firstMessage, text: "回到底部后继续跟随" }]}
      />,
    );
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "end" });

    const nextMessage: ChatMessage = {
      conversationId: "one",
      createdAt: 2,
      id: "assistant-two",
      role: "assistant",
      status: "streaming",
      text: "",
    };
    conversation!.scrollTop = 0;
    fireEvent.scroll(conversation!);
    scrollIntoView.mockClear();
    view.rerender(
      <ConversationView locale="zh-CN" messages={[firstMessage, nextMessage]} />,
    );
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "end" });
  });

  it("uses instant scrolling for appended messages when reduced motion is requested", () => {
    const reducedMotionQuery = {
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    };
    vi.mocked(window.matchMedia)
      .mockReturnValueOnce(reducedMotionQuery)
      .mockReturnValueOnce(reducedMotionQuery);
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    const firstMessage: ChatMessage = {
      conversationId: "one",
      createdAt: 1,
      id: "assistant-one",
      role: "assistant",
      status: "complete",
      text: "少一点动态也很好",
    };
    const view = render(<ConversationView locale="zh-CN" messages={[firstMessage]} />);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "end" });

    view.rerender(
      <ConversationView
        locale="zh-CN"
        messages={[
          firstMessage,
          { ...firstMessage, createdAt: 2, id: "assistant-two", text: "第二条回复" },
        ]}
      />,
    );

    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "end" });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("sends on Enter, keeps Shift+Enter, and ignores IME composition", async () => {
    const onSend = vi.fn();

    function Harness() {
      const [value, setValue] = useState("今晚的星星很好看");
      return (
        <Composer
          copy={copyFor("zh-CN")}
          onChange={setValue}
          onSend={onSend}
          onStop={vi.fn()}
          phase="idle"
          value={value}
        />
      );
    }

    render(<Harness />);
    const textarea = screen.getByPlaceholderText("什么都可以告诉我");
    fireEvent.keyDown(textarea, { isComposing: true, key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    await userEvent.type(textarea, "{enter}");
    expect(onSend).toHaveBeenCalledWith("今晚的星星很好看");
  });

  it("changes the composer action from Send to Stop while streaming", () => {
    const onStop = vi.fn();
    render(
      <Composer
        copy={copyFor("ja-JP")}
        onChange={vi.fn()}
        onSend={vi.fn()}
        onStop={onStop}
        phase="streaming"
        value=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.getByPlaceholderText("何でも話してね")).toBeDisabled();
  });

  it("opens context menu with recall option on right-click or long-press for the latest user message", () => {
    const onRecall = vi.fn();
    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "user-1",
        role: "user",
        status: "complete",
        text: "第一条用户消息",
      },
      {
        conversationId: "one",
        createdAt: 2,
        id: "assistant-1",
        role: "assistant",
        status: "complete",
        text: "第一条回复",
      },
      {
        conversationId: "one",
        createdAt: 3,
        id: "user-2",
        role: "user",
        status: "complete",
        text: "第二条用户消息",
      },
      {
        conversationId: "one",
        createdAt: 4,
        id: "assistant-2",
        role: "assistant",
        status: "complete",
        text: "第二条回复",
      },
    ];

    render(<ConversationView locale="zh-CN" messages={messages} onRecall={onRecall} />);

    // Before right click, no menu is visible
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "撤回" })).not.toBeInTheDocument();

    const userArticles = screen.getAllByRole("article", { name: "我的消息" });
    const latestUserBubble = userArticles.at(-1)!;

    // Right-click on latest user message
    fireEvent.contextMenu(latestUserBubble);

    expect(screen.getByRole("menu")).toBeInTheDocument();
    const recallMenuItem = screen.getByRole("menuitem", { name: "撤回" });
    expect(recallMenuItem).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制" })).toBeInTheDocument();

    fireEvent.click(recallMenuItem);
    expect(onRecall).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("copies message text to clipboard and calls onToast when copy menuitem is clicked", async () => {
    const onToast = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "assistant-1",
        role: "assistant",
        status: "complete",
        text: "这是八千代的回答",
      },
    ];

    render(<ConversationView locale="zh-CN" messages={messages} onToast={onToast} />);

    const assistantBubble = screen.getByRole("article", { name: "八千代的回复" });
    fireEvent.contextMenu(assistantBubble);

    const copyBtn = screen.getByRole("menuitem", { name: "复制" });
    expect(copyBtn).toBeInTheDocument();

    await userEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith("这是八千代的回答");
    expect(onToast).toHaveBeenCalledWith("已复制");
  });

  it("renders regenerate context menu item for the latest assistant message", async () => {
    const onRegenerate = vi.fn();
    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "user-1",
        role: "user",
        status: "complete",
        text: "你好",
      },
      {
        conversationId: "one",
        createdAt: 2,
        id: "assistant-1",
        role: "assistant",
        status: "complete",
        text: "你好呀！",
      },
    ];

    render(
      <ConversationView
        locale="zh-CN"
        messages={messages}
        onRegenerate={onRegenerate}
      />,
    );

    // Right-click context menu on assistant bubble
    const assistantBubble = screen.getByRole("article", { name: "八千代的回复" });
    fireEvent.contextMenu(assistantBubble);

    const regenerateMenuItem = screen.getByRole("menuitem", { name: "重新生成" });
    expect(regenerateMenuItem).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制" })).toBeInTheDocument();

    fireEvent.click(regenerateMenuItem);
    expect(onRegenerate).toHaveBeenCalledWith("assistant-1");
  });

  it("renders source links under assistant replies and respects the showSources switch", () => {
    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "assistant-1",
        role: "assistant",
        status: "complete",
        text: "基于搜索的回复",
        sources: [
          { title: "必应搜索结果一", url: "https://www.bing.com/" },
          { title: "必应搜索结果二", url: "https://cn.bing.com/" },
        ],
      },
      {
        conversationId: "one",
        createdAt: 2,
        id: "user-1",
        role: "user",
        status: "complete",
        text: "用户消息不渲染来源",
        sources: [{ title: "不应出现", url: "https://example.com/" }],
      },
    ];

    const { rerender } = render(<ConversationView locale="zh-CN" messages={messages} />);

    const sourcesRegion = screen.getByLabelText("参考来源");
    const links = within(sourcesRegion).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "https://www.bing.com/");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(links[1]).toHaveAttribute("href", "https://cn.bing.com/");

    // 关闭"显示引用来源"后不再渲染列表
    rerender(<ConversationView locale="zh-CN" messages={messages} showSources={false} />);
    expect(screen.queryByLabelText("参考来源")).not.toBeInTheDocument();
  });

  it("keeps the typing indicator clean while sources arrive before any reply text", () => {
    const messages: ChatMessage[] = [
      {
        conversationId: "one",
        createdAt: 1,
        id: "assistant-1",
        role: "assistant",
        status: "streaming",
        text: "",
        sources: [{ title: "必应搜索结果一", url: "https://www.bing.com/" }],
      },
    ];

    render(<ConversationView locale="zh-CN" messages={messages} />);

    // 等待期只有三点动画，不渲染参考来源区块（避免出现超高气泡）
    expect(document.querySelector(".message-bubble__typing")).not.toBeNull();
    expect(screen.queryByLabelText("参考来源")).not.toBeInTheDocument();

    // 正文开始流式输出后，来源区块随正文出现
    const streaming: ChatMessage[] = [
      { ...messages[0]!, text: "彩叶~查到啦", status: "streaming" },
    ];
    cleanup();
    render(<ConversationView locale="zh-CN" messages={streaming} />);
    expect(screen.getByText("彩叶~查到啦")).toBeInTheDocument();
    expect(screen.getByLabelText("参考来源")).toBeInTheDocument();
  });

  it("hides citation markers in the reply text when the showSources switch is off", () => {
    const base: ChatMessage = {
      conversationId: "one",
      createdAt: 1,
      id: "assistant-1",
      role: "assistant",
      status: "complete",
      text: "彩叶~上海今天晴哦！[1][2]",
      sources: [
        { title: "必应搜索结果一", url: "https://www.bing.com/" },
        { title: "必应搜索结果二", url: "https://cn.bing.com/" },
      ],
    };

    // 开关开启：正文保留 [n] 标记，与来源列表序号对应
    const { rerender } = render(
      <ConversationView locale="zh-CN" messages={[base]} showSources />,
    );
    expect(screen.getByText("彩叶~上海今天晴哦！[1][2]")).toBeInTheDocument();
    expect(screen.getByLabelText("参考来源")).toBeInTheDocument();

    // 开关关闭：正文中的 [n] 标记与来源列表一并隐藏（仅展示层，存储不变）
    rerender(<ConversationView locale="zh-CN" messages={[base]} showSources={false} />);
    expect(screen.getByText("彩叶~上海今天晴哦！")).toBeInTheDocument();
    expect(screen.queryByText(/\[\d\]/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("参考来源")).not.toBeInTheDocument();
  });

  it("renders web search toggles and reports enabled state via callbacks", async () => {
    const user = userEvent.setup();
    const onWebSearchSettingsChange = vi.fn();
    const { rerender } = render(
      <SkillsPanel
        activeIds={[]}
        copy={copyFor("zh-CN")}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onWebSearchSettingsChange={onWebSearchSettingsChange}
        open
        skills={[]}
        webSearchSettings={{
          enabled: false,
          showSources: true,
          smart: false,
        }}
      />,
    );

    expect(screen.getByText("联网搜索")).toBeVisible();
    expect(screen.getByText("发送前先用必应搜索网络资料，回复将基于最新信息")).toBeVisible();
    expect(screen.getByText("显示引用来源")).toBeVisible();
    expect(screen.getByText("在联网回复下方显示参考来源链接")).toBeVisible();
    expect(screen.getByText("智能搜索")).toBeVisible();
    expect(screen.getByText("同时检索国际市场近30天结果，提升时效信息的准确性")).toBeVisible();

    const enabledToggle = screen.getByRole("button", {
      name: "切换技能启用状态: 联网搜索",
    });
    const showSourcesToggle = screen.getByRole("button", {
      name: "切换技能启用状态: 显示引用来源",
    });
    const smartToggle = screen.getByRole("button", {
      name: "切换技能启用状态: 智能搜索",
    });
    expect(enabledToggle).toHaveAttribute("aria-pressed", "false");
    expect(showSourcesToggle).toHaveAttribute("aria-pressed", "true");
    expect(smartToggle).toHaveAttribute("aria-pressed", "false");
    // 联网关闭时"显示引用来源"与"智能搜索"按钮均禁用置灰
    expect(showSourcesToggle).toBeDisabled();
    expect(smartToggle).toBeDisabled();

    await user.click(enabledToggle);
    expect(onWebSearchSettingsChange).toHaveBeenCalledWith({ enabled: true });

    // 联网开启后"显示引用来源"与"智能搜索"均可点击
    rerender(
      <SkillsPanel
        activeIds={[]}
        copy={copyFor("zh-CN")}
        onClose={vi.fn()}
        onToggle={vi.fn()}
        onWebSearchSettingsChange={onWebSearchSettingsChange}
        open
        skills={[]}
        webSearchSettings={{
          enabled: true,
          showSources: true,
          smart: false,
        }}
      />,
    );
    expect(showSourcesToggle).toBeEnabled();
    expect(smartToggle).toBeEnabled();

    await user.click(showSourcesToggle);
    expect(onWebSearchSettingsChange).toHaveBeenCalledWith({ showSources: false });
  });

  it("processes and attaches image when pasted into composer", async () => {
    const onImage = vi.fn();
    const mockImage: ProcessedImage = {
      blob: new Blob(["sample"], { type: "image/png" }),
      dataUrl: "data:image/png;base64,sample",
      height: 100,
      mimeType: "image/png",
      width: 100,
    };
    const process = vi.fn().mockResolvedValue(mockImage);

    render(
      <Composer
        copy={copyFor("zh-CN")}
        onChange={vi.fn()}
        onImage={onImage}
        onSend={vi.fn()}
        onStop={vi.fn()}
        phase="idle"
        processImage={process}
        value=""
      />,
    );

    const textarea = screen.getByPlaceholderText("什么都可以告诉我");
    const file = new File(["dummy"], "pasted.png", { type: "image/png" });
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ getAsFile: () => file, type: "image/png" }],
      },
    });

    await vi.waitFor(() => {
      expect(process).toHaveBeenCalledWith(file);
      expect(onImage).toHaveBeenCalledWith(mockImage);
    });
  });

  it("processes and attaches image when dropped into composer", async () => {
    const onImage = vi.fn();
    const mockImage: ProcessedImage = {
      blob: new Blob(["sample"], { type: "image/jpeg" }),
      dataUrl: "data:image/jpeg;base64,sample",
      height: 200,
      mimeType: "image/jpeg",
      width: 200,
    };
    const process = vi.fn().mockResolvedValue(mockImage);

    const { container } = render(
      <Composer
        copy={copyFor("zh-CN")}
        onChange={vi.fn()}
        onImage={onImage}
        onSend={vi.fn()}
        onStop={vi.fn()}
        phase="idle"
        processImage={process}
        value=""
      />,
    );

    const form = container.querySelector("form")!;
    const file = new File(["dummy"], "dropped.jpg", { type: "image/jpeg" });
    fireEvent.dragOver(form, {
      dataTransfer: { types: ["Files"] },
    });
    fireEvent.drop(form, {
      dataTransfer: { files: [file] },
    });

    await vi.waitFor(() => {
      expect(process).toHaveBeenCalledWith(file);
      expect(onImage).toHaveBeenCalledWith(mockImage);
    });
  });

  it("notifies when image is pasted but image support is disabled", async () => {
    const onImageDisabled = vi.fn();
    const process = vi.fn();

    render(
      <Composer
        copy={copyFor("zh-CN")}
        imageDisabled
        onChange={vi.fn()}
        onImageDisabled={onImageDisabled}
        onSend={vi.fn()}
        onStop={vi.fn()}
        phase="idle"
        processImage={process}
        value=""
      />,
    );

    const textarea = screen.getByPlaceholderText("什么都可以告诉我");
    const file = new File(["dummy"], "pasted.png", { type: "image/png" });
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ getAsFile: () => file, type: "image/png" }],
      },
    });

    expect(onImageDisabled).toHaveBeenCalledOnce();
    expect(process).not.toHaveBeenCalled();
  });
});

