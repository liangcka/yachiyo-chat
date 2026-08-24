import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.yachiyo.chat",
  appName: "Yachiyo Chat",
  webDir: "dist",
  server: {
    // WebView 从 https://localhost 提供本地资源；API 经 src/services/app-platform.ts 指向线上
    androidScheme: "https",
  },
};

export default config;
