import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Plain multi-entry build, no extension plugin: two HTML pages and the service
// worker. public/ (manifest.json, theme-init.js) is copied to dist/ as is.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        popup: "popup.html",
        options: "options.html",
        background: "src/background.ts",
      },
      output: {
        // manifest.json names the service worker, so it cannot carry a hash.
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
})
