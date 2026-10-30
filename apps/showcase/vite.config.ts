import { readdirSync } from "node:fs"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Every theme in packages/tokens gets a three-line wrapper in src/themes. Fail
// the build, loudly, when someone adds a theme and forgets the wrapper.
const wrappers = new Set(readdirSync(new URL("./src/themes/", import.meta.url)))
for (const f of readdirSync(new URL("../../packages/tokens/src/themes/", import.meta.url))) {
  if (!wrappers.has(f)) {
    throw new Error(`Add apps/showcase/src/themes/${f} (copy a sibling) to show the new theme.`)
  }
}

export default defineConfig({
  // Relative asset paths: dist works from any static host or sub-path.
  base: "./",
  plugins: [react(), tailwindcss()],
})
