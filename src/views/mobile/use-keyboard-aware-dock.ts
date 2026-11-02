import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** 视口高度比无键盘基准缩小超过该值时判定为软键盘弹起 */
const keyboardHeightThreshold = 120;
/** 失焦后等待焦点转移完成再判定，避免在输入框之间切换时误收键盘 */
const focusSettleDelayMs = 50;
/** 输入框聚焦后等待软键盘动画结束再滚到底 */
const keyboardAnimationDelayMs = 280;

function isTextInputFocused(): boolean {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement &&
    (activeElement.tagName === "TEXTAREA" || activeElement.tagName === "INPUT");
}

function scrollChatToBottom(smooth = false): void {
  const chatView = document.querySelector(".conversation-view");
  if (!chatView) return;
  const targetScroll = chatView.scrollHeight - chatView.clientHeight;
  if (targetScroll <= 0) return;
  if (smooth && typeof chatView.scrollTo === "function") {
    chatView.scrollTo({ top: targetScroll, behavior: "smooth" });
  } else {
    chatView.scrollTop = targetScroll;
  }
}

export interface KeyboardAwareDock {
  chatBottomRef: RefObject<HTMLDivElement | null>;
  /** 底栏四格小组件是否收起 */
  collapsed: boolean;
  /** 消息列表滚动方向驱动的收起/展开 */
  setScrollCollapsed: (collapsed: boolean) => void;
  expand: () => void;
  /** 切换或新建会话时恢复底栏与键盘状态 */
  reset: () => void;
  handleComposerFocus: () => void;
  handleComposerBlur: () => void;
}

/**
 * 移动端底栏与软键盘联动：同步 visualViewport 高度到 CSS 变量、
 * 键盘弹起或上滑翻阅历史时收起底栏，并测量底栏高度维持消息滚动留白。
 */
export function useKeyboardAwareDock(
  conversationId: string | undefined,
  hasMessages: boolean,
): KeyboardAwareDock {
  const [scrollCollapsed, setScrollCollapsed] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [prevConversationId, setPrevConversationId] = useState(conversationId);
  const baseViewportHeightRef = useRef(0);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  if (conversationId !== prevConversationId) {
    setPrevConversationId(conversationId);
    setScrollCollapsed(false);
    setKeyboardOpen(false);
    if (typeof document !== "undefined") {
      document.documentElement.classList.remove("keyboard-open");
    }
  }

  // 软键盘弹起或历史消息上滑时收缩四格小组件，优先保证输入与阅读视野
  const collapsed = (scrollCollapsed || keyboardOpen) && hasMessages;

  const reset = useCallback(() => {
    setScrollCollapsed(false);
    setKeyboardOpen(false);
    document.documentElement.classList.remove("keyboard-open");
  }, []);

  /** 键盘已收起：以当前视口为新基准并展开底栏 */
  const settleKeyboardClosed = useCallback((viewportHeight: number) => {
    baseViewportHeightRef.current = viewportHeight;
    document.documentElement.classList.remove("keyboard-open");
    setKeyboardOpen(false);
    setScrollCollapsed(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const viewport = window.visualViewport;

    const handleViewportChange = () => {
      const height = viewport.height;
      document.documentElement.style.setProperty("--visual-viewport-height", `${height}px`);
      if (height > baseViewportHeightRef.current) {
        baseViewportHeightRef.current = height;
      }
      const opened = baseViewportHeightRef.current - height > keyboardHeightThreshold;
      setKeyboardOpen((previous) => {
        if (previous === opened) return previous;
        if (opened) {
          document.documentElement.classList.add("keyboard-open");
          requestAnimationFrame(() => scrollChatToBottom(false));
        } else {
          document.documentElement.classList.remove("keyboard-open");
          setScrollCollapsed(false);
        }
        return opened;
      });
    };

    handleViewportChange();
    viewport.addEventListener("resize", handleViewportChange);

    // 输入框失焦后彻底清除键盘状态，杜绝无焦点时底栏被锁死隐藏
    const handleFocusOut = () => {
      setTimeout(() => {
        if (!isTextInputFocused()) settleKeyboardClosed(viewport.height);
      }, focusSettleDelayMs);
    };
    window.addEventListener("focusout", handleFocusOut);

    const handleOrientationChange = () => {
      baseViewportHeightRef.current = 0;
    };
    window.addEventListener("orientationchange", handleOrientationChange);

    return () => {
      viewport.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("orientationchange", handleOrientationChange);
      document.documentElement.style.removeProperty("--visual-viewport-height");
      document.documentElement.classList.remove("keyboard-open");
    };
  }, [settleKeyboardClosed]);

  const collapsedRef = useRef(collapsed);
  const keyboardOpenRef = useRef(keyboardOpen);
  const lastExpandedHeightRef = useRef(0);

  useEffect(() => {
    collapsedRef.current = collapsed;
    keyboardOpenRef.current = keyboardOpen;
  }, [collapsed, keyboardOpen]);

  const updateBottomHeight = useCallback(() => {
    const bottomElement = chatBottomRef.current;
    if (!bottomElement) return;
    const height = bottomElement.getBoundingClientRect().height;
    if (height <= 0) return;
    if (!collapsedRef.current) {
      lastExpandedHeightRef.current = height;
    }
    // 键盘弹起时以实际收缩高度贴合；普通浏览上滑折叠时保留展开占位以防历史视口跳动
    const targetHeight =
      collapsedRef.current && lastExpandedHeightRef.current > 0
        ? (keyboardOpenRef.current ? height : lastExpandedHeightRef.current)
        : height;
    document.documentElement.style.setProperty("--chat-bottom-height", `${Math.round(targetHeight)}px`);
  }, []);

  // 动态测量底部输入区域高度以保持消息滚动间距，防止收缩时底部留白塌陷遮挡消息
  useEffect(() => {
    const bottomElement = chatBottomRef.current;
    if (!bottomElement || typeof ResizeObserver === "undefined") return;
    updateBottomHeight();
    const observer = new ResizeObserver(updateBottomHeight);
    observer.observe(bottomElement);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--chat-bottom-height");
    };
  }, [updateBottomHeight]);

  useEffect(() => {
    updateBottomHeight();
  }, [collapsed, keyboardOpen, updateBottomHeight]);

  // 底栏因翻阅历史收缩且软键盘未打开时，点击底栏空白毛玻璃区域直接恢复展开
  useEffect(() => {
    const bottomElement = chatBottomRef.current;
    if (!bottomElement) return;
    const handleBottomClick = (event: MouseEvent) => {
      if (!collapsedRef.current || keyboardOpenRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target && !target.closest("button") && !target.closest("textarea") && !target.closest("input")) {
        setScrollCollapsed(false);
      }
    };
    bottomElement.addEventListener("click", handleBottomClick);
    return () => bottomElement.removeEventListener("click", handleBottomClick);
  }, []);

  const expand = useCallback(() => setScrollCollapsed(false), []);

  const handleComposerFocus = useCallback(() => {
    setTimeout(() => scrollChatToBottom(false), keyboardAnimationDelayMs);
  }, []);

  const handleComposerBlur = useCallback(() => {
    setTimeout(() => {
      if (!isTextInputFocused() && typeof window !== "undefined" && window.visualViewport) {
        settleKeyboardClosed(window.visualViewport.height);
      }
    }, focusSettleDelayMs);
  }, [settleKeyboardClosed]);

  return {
    chatBottomRef,
    collapsed,
    setScrollCollapsed,
    expand,
    reset,
    handleComposerFocus,
    handleComposerBlur,
  };
}
