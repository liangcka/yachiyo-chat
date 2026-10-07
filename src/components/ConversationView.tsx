import { useVirtualizer } from "@tanstack/react-virtual";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { ChatMessage, Locale } from "../domain/chat";
import { copyFor } from "../i18n/messages";
import { MessageBubble } from "./MessageBubble";

const FOLLOW_THRESHOLD_PX = 80;
const SCROLL_DELTA_THRESHOLD = 8;
/** 消息数超过该阈值才启用虚拟滚动；小会话走原生渲染路径（行为与旧版完全一致） */
const VIRTUALIZATION_THRESHOLD = 40;
/** 虚拟模式下的过扫描行数，保证快速滚动时上下边缘不露白 */
const OVERSCAN = 6;
/** 消息气泡高度估算值；实际高度由 measureElement 实测校正 */
const ESTIMATED_MESSAGE_HEIGHT = 96;

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
  /** 是否允许分条消息气泡，默认开启 */
  multiBubble?: boolean;
  onRecall?: () => void;
  onRegenerate?: (messageId?: string) => void;
  /** 点击后向上翻页加载更早历史（UI 窗口化） */
  onLoadEarlier?: () => void;
  /** 是否还有更早历史可加载；false 时隐藏入口 */
  hasMoreHistory?: boolean;
  onToast?: (message: string) => void;
  onScrolledFromTopChange?: (scrolledFromTop: boolean) => void;
  /** 四格小组件收缩/展开回调：向上滑时为 true，向下滑或触底时为 false */
  onBottomDockCollapseChange?: (collapsed: boolean) => void;
}

