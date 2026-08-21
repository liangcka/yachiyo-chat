import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { ChatMessage, Locale } from "../domain/chat";
import { copyFor } from "../i18n/messages";
import { MessageBubble } from "./MessageBubble";

const FOLLOW_THRESHOLD_PX = 80;

function isNearBottom(
  element: Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">,
) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_THRESHOLD_PX;
}

function syncTopScrimOpacity(
  element: HTMLElement,
  onScrolledFromTopChange?: (scrolled: boolean) => void,
) {
  const scrollTop = element.scrollTop;
  const progress = Math.min(1, Math.max(0, scrollTop / 40));
  document.documentElement.style.setProperty("--top-scrim-opacity", progress.toFixed(3));
  onScrolledFromTopChange?.(progress > 0);
}

export interface ConversationViewProps {
  locale: Locale;
  messages: ChatMessage[];
  imageUrls?: ReadonlyMap<string, string>;
  summary?: string;
  /** "显示引用来源"开关，向下传递给消息气泡 */
  showSources?: boolean;
  onRecall?: () => void;
  onRegenerate?: (messageId?: string) => void;
  onToast?: (message: string) => void;
  onScrolledFromTopChange?: (scrolledFromTop: boolean) => void;
}

export function ConversationView({
  imageUrls,
  locale,
  messages,
  onRecall,
  onRegenerate,
  onScrolledFromTopChange,
  onToast,
  showSources,
  summary,
}: ConversationViewProps) {
  const containerRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLLIElement>(null);
  const followingRef = useRef(true);
  const previousMessagesRef = useRef<ChatMessage[]>([]);

  const scrollToBottom = useCallback(
    (smooth = true) => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      endRef.current?.scrollIntoView({
        behavior: !smooth || reducedMotion ? "auto" : "smooth",
        block: "end",
      });
      followingRef.current = true;
      if (containerRef.current) {
        syncTopScrimOpacity(containerRef.current, onScrolledFromTopChange);
      }
    },
    [onScrolledFromTopChange],
  );

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
      scrollToBottom();
    } else if (containerRef.current) {
      syncTopScrimOpacity(containerRef.current, onScrolledFromTopChange);
    }

    previousMessagesRef.current = messages;
  }, [messages, onScrolledFromTopChange, scrollToBottom]);

  let lastUserMessageIndex = -1;
  let lastAssistantMessageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (lastAssistantMessageIndex === -1 && messages[index]?.role === "assistant") {
      lastAssistantMessageIndex = index;
    }
    if (lastUserMessageIndex === -1 && messages[index]?.role === "user") {
      lastUserMessageIndex = index;
    }
    if (lastUserMessageIndex !== -1 && lastAssistantMessageIndex !== -1) {
      break;
    }
  }

  return (
    <section
      ref={containerRef}
      className="conversation-view"
      onScroll={(event) => {
        const target = event.currentTarget;
        followingRef.current = isNearBottom(target);
        syncTopScrimOpacity(target, onScrolledFromTopChange);
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
        {messages.map((message, index) => (
          <li className={`message-list__item message-list__item--${message.role}`} key={message.id}>
            <MessageBubble
              imageUrl={message.imageId === undefined ? undefined : imageUrls?.get(message.imageId)}
              locale={locale}
              message={message}
              onImageLoad={() => {
                if (followingRef.current) {
                  scrollToBottom();
                }
              }}
              showSources={showSources}
              onRecall={message.role === "user" && index === lastUserMessageIndex ? onRecall : undefined}
              onRegenerate={
                message.role === "assistant" &&
                index === lastAssistantMessageIndex &&
                onRegenerate !== undefined
                  ? () => onRegenerate(message.id)
                  : undefined
              }
              onToast={onToast}
            />
          </li>
        ))}
        <li ref={endRef} aria-hidden="true" className="message-list__end" />
      </ol>
    </section>
  );
}
