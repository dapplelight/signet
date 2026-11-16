/**
 * Generates one docs section per package from its README, so every package
 * is on the site and the pages never drift from the repo. Output is
 * gitignored (content/docs/<package>/index.md and meta.json); hand-written
 * pages (component pages, guides) sit next to it and are kept.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "../../..")
const out = join(import.meta.dirname, "../content/docs")

/** Nav order: start with what a new app touches first. */
export const PACKAGES = [
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
if (missing.length) throw new Error(`packages without a docs section: ${missing.join(", ")}`)

/** CLIs run with npx; libraries install. */
const install = (m: { name: string; bin?: unknown; exports?: unknown }) =>
  m.bin && !m.exports ? `npx ${m.name}` : `npm i ${m.name}`

for (const pkg of PACKAGES) {
  const dir = join(root, "packages", pkg)
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  let body = readFileSync(join(dir, "README.md"), "utf8")
  const h1 = body.match(/^# (.+)\n/m)
  if (h1) body = body.replace(h1[0], "")
  const description = (manifest.description ?? "").replace(/"/g, '\\"')
  const title = pkg === "create-signet-app" ? "create-signet-app" : pkg
  mkdirSync(join(out, pkg), { recursive: true })
  writeFileSync(
    join(out, pkg, "index.md"),
    `---\ntitle: "${title}"\ndescription: "${description}"\n---\n\n` +
      `\`\`\`bash\n${install(manifest)}\n\`\`\`\n\n${body.trim()}\n`,
  )
  const meta = join(out, pkg, "meta.json")
  const extra = existsSync(join(out, pkg, "components")) ? ["components"] : []
  writeFileSync(meta, `${JSON.stringify({ title, pages: ["index", ...extra] }, null, 2)}\n`)
}

writeFileSync(
  join(out, "meta.json"),
  `${JSON.stringify({ title: "Signet", pages: ["index", "---Packages---", ...PACKAGES] }, null, 2)}\n`,
)
console.log(`docs: ${PACKAGES.length} package sections`)
