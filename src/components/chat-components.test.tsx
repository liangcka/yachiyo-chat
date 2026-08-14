import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../domain/chat";
import { copyFor } from "../i18n/messages";
import { Composer } from "./Composer";
import { ControlDock } from "./ControlDock";
import { ConversationView } from "./ConversationView";
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
});
