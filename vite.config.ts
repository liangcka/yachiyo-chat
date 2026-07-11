import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      strategies: "generateSW",
      includeAssets: ["yachiyo-mark.svg"],
      manifest: {
        name: "Yachiyo Chat",
        short_name: "Yachiyo",
        display: "standalone",
        orientation: "portrait",
        background_color: "#07102d",
        theme_color: "#142d67",
        icons: [
          {
            src: "/yachiyo-mark.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
