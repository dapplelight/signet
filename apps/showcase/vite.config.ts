import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
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

// Every *.html here is a page that ships in the build: index.html plus one
// demo per screens set (screens-user.html, ...). Adding a page needs only its
// file; the showcase header links to each one, except qa.html (the screenshot gallery for
// machines, see src/qa.tsx), which still ships in the build.
const pages = readdirSync(new URL("./", import.meta.url)).filter((f) => f.endsWith(".html"))

export default defineConfig({
  // Relative asset paths: dist works from any static host or sub-path.
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      input: Object.fromEntries(
        pages.map((f) => [f.slice(0, -5), fileURLToPath(new URL(f, import.meta.url))]),
      ),
    },
  },
  define: {
    __SCREEN_PAGES__: JSON.stringify(
      pages.filter((f) => f !== "index.html" && f !== "qa.html").sort(),
    ),
  },
})
