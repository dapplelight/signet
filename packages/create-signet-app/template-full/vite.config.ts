import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The API (api/server.ts) listens on PORT, 3000 by default. In dev, Vite
// proxies /api and /mcp to it, so the browser sees one origin, as it does in
// production where api/server.ts also serves the built app.
const api = `http://localhost:${process.env.PORT ?? 3000}`

export default defineConfig({
  plugins: [
    // Must come before react(): it generates src/routeTree.gen.ts from
    // src/routes and splits each route into its own chunk.
    tanstackRouter({ target: "react", autoCodeSplitting: true, quoteStyle: "double" }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: { proxy: { "/api": api, "/mcp": api } },
})
