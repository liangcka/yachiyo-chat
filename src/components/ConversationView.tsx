import { Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChatMessage, Locale } from "../domain/chat";
import { copyFor } from "../i18n/messages";
import { MessageBubble } from "./MessageBubble";

const FOLLOW_THRESHOLD_PX = 80;

function isNearBottom(
  element: Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">,
) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_THRESHOLD_PX;
}

export interface ConversationViewProps {
  locale: Locale;
  messages: ChatMessage[];
  imageUrls?: ReadonlyMap<string, string>;
  summary?: string;
}

export function ConversationView({ imageUrls, locale, messages, summary }: ConversationViewProps) {
  const endRef = useRef<HTMLLIElement>(null);
  const followingRef = useRef(true);
  const previousMessagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    const previousMessages = previousMessagesRef.current;
    const previousLastMessage = previousMessages.at(-1);
    const currentLastMessage = messages.at(-1);
    const isInitialMessage = previousMessages.length === 0 && currentLastMessage !== undefined;
    const isNewMessage =
      currentLastMessage !== undefined &&
      (messages.length > previousMessages.length || currentLastMessage.id !== previousLastMessage?.id);
    const isStreamingDelta =
      currentLastMessage !== undefined &&
      previousLastMessage !== undefined &&
      currentLastMessage.id === previousLastMessage.id &&
      currentLastMessage.text !== previousLastMessage.text;

    if (isInitialMessage || isNewMessage || (isStreamingDelta && followingRef.current)) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      endRef.current?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "end",
      });
    }

    previousMessagesRef.current = messages;
  }, [messages]);

  return (
    <section
      className="conversation-view"
      onScroll={(event) => {
        followingRef.current = isNearBottom(event.currentTarget);
      }}
    >
      <ol aria-live="polite" aria-relevant="additions text" className="message-list" role="log">
        {summary ? (
          <li className="message-list__item message-list__item--memory" key="context-memory">
            <details className="memory-card">
              <summary className="memory-card__summary">
                <Sparkles aria-hidden="true" size={15} />
                <span>{copyFor(locale).memoryLabel}</span>
              </summary>
              <div className="memory-card__body">
                <p>{summary}</p>
              </div>
            </details>
          </li>
        ) : null}
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
