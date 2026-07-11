import { useEffect, useRef } from "react";
import type { ChatMessage, Locale } from "../domain/chat";
import { MessageBubble } from "./MessageBubble";

export interface ConversationViewProps {
  locale: Locale;
  messages: ChatMessage[];
  imageUrls?: ReadonlyMap<string, string>;
}

export function ConversationView({ imageUrls, locale, messages }: ConversationViewProps) {
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <section className="conversation-view">
      <ol aria-live="polite" aria-relevant="additions text" className="message-list" role="log">
        {messages.map((message) => (
          <li className={`message-list__item message-list__item--${message.role}`} key={message.id}>
            <MessageBubble
              imageUrl={message.imageId === undefined ? undefined : imageUrls?.get(message.imageId)}
              locale={locale}
              message={message}
            />
          </li>
        ))}
        <li ref={endRef} aria-hidden="true" className="message-list__end" />
      </ol>
    </section>
  );
}
