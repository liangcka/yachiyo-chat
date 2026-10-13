import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { App } from "./App";
import { isNativeApp } from "./services/app-platform";
import "./styles/global.css";

// 启动确认不依赖登录、网络或数据库，离线启动同样能保留已验证的资源包。
if (isNativeApp()) {
  void CapacitorUpdater.notifyAppReady().catch(() => {
    console.error("无法确认原生资源包启动状态");
  });
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Yachiyo Chat root element is missing.");
}

if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister();
    }
  });
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
