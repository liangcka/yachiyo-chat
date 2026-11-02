import { useCallback, useEffect, useRef, useState } from "react";
import type { UiCopy } from "../i18n/messages";

export type ToastTone = "info" | "error";

/** 文案可延迟到展示时按当前语言解析，便于语言尚未加载的底层 hook 发出提示。 */
export type ToastMessage = string | ((copy: UiCopy) => string);

export interface ToastState {
  id: number;
  message: ToastMessage;
  tone: ToastTone;
}

export type ShowToast = (message: ToastMessage, tone?: ToastTone) => void;

const toastDurationMs = 5_200;

export function resolveToastMessage(message: ToastMessage, copy: UiCopy): string {
  return typeof message === "function" ? message(copy) : message;
}

/** 单槽位轻提示：新提示覆盖旧提示，递增 id 让读屏器重复播报相同文案。 */
export function useToast(): { toast?: ToastState; showToast: ShowToast } {
  const [toast, setToast] = useState<ToastState>();
  const sequenceRef = useRef(0);

  const showToast = useCallback<ShowToast>((message, tone = "info") => {
    setToast({ id: ++sequenceRef.current, message, tone });
  }, []);

  useEffect(() => {
    if (toast === undefined) return;
    const timeout = setTimeout(() => setToast(undefined), toastDurationMs);
    return () => clearTimeout(timeout);
  }, [toast]);

  return { toast, showToast };
}
