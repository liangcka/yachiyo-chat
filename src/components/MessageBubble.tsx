import { Copy, RotateCcw, RotateCw } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, Locale, MessageStatus } from "../domain/chat";
import type { StickerEntry } from "../features/sticker/catalog.gen";
import { splitStickerPieces, stickerUrl, stripPartialStickerToken } from "../features/sticker/parse";
import { copyFor } from "../i18n/messages";
import { splitAssistantMessage, type BubblePiece } from "./message-splitter";

export interface MessageBubbleProps {
  locale: Locale;
  message: ChatMessage;
  imageUrl?: string;
  /** "显示引用来源"开关；false 时不渲染 assistant 消息的参考来源列表 */
  showSources?: boolean;
  /** 是否允许分条消息气泡，默认开启 */
  multiBubble?: boolean;
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

/** 去除 Markdown 加粗标记（仅复制纯文本时使用） */
function stripMarkdownBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/gu, "$1");
}

/**
 * 将包含 **加粗** 的段落渲染为 React 元素，未闭合的星号保持原样
 */
function renderFormattedParagraph(text: string): ReactNode {
  if (!text.includes("**")) {
    return text;
  }
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const boldText = match[1];
    if (boldText.length > 0) {
      parts.push(
        <strong key={`bold-${key++}`} className="message-bubble__bold">
          {boldText}
        </strong>,
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function formatMessageText(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** assistant 气泡展开后的渲染片段：文本气泡或贴图图片 */
type BubbleRenderItem =
  | { kind: "bubble"; id: string; text: string; isTyping: boolean }
  | { kind: "sticker"; id: string; sticker: StickerEntry };

/**
 * 将拆分器气泡展开为渲染片段：整条内容为 [sticker:id] 的气泡渲染为贴图图片；
 * 流式期间末尾未闭合标记先隐藏，若隐藏后无剩余内容则回退为 typing 气泡。
 */
function expandBubblePieces(pieces: readonly BubblePiece[], isStreaming: boolean): BubbleRenderItem[] {
  const items: BubbleRenderItem[] = [];
  pieces.forEach((piece, index) => {
    if (piece.isTyping === true) {
      items.push({ kind: "bubble", id: piece.id, text: "", isTyping: true });
      return;
    }
    const isLast = index === pieces.length - 1;
    const text = isStreaming && isLast ? stripPartialStickerToken(piece.text) : piece.text;
    const subPieces = splitStickerPieces(text);
    if (subPieces.length === 0) {
      if (isStreaming && isLast) {
        items.push({ kind: "bubble", id: piece.id, text: "", isTyping: true });
      }
      return;
    }
    subPieces.forEach((sub, subIndex) => {
      if (sub.kind === "sticker") {
        items.push({ kind: "sticker", id: `${piece.id}-sticker-${subIndex}`, sticker: sub.sticker });
      } else {
        items.push({ kind: "bubble", id: `${piece.id}-text-${subIndex}`, text: sub.text, isTyping: false });
      }
    });
  });
  return items;
}

interface SingleBubbleProps {
  messageRole: "user" | "assistant";
  locale: Locale;
  text: string;
  status: MessageStatus;
  isTyping?: boolean;
  truncated?: boolean;
  imageUrl?: string;
  sources?: ReadonlyArray<{ title: string; url: string }>;
  onRecall?: () => void;
  onRegenerate?: () => void;
  onToast?: (message: string) => void;
  onImageLoad?: () => void;
}

const SingleBubble = memo(function SingleBubble({
  imageUrl,
  isTyping = false,
  locale,
  messageRole,
  onImageLoad,
  onRecall,
  onRegenerate,
  onToast,
  sources,
  status,
  text,
  truncated = false,
}: SingleBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const bubbleRef = useRef<HTMLElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const ignoreNextClickRef = useRef(false);

  const displayText = text.trim();
  const paragraphs = useMemo(() => formatMessageText(displayText), [displayText]);
  const hasText = displayText.length > 0;
  const hasImage = imageUrl !== undefined;
  const hasVisibleSources = sources !== undefined && sources.length > 0;

  const openMenu = () => {
    if (bubbleRef.current) {
      const rect = bubbleRef.current.getBoundingClientRect();
      setPlacement(rect.top < 110 ? "bottom" : "top");
    }
    setMenuOpen(true);
  };

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

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
      await navigator.clipboard.writeText(stripMarkdownBold(displayText));
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
      aria-label={messageLabel(messageRole, locale)}
      className={`message-bubble message-bubble--${messageRole}${isTyping ? " message-bubble--typing" : ""}${menuOpen ? " message-bubble--menu-open" : ""}`}
      data-status={status}
      onContextMenu={hasMenuOptions ? handleContextMenu : undefined}
      onPointerCancel={handlePointerUp}
      onPointerDown={hasMenuOptions ? handlePointerDown : undefined}
      onPointerMove={hasMenuOptions ? handlePointerMove : undefined}
      onPointerUp={handlePointerUp}
      onClick={(e) => {
        if (ignoreNextClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
          ignoreNextClickRef.current = false;
        }
      }}
    >
      {hasImage ? (
        imageUrl !== undefined ? (
          <img alt="" className="message-bubble__image" onLoad={onImageLoad} src={imageUrl} />
        ) : (
          <div aria-hidden="true" className="message-bubble__image message-bubble__image--loading" />
        )
      ) : null}
      {isTyping ? (
        <span aria-hidden="true" className="message-bubble__typing">
          <i />
          <i />
          <i />
        </span>
      ) : hasText ? (
        <>
          {paragraphs.map((p, idx) => (
            <p key={idx}>{renderFormattedParagraph(p)}</p>
          ))}
          {truncated ? (
            <span className="message-bubble__truncated">{copyFor(locale).truncated}</span>
          ) : null}
        </>
      ) : null}
      {hasVisibleSources && sources !== undefined ? (
        <div aria-label={copyFor(locale).sourcesLabel} className="message-bubble__sources">
          {sources.map((source) => (
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
          className={`message-bubble__context-menu message-bubble__context-menu--${messageRole} message-bubble__context-menu--${placement}`}
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

/** memo 化：流式期间只有最后一条消息变化，其余气泡跳过重渲（配合上游稳定回调引用） */
export const MessageBubble = memo(function MessageBubble({
  imageUrl,
  locale,
  message,
  multiBubble = true,
  onImageLoad,
  onRecall,
  onRegenerate,
  onToast,
  showSources,
}: MessageBubbleProps) {
  // 关闭"显示引用来源"时，联网回复正文中的 [n] 引用标记一并隐藏（仅展示层）
  const hideCitations = showSources === false && message.sources !== undefined && message.sources.length > 0;
  const strippedText = hideCitations ? stripCitationMarkers(message.text) : message.text;
  const displayText = strippedText.trim().length > 0 ? strippedText : message.text;

  // 用户消息直接渲染单气泡
  if (message.role === "user") {
    return (
      <SingleBubble
        imageUrl={imageUrl}
        locale={locale}
        messageRole="user"
        onImageLoad={onImageLoad}
        onRecall={onRecall}
        onRegenerate={onRegenerate}
        onToast={onToast}
        status={message.status}
        text={displayText}
      />
    );
  }

  // 仅 assistant 消息渲染联网搜索的参考来源，且受"显示引用来源"开关控制；
  // 正文到达前（搜索与模型等待期）不渲染来源区块，保持三点等待动画
  const visibleSources =
    showSources !== false && displayText.trim().length > 0
      ? message.sources?.filter(({ title, url }) => title.length > 0 && url.length > 0)
      : undefined;

  const isStreaming = message.status === "streaming";
  const pieces = splitAssistantMessage(displayText, isStreaming, multiBubble);
  const items = expandBubblePieces(pieces, isStreaming);

  if (items.length === 0) {
    return null;
  }

  const renderSticker = (item: Extract<BubbleRenderItem, { kind: "sticker" }>) => (
    <img
      alt={item.sticker.alt}
      className="message-bubble__sticker"
      key={item.id}
      onLoad={onImageLoad}
      src={stickerUrl(item.sticker)}
    />
  );

  // 来源列表与截断提示依附于最后一个文本气泡；贴图图片不承载这些附属信息
  const lastBubbleIndex = items.reduce(
    (acc, item, index) => (item.kind === "bubble" ? index : acc),
    -1,
  );

  if (items.length === 1) {
    const only = items[0];
    if (only.kind === "sticker") {
      return renderSticker(only);
    }
    return (
      <SingleBubble
        isTyping={only.isTyping}
        locale={locale}
        messageRole="assistant"
        onRecall={onRecall}
        onRegenerate={onRegenerate}
        onToast={onToast}
        sources={visibleSources}
        status={message.status}
        text={only.text}
        truncated={message.truncated}
      />
    );
  }

  return (
    <div className="message-bubble-group" data-role="assistant">
      {items.map((item, index) =>
        item.kind === "sticker" ? (
          renderSticker(item)
        ) : (
          <SingleBubble
            key={item.id}
            isTyping={item.isTyping}
            locale={locale}
            messageRole="assistant"
            onRecall={onRecall}
            onRegenerate={onRegenerate}
            onToast={onToast}
            sources={index === lastBubbleIndex ? visibleSources : undefined}
            status={message.status}
            text={item.text}
            truncated={index === lastBubbleIndex ? message.truncated : undefined}
          />
        ),
      )}
    </div>
  );
});
