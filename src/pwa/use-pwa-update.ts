import { useCallback, useEffect, useRef, useState } from "react";
import { registerSW } from "virtual:pwa-register";
import { isNativeApp } from "../services/app-platform";

export function usePwaUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const updateRef = useRef<(reloadPage?: boolean) => Promise<void>>(async () => undefined);

  useEffect(() => {
    // immediate=false 只延迟注册；原生更新必须完全避开 Service Worker 的资源拦截。
    if (isNativeApp()) return;
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    const checkUpdate = () => {
      if (navigator.onLine) void registration?.update().catch(() => undefined);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") checkUpdate();
    };
    updateRef.current = registerSW({
      immediate: true,
      onNeedRefresh: () => { if (active) setNeedRefresh(true); },
      onOfflineReady: () => { if (active) setOfflineReady(true); },
      onRegisteredSW(_url, value) {
        if (active) {
          registration = value;
          checkUpdate();
        }
      },
    });
    const interval = window.setInterval(checkUpdate, 15 * 60 * 1000);
    window.addEventListener("focus", checkUpdate);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkUpdate);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const updateServiceWorker = useCallback((reloadPage?: boolean): Promise<void> => updateRef.current(reloadPage), []);

  return {
    needRefresh,
    offlineReady,
    setNeedRefresh,
    setOfflineReady,
    updateServiceWorker,
  };
}
