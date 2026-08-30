import { Capacitor } from "@capacitor/core";
import { currentApiOrigin } from "./api-origins";

/** 是否运行在 Capacitor 原生壳（APK）中 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** API 请求基址：网页版同源（空串相对路径），APK 走当前生效线路（含失败自动切换的粘性记忆） */
export function apiOrigin(): string {
  return currentApiOrigin();
}

/** fetch 凭据模式：APK 跨源需 include 才能携带会话 cookie，网页版保持 same-origin */
export function apiCredentials(): RequestCredentials {
  return isNativeApp() ? "include" : "same-origin";
}
