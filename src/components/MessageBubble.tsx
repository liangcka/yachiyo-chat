import type { ChatMessage, Locale } from "../domain/chat";

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
  return (
    <article
      aria-label={messageLabel(message.role, locale)}
      className={`message-bubble message-bubble--${message.role}`}
      data-status={message.status}
    >
      {imageUrl === undefined ? null : (
        <img alt="" className="message-bubble__image" src={imageUrl} />
      )}
      {message.text.length === 0 && message.status === "streaming" ? (
        <span aria-hidden="true" className="message-bubble__typing">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <p>{message.text}</p>
      )}
    </article>
  );
}