export function ConversationView({
  imageUrls,
  locale,
  messages,
  multiBubble,
  onRecall,
  onRegenerate,
  onLoadEarlier,
  hasMoreHistory,
  onToast,
  onScrolledFromTopChange,
  onBottomDockCollapseChange,
  showSources,
  summary,
}: ConversationViewProps) {
  const containerRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLLIElement>(null);
  const followingRef = useRef(true);
  const previousMessagesRef = useRef<ChatMessage[]>([]);
  const virtualizationEnabled = messages.length > VIRTUALIZATION_THRESHOLD;
  const lastScrollTopRef = useRef(0);
  const collapsedRef = useRef(false);
  const touchStartYRef = useRef<number | null>(null);

  const updateCollapseState = useCallback(
    (collapsed: boolean) => {
      if (collapsedRef.current !== collapsed) {
        collapsedRef.current = collapsed;
        onBottomDockCollapseChange?.(collapsed);
      }
    },
    [onBottomDockCollapseChange],
  );

  // 无条件调用（hooks 不能条件化）；未启用时 count 为 0，零成本空转
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: virtualizationEnabled ? messages.length : 0,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    getItemKey: (index) => messages[index]?.id ?? `index-${index}`,
    getScrollElement: () => containerRef.current,
    overscan: OVERSCAN,
  });

  const scrollToBottom = useCallback(
    (smooth = true) => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // 虚拟模式下占位层提供真实总高度，endRef 始终可达，两个分支共用同一逻辑
      endRef.current?.scrollIntoView({
        behavior: !smooth || reducedMotion ? "auto" : "smooth",
        block: "end",
      });
      if (containerRef.current) {
        const target = containerRef.current;
        const targetScroll = target.scrollHeight - target.clientHeight;
        if (targetScroll > 0) {
          if (typeof target.scrollTo === "function") {
            target.scrollTo({
              top: targetScroll,
              behavior: !smooth || reducedMotion ? "auto" : "smooth",
            });
          } else {
            target.scrollTop = targetScroll;
          }
        }
      }
      followingRef.current = true;
      updateCollapseState(false);
      if (containerRef.current) {
        syncTopScrimOpacity(containerRef.current, onScrolledFromTopChange);
      }
    },
    [onScrolledFromTopChange, updateCollapseState],
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

    if (messages.length === 0) {
      updateCollapseState(false);
    } else if (isInitialMessage || isNewMessage || (isStreamingDelta && followingRef.current)) {
      scrollToBottom();
    } else if (containerRef.current) {
      syncTopScrimOpacity(containerRef.current, onScrolledFromTopChange);
    }

    previousMessagesRef.current = messages;
  }, [messages, onScrolledFromTopChange, scrollToBottom, updateCollapseState]);

  // 视口尺寸动态监听：当软键盘弹起/收起导致聊天容器高度剧烈变化时，保持消息贴底防遮挡
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    let previousHeight = container.clientHeight;

    const observer = new ResizeObserver(() => {
      const currentHeight = container.clientHeight;
      const isInputActive =
        typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement &&
        (document.activeElement.tagName === "TEXTAREA" || document.activeElement.tagName === "INPUT");

      if (currentHeight !== previousHeight) {
        if (followingRef.current || isInputActive) {
          scrollToBottom(false);
        }
        previousHeight = currentHeight;
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollToBottom]);

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

  const handleImageLoad = useCallback(() => {
    if (followingRef.current) {
      scrollToBottom();
    }
  }, [scrollToBottom]);

  const renderMessageContent = useCallback(
    (message: ChatMessage, index: number) => (
      <MessageBubble
        imageUrl={message.imageId === undefined ? undefined : imageUrls?.get(message.imageId)}
        locale={locale}
        message={message}
        multiBubble={multiBubble}
        onImageLoad={handleImageLoad}
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
    ),
    [handleImageLoad, imageUrls, lastAssistantMessageIndex, lastUserMessageIndex, locale, multiBubble, onRecall, onRegenerate, onToast, showSources],
  );

  const memoryCard = summary ? (
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
  ) : null;

  const loadEarlierEntry =
    hasMoreHistory && onLoadEarlier !== undefined && messages.length > 0 && !virtualizationEnabled ? (
      <li className="message-list__item message-list__item--load-earlier" key="load-earlier">
        <button className="load-earlier" onClick={() => void onLoadEarlier()} type="button">
          {copyFor(locale).loadEarlierLabel}
        </button>
      </li>
    ) : null;

  const dismissKeyboardIfActive = useCallback(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const isTouchOrKeyboard =
      window.matchMedia?.("(pointer: coarse)").matches ||
      document.documentElement.classList.contains("keyboard-open");
    if (!isTouchOrKeyboard) return;

    const activeEl = document.activeElement;
    if (
      activeEl instanceof HTMLElement &&
      (activeEl.tagName === "TEXTAREA" || activeEl.tagName === "INPUT")
    ) {
      activeEl.blur();
    }
  }, []);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLElement>) => {
      const target = event.currentTarget;
      followingRef.current = isNearBottom(target);
      syncTopScrimOpacity(target, onScrolledFromTopChange);

      const currentScrollTop = target.scrollTop;
      const maxScroll = target.scrollHeight - target.clientHeight;

      if (maxScroll <= 0) {
        updateCollapseState(false);
        lastScrollTopRef.current = currentScrollTop;
        return;
      }

      const delta = currentScrollTop - lastScrollTopRef.current;
      const distanceFromBottom = maxScroll - currentScrollTop;

      if (Math.abs(delta) >= SCROLL_DELTA_THRESHOLD) {
        dismissKeyboardIfActive();
      }

      if (delta <= -SCROLL_DELTA_THRESHOLD) {
        // 用户往上滑（向上翻看历史消息） -> 收缩四格小组件，浮现毛玻璃
        updateCollapseState(true);
        lastScrollTopRef.current = currentScrollTop;
      } else if (delta >= SCROLL_DELTA_THRESHOLD) {
        // 用户往下滑（向下翻看最新消息） -> 展开四格小组件，恢复透明
        updateCollapseState(false);
        lastScrollTopRef.current = currentScrollTop;
      }

      // 若滑回最底部附近，自动恢复展开
      if (distanceFromBottom <= 32) {
        updateCollapseState(false);
      }
    },
    [dismissKeyboardIfActive, onScrolledFromTopChange, updateCollapseState],
  );

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length > 0) {
      touchStartYRef.current = event.touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (touchStartYRef.current === null || event.touches.length === 0) return;
      const currentY = event.touches[0].clientY;
      const deltaY = touchStartYRef.current - currentY;
      const target = event.currentTarget;
      const maxScroll = target.scrollHeight - target.clientHeight;

      if (maxScroll > 0 && Math.abs(deltaY) >= 12) {
        dismissKeyboardIfActive();
        if (deltaY < 0) {
          // 手势上滑（向上翻阅内容） -> 收缩四格
          updateCollapseState(true);
        } else if (deltaY > 0) {
          // 手势下滑（向下回看新消息） -> 展开四格
          updateCollapseState(false);
        }
        touchStartYRef.current = currentY;
      }
    },
    [dismissKeyboardIfActive, updateCollapseState],
  );

  const handleTouchEnd = useCallback(() => {
    touchStartYRef.current = null;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContainerClick = (event: MouseEvent) => {
      if (
        event.target === container ||
        (event.target instanceof HTMLElement && event.target.classList.contains("message-list"))
      ) {
        dismissKeyboardIfActive();
      }
    };

    container.addEventListener("click", handleContainerClick);
    return () => {
      container.removeEventListener("click", handleContainerClick);
    };
  }, [dismissKeyboardIfActive]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <section
      ref={containerRef}
      className="conversation-view"
      onScroll={handleScroll}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <ol aria-live="polite" aria-relevant="additions text" className="message-list" role="log">
        {memoryCard}
        {loadEarlierEntry}
        {virtualizationEnabled ? (
          <li className="message-list__item message-list__item--viewport" role="presentation">
            <div
              style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
            >
              {virtualItems.map((virtualItem) => {
                const message = messages[virtualItem.index];
                if (message === undefined) return null;
                return (
                  <div
                    className={`message-list__item message-list__item--${message.role}`}
                    data-index={virtualItem.index}
                    key={virtualItem.key}
                    ref={virtualizer.measureElement}
                    style={{
                      left: 0,
                      position: "absolute",
                      top: 0,
                      transform: `translateY(${virtualItem.start}px)`,
                      width: "100%",
                    }}
                  >
                    {renderMessageContent(message, virtualItem.index)}
                  </div>
                );
              })}
            </div>
          </li>
        ) : (
          messages.map((message, index) => (
            <li className={`message-list__item message-list__item--${message.role}`} key={message.id}>
              {renderMessageContent(message, index)}
            </li>
          ))
        )}
        <li ref={endRef} aria-hidden="true" className="message-list__end" />
      </ol>
    </section>
  );
}
