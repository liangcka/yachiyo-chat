import { App as CapacitorApp } from "@capacitor/app";
import { useEffect, useRef } from "react";
import { isNativeApp } from "../services/app-platform";

const EXIT_HINT_WINDOW_MS = 2_000;

/**
 * APK 原生壳的返回键处理：
 * 有弹层打开时先关闭弹层；否则需在 2 秒内再按一次才退出，防止聊天时误触。
 * 回调经 latest-ref 转发，调用方每次渲染传入新闭包即可读到最新状态。
 */
export function useAndroidBack(
  onCloseOverlays: () => boolean,
  onExitHint: () => void,
): void {
  const overlaysRef = useRef(onCloseOverlays);
  const hintRef = useRef(onExitHint);
  const lastPressRef = useRef(0);

  useEffect(() => {
    overlaysRef.current = onCloseOverlays;
    hintRef.current = onExitHint;
  });

  useEffect(() => {
    if (!isNativeApp()) {
      return undefined;
    }

    const listener = CapacitorApp.addListener("backButton", () => {
      if (overlaysRef.current()) {
        return;
      }
      const now = Date.now();
      if (now - lastPressRef.current <= EXIT_HINT_WINDOW_MS) {
        void CapacitorApp.exitApp();
        return;
      }
      lastPressRef.current = now;
      hintRef.current();
    });

    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, []);
}
