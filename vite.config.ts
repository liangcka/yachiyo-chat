import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:28888",
        changeOrigin: true,
      },
    },
  },
  build: {
    emptyOutDir: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      strategies: "generateSW",
      includeAssets: [
        "yachiyo-mark.svg",
        "yachiyo-192.png",
        "yachiyo-512.png",
        "apple-touch-icon.png",
      ],
      manifest: {
        name: "Yachiyo Chat",
        short_name: "Yachiyo",
        description: "月见八千代的中日双语星空聊天、图片理解与本地历史。",
        lang: "zh-CN",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#07102d",
        theme_color: "#142d67",
        icons: [
          {
            src: "/yachiyo-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/yachiyo-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/yachiyo-mark.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
});
