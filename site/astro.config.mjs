// @ts-check
import { fileURLToPath } from "node:url"
import starlight from "@astrojs/starlight"
import signetDocs, { sidebarFrom } from "@dapplelight/signet-docs"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"

// Pages come from the repo's own Markdown, copied into .docs by scripts/sync-docs.mjs.
const docs = fileURLToPath(new URL("./.docs/", import.meta.url))

export default defineConfig({
  site: "https://signet.dapplelight.in",
  output: "static",
  markdown: { smartypants: false },
  vite: { plugins: [tailwindcss()] },
  integrations: [
    starlight({
      title: "Signet",
      description: "TypeScript kit for web apps and their APIs.",
      favicon: "/favicon.svg",
      sidebar: sidebarFrom(docs, { groups: ["Start", "Packages", "Reference"], fallbackGroup: "Docs" }),
      plugins: [
        signetDocs({
          title: "Signet",
          wordmark: "signet",
          mark: "./src/components/Mark.astro",
          colors: "./src/styles/signet.css",
          repo: "dapplelight/signet",
          license: "MIT licensed",
          nav: [
            { label: "Docs", href: "/docs/", match: "/docs/" },
            { label: "Packages", href: "/docs/tokens/" },
            { label: "API", href: "/docs/api/" },
          ],
          llms: { index: "./.docs/llms.txt", full: "./.docs/llms-full.txt", content: "./.docs/" },
        }),
      ],
    }),
  ],
})
