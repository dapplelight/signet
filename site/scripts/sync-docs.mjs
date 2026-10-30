// Builds the docs from the repo's own Markdown (READMEs, CONTRACT, CONVENTIONS...) into site/.docs.
// Nothing is written twice: edit the source file, not .docs. Links between mapped files become doc links;
// any other repo path becomes a GitHub link.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, normalize, relative } from "node:path"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const out = fileURLToPath(new URL("../.docs/", import.meta.url))
const GITHUB = "https://github.com/dapplelight/signet/blob/main/"

// [source, slug, title, group, order, description]
const PAGES = [
  ["README.md", "index", "Getting started", "Start", 1, "What Signet is and how to add it to an app."],
  ["packages/create-signet-app/README.md", "create-signet-app", "create-signet-app", "Start", 2, "Scaffold a new app or API."],
  ["CONVENTIONS.md", "conventions", "Conventions", "Start", 3, "The stack choices Signet assumes."],
  ["MIGRATION.md", "migration", "Migrating an app", "Start", 4, "Moving an existing app onto Signet."],
  ["packages/tokens/README.md", "tokens", "Tokens and themes", "Packages", 1, "Themes as CSS variables."],
  ["packages/tokens/CONTRACT.md", "theme-contract", "Theme contract", "Packages", 2, "Every variable a theme must define."],
  ["packages/ui/README.md", "ui", "UI components", "Packages", 3, "React components styled only through tokens."],
  ["packages/lib/README.md", "lib", "Client lib", "Packages", 4, "API client, formatters, forms and analytics."],
  ["packages/server/README.md", "server", "Server kit", "Packages", 5, "Hono and Workers: errors, auth, middleware, MCP, OAuth."],
  ["packages/ai/README.md", "ai", "AI", "Packages", 6, "Structured LLM calls with budgets, caching and failover."],
  ["packages/config/README.md", "config", "Config", "Packages", 7, "Biome preset, tsconfig bases and CI."],
  ["API.md", "api", "API reference", "Reference", 1, "Every export path and symbol."],
  ["CHANGELOG.md", "changelog", "Changelog", "Reference", 2, "What changed, by package."],
  ["CONTRIBUTING.md", "contributing", "Contributing", "Reference", 3, "Issues, ideas and how the repo is laid out."],
]
const slugOf = new Map(PAGES.map(([src, slug]) => [src, slug]))

function body(src) {
  let md = readFileSync(join(repo, src), "utf8")
  md = md.replace(/^<p align="center">[\s\S]*?<\/p>\s*/m, "") // the README logo block
  md = md.replace(/^# .*\n+/m, "") // Starlight prints the title
  // Relative links: to a mapped page, or to GitHub. Anchors and absolute URLs are left alone.
  return md.replace(/\]\((?!https?:|#|mailto:)([^)#\s]+)(#[^)]*)?\)/g, (_, link, hash = "") => {
    const target = normalize(join(dirname(src), link)).replace(/\/$/, "")
    const page = slugOf.get(target) ?? slugOf.get(`${target}/README.md`)
    if (page) return `](./${page}.md${hash})`
    return `](${GITHUB}${target}${hash})`
  })
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const full = []
for (const [src, slug, title, group, order, description] of PAGES) {
  const text = body(src)
  const front = `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\nsidebar:\n  group: ${group}\n  order: ${order}\n---\n\n`
  writeFileSync(join(out, `${slug}.md`), front + text)
  full.push(`# ${title}\n\n${text}`)
}
writeFileSync(
  join(out, "llms.txt"),
  `# Signet\n\n> One component kit, many design systems: React components, CSS-variable themes, and a Hono/Workers server kit.\n\n## Docs\n\n${PAGES.map(([, slug, title, , , d]) => `- [${title}](./${slug}.md): ${d}`).join("\n")}\n`,
)
writeFileSync(join(out, "llms-full.txt"), full.join("\n\n"))
console.log(`docs: ${PAGES.length} pages from ${relative(process.cwd(), repo) || "."}`)
