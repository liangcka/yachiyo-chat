import type { ChatMessage, Locale } from "../domain/chat";
import { copyFor } from "../i18n/messages";

export interface MessageBubbleProps {
  locale: Locale;
  message: ChatMessage;
  imageUrl?: string;
}

function messageLabel(role: ChatMessage["role"], locale: Locale): string {
  if (locale === "ja-JP") return role === "assistant" ? "八千代の返事" : "あなたのメッセージ";
  return role === "assistant" ? "八千代的回复" : "我的消息";
}

export function MessageBubble({ imageUrl, locale, message }: MessageBubbleProps) {
  const hasText = message.text.trim().length > 0;
  const hasImage = message.imageId !== undefined;
  const isTyping = message.text.length === 0 && message.status === "streaming";

  if (!hasText && !hasImage && !isTyping) {
    return null;
  }

  return (
    <article
      aria-label={messageLabel(message.role, locale)}
      className={`message-bubble message-bubble--${message.role}${isTyping ? " message-bubble--typing" : ""}`}
      data-status={message.status}
    >
      {hasImage ? (
        imageUrl !== undefined ? (
          <img alt="" className="message-bubble__image" src={imageUrl} />
        ) : (
          <div aria-hidden="true" className="message-bubble__image message-bubble__image--loading" />
        )
      ) : null}
      {message.text.length === 0 && message.status === "streaming" && !hasImage ? (
        <span aria-hidden="true" className="message-bubble__typing">
          <i />
          <i />
          <i />
        </span>
      ) : hasText ? (
        <>
          <p>{message.text}</p>
          {message.truncated === true ? (
            <span className="message-bubble__truncated">{copyFor(locale).truncated}</span>
          ) : null}
        </>
      ) : message.status === "streaming" ? (
        <span aria-hidden="true" className="message-bubble__typing">
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </article>
  );
}
