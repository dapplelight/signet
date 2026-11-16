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
    // public/offline.html fallback, update on "Reload", web push). Add icons
    // (192 and 512 px PNGs in public/) to the manifest for the install prompt.
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
        icons: [],
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
})
