import { Copy, RotateCcw, RotateCw } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { ChatMessage, Locale } from "../domain/chat";
import { copyFor } from "../i18n/messages";

export interface MessageBubbleProps {
  locale: Locale;
  message: ChatMessage;
  imageUrl?: string;
  /** "显示引用来源"开关；false 时不渲染 assistant 消息的参考来源列表 */
  showSources?: boolean;
  onRecall?: () => void;
  onRegenerate?: () => void;
  onToast?: (message: string) => void;
  onImageLoad?: () => void;
}

function messageLabel(role: ChatMessage["role"], locale: Locale): string {
  if (locale === "ja-JP") return role === "assistant" ? "八千代の返事" : "あなたのメッセージ";
  return role === "assistant" ? "八千代的回复" : "我的消息";
}

/** 去除联网回复正文中的 [n] 引用标记（仅展示层，存储保留原文） */
function stripCitationMarkers(text: string): string {
  return text.replace(/\[(\d{1,2})\]/gu, "");
}

/** memo 化：流式期间只有最后一条消息变化，其余气泡跳过重渲（配合上游稳定回调引用） */
export const MessageBubble = memo(function MessageBubble({
  imageUrl,
  locale,
  message,
  onImageLoad,
  onRecall,
  onRegenerate,
  onToast,
  showSources,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const bubbleRef = useRef<HTMLElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const ignoreNextClickRef = useRef(false);

  // 关闭"显示引用来源"时，联网回复正文中的 [n] 引用标记一并隐藏（仅展示层）
  const hideCitations = showSources === false && message.sources !== undefined && message.sources.length > 0;
  const strippedText = hideCitations ? stripCitationMarkers(message.text) : message.text;
  const displayText = strippedText.trim().length > 0 ? strippedText : message.text;

  const hasText = displayText.trim().length > 0;
  const hasImage = message.imageId !== undefined;
  const isTyping = message.text.length === 0 && message.status === "streaming";
  // 仅 assistant 消息渲染联网搜索的参考来源，且受"显示引用来源"开关控制；
  // 正文到达前（搜索与模型等待期）不渲染来源区块，保持三点等待动画
  const visibleSources =
    message.role === "assistant" && showSources !== false && hasText
      ? message.sources?.filter(({ title, url }) => title.length > 0 && url.length > 0)
      : undefined;
  const hasVisibleSources = visibleSources !== undefined && visibleSources.length > 0;

  const openMenu = () => {
    if (bubbleRef.current) {
      const rect = bubbleRef.current.getBoundingClientRect();
      setPlacement(rect.top < 110 ? "bottom" : "top");
    }
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDownDoc = (e: PointerEvent) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDownDoc, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDownDoc, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      ignoreNextClickRef.current = true;
      openMenu();
      try {
        navigator.vibrate?.(40);
      } catch {
        // Ignore vibration errors
      }
    }, 400);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointerStartPosRef.current) return;
    const dist = Math.hypot(
      e.clientX - pointerStartPosRef.current.x,
      e.clientY - pointerStartPosRef.current.y,
    );
    if (dist > 8) {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      pointerStartPosRef.current = null;
    }
  };

  const handlePointerUp = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    pointerStartPosRef.current = null;
    setTimeout(() => {
      ignoreNextClickRef.current = false;
    }, 120);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    openMenu();
  };

  const handleCopy = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(displayText);
      onToast?.(copyFor(locale).copied);
    } catch {
      // Ignore clipboard write failures
    }
  };

  const handleRecallAction = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setMenuOpen(false);
    onRecall?.();
  };

  const handleRegenerateAction = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setMenuOpen(false);
    onRegenerate?.();
  };

  if (!hasText && !hasImage && !isTyping) {
    return null;
  }

  const hasMenuOptions = onRecall !== undefined || onRegenerate !== undefined || hasText;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <article
      ref={bubbleRef}
      aria-label={messageLabel(message.role, locale)}
      className={`message-bubble message-bubble--${message.role}${isTyping ? " message-bubble--typing" : ""}${menuOpen ? " message-bubble--menu-open" : ""}`}
      data-status={message.status}
      onClick={(e) => {
        if (ignoreNextClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
          ignoreNextClickRef.current = false;
        }
      }}
      onContextMenu={hasMenuOptions ? handleContextMenu : undefined}
      onPointerCancel={handlePointerUp}
      onPointerDown={hasMenuOptions ? handlePointerDown : undefined}
      onPointerMove={hasMenuOptions ? handlePointerMove : undefined}
      onPointerUp={handlePointerUp}
    >
      {hasImage ? (
        imageUrl !== undefined ? (
          <img alt="" className="message-bubble__image" onLoad={onImageLoad} src={imageUrl} />
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
          <p>{displayText}</p>
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
      {hasVisibleSources && visibleSources !== undefined ? (
        <div aria-label={copyFor(locale).sourcesLabel} className="message-bubble__sources">
          {visibleSources.map((source) => (
            <a
              href={source.url}
              key={source.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {source.title}
            </a>
          ))}
        </div>
      ) : null}
      {menuOpen && (
        <div
          aria-label={copyFor(locale).appName}
          className={`message-bubble__context-menu message-bubble__context-menu--${message.role} message-bubble__context-menu--${placement}`}
          role="menu"
        >
          {onRegenerate !== undefined ? (
            <button
              aria-label={copyFor(locale).regenerate}
              className="message-bubble__context-item message-bubble__context-item--regenerate"
              onClick={handleRegenerateAction}
              role="menuitem"
              type="button"
            >
              <RotateCw aria-hidden="true" size={14} strokeWidth={2.2} />
              <span>{copyFor(locale).regenerate}</span>
            </button>
          ) : null}
          {onRecall !== undefined ? (
            <button
              aria-label={copyFor(locale).recall}
              className="message-bubble__context-item message-bubble__context-item--recall"
              onClick={handleRecallAction}
              role="menuitem"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={14} strokeWidth={2.2} />
              <span>{copyFor(locale).recall}</span>
            </button>
          ) : null}
          {hasText ? (
            <button
              aria-label={copyFor(locale).copyText}
              className="message-bubble__context-item"
              onClick={handleCopy}
              role="menuitem"
              type="button"
            >
              <Copy aria-hidden="true" size={14} strokeWidth={2.2} />
              <span>{copyFor(locale).copyText}</span>
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
});
