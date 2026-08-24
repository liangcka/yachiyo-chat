import { Capacitor } from "@capacitor/core";

/** 线上部署地址：APK 原生壳（origin 为 https://localhost）从这里跨源调用 API */
const API_REMOTE_ORIGIN = "https://yachiyochat.amtale.cn";

/** 是否运行在 Capacitor 原生壳（APK）中 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** API 请求基址：网页版同源（空串相对路径），APK 走线上绝对地址 */
export function apiOrigin(): string {
  return isNativeApp() ? API_REMOTE_ORIGIN : "";
}

/** fetch 凭据模式：APK 跨源需 include 才能携带会话 cookie，网页同源保持 same-origin */
export function apiCredentials(): RequestCredentials {
  return isNativeApp() ? "include" : "same-origin";
}
