import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../domain/chat";
import { MessageBubble } from "./MessageBubble";

function assistantMessage(text: string, status: ChatMessage["status"] = "complete"): ChatMessage {
  return {
    conversationId: "c1",
    createdAt: 0,
    id: "m1",
    role: "assistant",
    status,
    text,
  };
}

describe("MessageBubble sticker rendering", () => {
  it("renders a standalone sticker token as a sticker image", () => {
    render(<MessageBubble locale="zh-CN" message={assistantMessage("[sticker:smile]")} />);

    const img = screen.getByRole("img", { name: "点点を抱えて優しく微笑む" });
    expect(img.className).toContain("message-bubble__sticker");
    expect(img.getAttribute("src")).toContain("stickers/smile.jpg");
  });

  it("keeps text bubbles and sticker images as separate ordered pieces", () => {
    const { container } = render(
      <MessageBubble locale="zh-CN" message={assistantMessage("彩叶～欢迎回来\n---\n[sticker:smile]")} />,
    );

    const group = container.querySelector(".message-bubble-group");
    expect(group).not.toBeNull();
    expect(screen.getByText("彩叶～欢迎回来")).toBeInTheDocument();
    const stickers = container.querySelectorAll("img.message-bubble__sticker");
    expect(stickers).toHaveLength(1);
    // 贴图跟在文字气泡之后
    expect(group?.lastElementChild?.tagName).toBe("IMG");
  });

  it("hides partial sticker tokens while streaming", () => {
    render(
      <MessageBubble locale="zh-CN" message={assistantMessage("收到～[sticker:po", "streaming")} />,
    );

    expect(document.body.textContent).not.toContain("[sticker:");
    expect(screen.getByText("收到～")).toBeInTheDocument();
  });

  it("drops unknown sticker ids without leaking raw tokens", () => {
    render(<MessageBubble locale="zh-CN" message={assistantMessage("[sticker:nope]")} />);

    expect(document.body.textContent).not.toContain("[sticker:");
    expect(document.querySelector("img.message-bubble__sticker")).toBeNull();
  });

  it("keeps user messages literal", () => {
    const message: ChatMessage = {
      conversationId: "c1",
      createdAt: 0,
      id: "u1",
      role: "user",
      status: "complete",
      text: "[sticker:smile]",
    };
    render(<MessageBubble locale="zh-CN" message={message} />);

    expect(screen.getByText("[sticker:smile]")).toBeInTheDocument();
  });
});
