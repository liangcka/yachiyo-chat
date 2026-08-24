import { useRegisterSW } from "virtual:pwa-register/react";
import { isNativeApp } from "../services/app-platform";

export function usePwaUpdate() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    // APK 原生壳加载的是本地打包资源，无需 Service Worker
    immediate: !isNativeApp(),
    onRegisteredSW(_swUrl, registration) {
      if (isNativeApp()) {
        return;
      }
      if (registration) {
        const checkUpdate = () => {
          if (navigator.onLine) {
            void registration.update();
          }
        };
        // Check immediately on registration
        checkUpdate();
        // Check periodically every 15 minutes
        setInterval(checkUpdate, 15 * 60 * 1000);
        // Check when window gains focus or tab becomes visible
        window.addEventListener("focus", checkUpdate);
        const handleVisibility = () => {
          if (document.visibilityState === "visible") {
            checkUpdate();
          }
        };
        document.addEventListener("visibilitychange", handleVisibility);
      }
    },
  });

  return {
    needRefresh,
    offlineReady,
    setNeedRefresh,
    setOfflineReady,
    updateServiceWorker,
  };
}
