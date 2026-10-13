import type { CapacitorConfig } from "@capacitor/cli";
import type {} from "@capgo/capacitor-updater";
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import release from "./mobile-release.json";

const config: CapacitorConfig = {
  appId: "app.yachiyo.chat",
  appName: "Yachiyo Chat",
  webDir: "dist",
  plugins: {
    CapacitorUpdater: {
      autoUpdate: false,
      autoDeletePrevious: false,
      autoDeleteFailed: false,
      resetWhenUpdate: true,
      statsUrl: "",
      updateUrl: "",
      channelUrl: "",
      appReadyTimeout: 15000,
      responseTimeout: 30,
      version: release.bundleVersion,
      publicKey: createPublicKey(readFileSync("src/update/public-key.txt"))
        .export({ type: "pkcs1", format: "pem" }).toString(),
    },
  },
  server: {
    // WebView 从 https://localhost 提供本地资源；API 经 src/services/app-platform.ts 指向线上
    androidScheme: "https",
  },
};

export default config;
