import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { useClosing } from "./use-closing";

export interface UsePanelResult<T extends HTMLElement = HTMLElement> {
  closing: boolean;
  closeRef: RefObject<HTMLButtonElement | null>;
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  panelRef: RefObject<T | null>;
  render: boolean;
}

/**
 * 侧边栏/历史面板共享的弹层基础设施：
 * 组合 useClosing 提供关闭动画状态，并统一焦点管理
 * （打开时聚焦关闭按钮并记录返回焦点、关闭后还原焦点、Tab 焦点陷阱、Escape 关闭）。
 */
export function usePanel<T extends HTMLElement = HTMLElement>(
  open: boolean,
  onClose: () => void,
): UsePanelResult<T> {
  const panelRef = useRef<T | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { render, closing } = useClosing(open, 300);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return { render, closing, panelRef, closeRef, handleKeyDown };
}
