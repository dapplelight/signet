/**
 * One page per package, generated from its package.json and its rows in
 * API.md: an install command and a card per module. Not the README: READMEs
 * are written for maintainers and agents, docs pages stay short and visual.
 * Output is gitignored. Fails if a package has no page.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "../../..")
const out = join(import.meta.dirname, "../content/docs/packages")

/** Nav order: what a new app touches first. */
const PACKAGES = [
  "create-signet-app",
  "ui",
  "tokens",
  "lib",
  "server",
  "db",
  "payments",
  "ai",
  "mcp",
  "cli",
  "config",
  "test",
]

const found = readdirSync(join(root, "packages")).filter((p) =>
  existsSync(join(root, "packages", p, "package.json")),
)
const missing = found.filter((p) => !PACKAGES.includes(p))
if (missing.length) throw new Error(`packages without a docs page: ${missing.join(", ")}`)

/** `| \`@dapplelight/signet-lib/api\` | exports | What |` rows, per package. */
function modules(name: string) {
  const api = readFileSync(join(root, "API.md"), "utf8")
  const section = api.split(/^## /m).find((s) => s.startsWith(`${name}\n`))
  if (!section) return []
  return [...section.matchAll(/^\| `([^`]+)` \| ([^|]*) \| (.*) \|$/gm)].map(
    ([, path, exports, what]) => ({
      path,
      title: path === name ? "main" : path.slice(name.length + 1),
      // "re-exports a, b, c" says nothing; show the first exports instead.
      what: what.startsWith("re-exports")
        ? exports
            .split(", ")
            .filter((e) => e !== "…")
            .slice(0, 4)
            .join(", ")
        : short(what),
    }),
  )
}

/** First clause, at most ~10 words: a card caption, not a paragraph. */
function short(text: string) {
  const clause = text
    .replace(/`/g, "")
    .replace(/\s*\(.*?\)/g, "")
    .split(/[:;.]\s|, plus | — /)[0]
  const words = clause.split(/\s+/)
  return words.length > 10 ? `${words.slice(0, 10).join(" ")}…` : clause
}

const esc = (s: string) => s.replace(/"/g, "&quot;").replace(/[{}<>]/g, "")

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const pkg of PACKAGES) {
  const m = JSON.parse(readFileSync(join(root, "packages", pkg, "package.json"), "utf8"))
  const cli = m.bin && !m.exports
  const install = cli ? `npx ${m.name}` : `npm i ${m.name}`
  const mods = modules(m.name)
  const cards = mods.length
    ? `## Modules\n\n<Cards>\n${mods
        .map((x) => `  <Card title="${esc(x.title)}" description="${esc(x.what)}" />`)
        .join("\n")}\n</Cards>\n`
    : ""
  writeFileSync(
    join(out, `${pkg}.mdx`),
    `---\ntitle: "${pkg}"\ndescription: "${esc(m.description ?? "")}"\n---\n\n` +
      `\`\`\`bash\n${install}\n\`\`\`\n\n${cards}`,
  )
}
writeFileSync(
  join(out, "meta.json"),
  `${JSON.stringify({ title: "Packages", root: true, pages: PACKAGES }, null, 2)}\n`,
)
console.log(`docs: ${PACKAGES.length} package pages`)
