/**
 * Composed apps, OUTSIDE the monorepo: each part alone (plus what it needs),
 * no parts, and every part, on each surface (--ui, --api, both). Each app is
 * scaffolded, installed from local packs of Signet's packages, then checked:
 * no markers or placeholders left, every dependency used, lint, typecheck,
 * the app's own tests, and the build (web) or the migrations (api): db:check
 * passes and drizzle-kit finds nothing left to generate.
 *
 *   bun run test/scaffold-parts.ts [ui|api|both] [part]   (default: everything)
 *
 * Slow (dozens of installs), so it is `test:parts` and its own CI job.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"
import { PART_NAMES, PARTS, type PartName } from "../src/compose.js"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const CLI = `${ROOT}/packages/create-signet-app/src/index.ts`
const PACKAGES = ["lib", "tokens", "ui", "server", "db", "payments"]
const SURFACES = { ui: ["--ui"], api: ["--api"], both: [] } as const
type Surface = keyof typeof SURFACES

const [onlySurface, onlyPart] = process.argv.slice(2) as [Surface | undefined, string | undefined]

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const out = (r: { stdout: Buffer; stderr: Buffer }) =>
  (r.stdout.toString() + r.stderr.toString()).slice(-1500)

function files(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (["node_modules", "dist", ".git"].includes(e.name) || e.name.endsWith(".tgz")) return []
    const full = join(dir, e.name)
    return e.isDirectory() ? files(full, base) : [full.slice(base.length + 1)]
  })
}

// Pack Signet's packages once; every app installs the same packs.
const PACKS = join("/tmp", "__scaffold_parts_packs__")
rmSync(PACKS, { recursive: true, force: true })
mkdirSync(PACKS)
for (const p of PACKAGES) await $`npm pack ${ROOT}/packages/${p}`.cwd(PACKS).quiet()
const packs = Object.fromEntries(
  readdirSync(PACKS).map((f) => [
    `@dapplelight/${f.replace(/^dapplelight-/, "").replace(/-\d+\.\d+\.\d+\.tgz$/, "")}`,
    `file:${join(PACKS, f)}`,
  ]),
)

const MARKER = new RegExp(
  String.raw`(//|\{/\*|<!--|#)\s*!?(${[...PART_NAMES, "web", "api"].join("|")}):(begin|end)|\s(//|#)\s*@!?(${[...PART_NAMES, "web", "api"].join("|")})\s*$`,
  "m",
)

/** Imported module names across the app's source, e.g. "hono", "@dapplelight/signet-ui". */
function imported(dir: string, all: string[]): Set<string> {
  const names = new Set<string>()
  for (const f of all.filter((f) => /\.(tsx?|css)$/.test(f))) {
    const text = readFileSync(join(dir, f), "utf8")
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*"((?:@[^"/]+\/)?[^"/.][^"/]*)/g))
      names.add(m[1] as string)
  }
  return names
}

async function check(label: string, surface: Surface, parts: string[]) {
  console.log(`\n${label}`)
  const dir = join("/tmp", `__scaffold_parts_${label.replace(/\W+/g, "_")}__`)
  rmSync(dir, { recursive: true, force: true })
  try {
    const args = [
      ...SURFACES[surface],
      ...(parts.length ? ["--with", parts.join(",")] : ["--starter", "blank"]),
    ]
    // Each part is checked alone, so MCP only where it is the part.
    const mcp = parts.includes("mcp") ? [] : surface === "ui" ? [] : ["--no-mcp"]
    const made = await $`bun run ${CLI} ${dir} ${args} ${mcp}`.cwd("/tmp").nothrow().quiet()
    ok(`${label}: scaffolds`, made.exitCode === 0, out(made))
    if (made.exitCode !== 0) return
    const all = files(dir)
    const web = surface !== "api"
    const api = surface !== "ui"
    const left = all.filter((f) => {
      const t = readFileSync(join(dir, f), "utf8")
      return MARKER.test(t) || /__(APP_NAME|THEME|PM_\w+)__/.test(t)
    })
    ok(`${label}: no markers or placeholders left`, left.length === 0, left.join(", "))
    ok(
      `${label}: only its surfaces' files`,
      all.some((f) => f.startsWith("src/")) === web &&
        all.some((f) => f.startsWith("api/")) === api &&
        all.includes("scripts/dev.ts") === (web && api),
    )
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    if (!web)
      ok(
        `${label}: no Vite or React`,
        !Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) =>
          /^(vite|react|@vitejs|@tanstack\/router-plugin)/.test(d),
        ),
      )

    // Install: Signet's packages from the packs.
    for (const name of Object.keys(pkg.dependencies))
      if (packs[name]) pkg.dependencies[name] = packs[name]
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`)
    const install = await $`bun install`.cwd(dir).nothrow().quiet()
    ok(`${label}: installs`, install.exitCode === 0, out(install))
    if (install.exitCode !== 0) return

    // A dependency is used when the source imports it, or it is a peer of a
    // package the source imports (signet-ui's @base-ui/react and input-otp).
    const used = imported(dir, all)
    const peers = new Set(
      [...used].flatMap((u) => {
        const p = join(dir, "node_modules", u, "package.json")
        return existsSync(p)
          ? Object.keys(JSON.parse(readFileSync(p, "utf8")).peerDependencies ?? {})
          : []
      }),
    )
    const unused = Object.keys(pkg.dependencies).filter((d) => !used.has(d) && !peers.has(d))
    ok(`${label}: every dependency is used`, unused.length === 0, unused.join(", "))

    for (const [script, needed] of [
      ["lint", true],
      ["typecheck", true],
      ["test", true],
      ["build", web],
      ["db:check", api],
    ] as const) {
      if (!needed) continue
      const r = await $`bun run ${script}`.cwd(dir).nothrow().quiet()
      ok(`${label}: ${script}`, r.exitCode === 0, out(r))
    }
    if (api) {
      const sql = () => readdirSync(join(dir, "drizzle")).filter((f) => f.endsWith(".sql"))
      const before = sql()
      const gen = await $`bun x drizzle-kit generate`.cwd(dir).nothrow().quiet()
      const added = sql().filter((f) => !before.includes(f))
      ok(
        `${label}: the migrations match the schema (nothing to generate)`,
        gen.exitCode === 0 && /No schema changes/i.test(out(gen)),
        added.map((f) => readFileSync(join(dir, "drizzle", f), "utf8")).join("\n") || out(gen),
      )
    }
  } catch (err) {
    ok(`${label}: completed`, false, String(err))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const surfaces = (onlySurface ? [onlySurface] : Object.keys(SURFACES)) as Surface[]
for (const surface of surfaces) {
  const fits = PART_NAMES.filter((p) => !(surface === "ui" && PARTS[p as PartName].apiOnly))
  const cases: [string, string[]][] = [
    ["none", []],
    ...fits.map((p): [string, string[]] => [p, [p]]),
    ["all", fits],
  ]
  for (const [name, parts] of cases)
    if (!onlyPart || onlyPart === name) await check(`${surface}-${name}`, surface, parts)
}

rmSync(PACKS, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
