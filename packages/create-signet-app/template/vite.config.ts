import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    // Must come before react(): it generates src/routeTree.gen.ts from
    // src/routes and splits each route into its own chunk.
    tanstackRouter({ target: "react", autoCodeSplitting: true, quoteStyle: "double" }),
    react(),
    tailwindcss(),
    // Installable app + offline: src/sw.ts is the service worker (precache,
    // public/offline.html fallback, update on "Reload", web push). The icons in
    // public/ are neutral placeholders: replace them with your own at the same
    // sizes. background_color is the launch screen an installed app opens on.
    VitePWA({
      registerType: "prompt",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      manifest: {
        name: "__APP_NAME__",
        short_name: "__APP_NAME__",
        display: "standalone",
        start_url: "/",
        scope: "/",
        background_color: "__BG_LAUNCH__",
        theme_color: "__BG_LAUNCH__",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
})
