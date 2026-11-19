/**
 * Composed apps, OUTSIDE the monorepo: each part alone (plus what it needs),
 * no parts, and every part, on each surface (--ui, --api, both). Each app is
 * scaffolded, then checked: no markers or placeholders left, every dependency
 * used and every import declared (from the app's own package.json), lint,
 * typecheck, the app's own tests, and the build (web) or the migrations (api):
 * db:check passes and drizzle-kit finds nothing left to generate.
 *
 *   bun run test/scaffold-parts.ts [ui|api|both] [part]   (default: everything)
 *
 * Fast enough for PRs: Signet's packages are packed once, every app's
 * dependencies are installed once into one shared directory (each app's
 * node_modules links to its entries), the apps are checked in parallel, and a
 * step whose files are byte-identical to an earlier app's is not run again.
 */

import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { availableParallelism } from "node:os"
import { join } from "node:path"
import { $ } from "bun"
import { PART_NAMES, PARTS, type PartName, STARTERS, type StarterName } from "../src/compose.js"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const CLI = `${ROOT}/packages/create-signet-app/src/index.ts`
const PACKAGES = ["lib", "tokens", "ui", "server", "db", "payments", "ai"]
const SURFACES = { ui: ["--ui"], api: ["--api"], both: [] } as const
type Surface = keyof typeof SURFACES
const TMP = join("/tmp", "__scaffold_parts__")

const [onlySurface, onlyPart] = process.argv.slice(2) as [Surface | undefined, string | undefined]
const started = performance.now()

let pass = 0,
  fail = 0
type Log = string[]
const ok = (log: Log, n: string, c: boolean, d = "") => {
  c ? (pass++, log.push(`  PASS ${n}`)) : (fail++, log.push(`  FAIL ${n} ${d}`))
}
const out = (r: { stdout: Buffer; stderr: Buffer }) =>
  (r.stdout.toString() + r.stderr.toString()).slice(-1500)

function files(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (["node_modules", "dist", ".git"].includes(e.name)) return []
    const full = join(dir, e.name)
    return e.isDirectory() ? files(full, base) : [full.slice(base.length + 1)]
  })
}

const MARKER = new RegExp(
  String.raw`(//|\{/\*|<!--|#)\s*!?(${[...PART_NAMES, "web", "api", "bun", "deno", "node"].join("|")}):(begin|end)|\s(//|#)\s*@!?(${[...PART_NAMES, "web", "api", "bun", "deno", "node"].join("|")})\s*$`,
  "m",
)

/** Imported package names across the app's source, e.g. "hono", "@dapplelight/signet-ui". */
function imported(dir: string, all: string[]): Set<string> {
  const names = new Set<string>()
  for (const f of all.filter((f) => /\.(tsx?|css)$/.test(f))) {
    const text = readFileSync(join(dir, f), "utf8")
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*"((?:@[\w.-]+\/)?\w[\w.:-]*)/g))
      names.add(m[1] as string)
  }
  return names
}

/** Run up to `limit` jobs at once. */
async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item)
    }),
  )
}

// 1. The cases.
const surfaces = (onlySurface ? [onlySurface] : Object.keys(SURFACES)) as Surface[]
type Case = { label: string; surface: Surface; parts: string[]; starter?: StarterName }
const cases: Case[] = surfaces.flatMap((surface) => {
  const fits = PART_NAMES.filter(
    (p) =>
      !(surface === "ui" && PARTS[p as PartName].apiOnly) &&
      !(surface === "api" && PARTS[p as PartName].webOnly),
  )
  return ([["none", []], ...fits.map((p) => [p, [p]]), ["all", fits]] as [string, string[]][])
    .filter(([name]) => !onlyPart || onlyPart === name)
    .map(([name, parts]) => ({ label: `${surface}-${name}`, surface, parts }))
})
// Each starter as it ships (full and blank are "all" and "none" above), on its own surface.
if (!onlyPart || onlyPart.startsWith("starter-"))
  for (const s of Object.keys(STARTERS) as StarterName[]) {
    if (s === "full" || s === "blank" || (onlyPart && onlyPart !== `starter-${s}`)) continue
    const surface: Surface = "surface" in STARTERS[s] ? "api" : "both"
    if (onlySurface && onlySurface !== surface) continue
    cases.push({ label: `starter-${s}`, surface, parts: [...STARTERS[s].parts], starter: s })
  }

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP)
const logs = new Map<string, Log>(cases.map((c) => [c.label, [`\n${c.label}`]]))

// 2. Scaffold every app (cheap) and the static checks.
const made = new Set<Case>()
await pool(cases, availableParallelism(), async ({ label, surface, parts, starter }) => {
  const log = logs.get(label) as Log
  const dir = join(TMP, label)
  const args = starter
    ? ["--starter", starter]
    : [
        ...SURFACES[surface],
        ...(parts.length ? ["--with", parts.join(",")] : ["--starter", "blank"]),
      ]
  // Each part is checked alone, so MCP only where it is the part.
  const mcp = parts.includes("mcp") ? [] : surface === "ui" ? [] : ["--no-mcp"]
  const r = await $`bun run ${CLI} ${dir} ${args} ${mcp}`.cwd(TMP).nothrow().quiet()
  ok(log, `${label}: scaffolds`, r.exitCode === 0, out(r))
  if (r.exitCode !== 0) return
  made.add(cases.find((c) => c.label === label) as Case)
  const all = files(dir)
  const web = surface !== "api"
  const api = surface !== "ui"
  const left = all.filter((f) => {
    const t = readFileSync(join(dir, f), "utf8")
    return MARKER.test(t) || /__(APP_NAME|THEME|PM_\w+)__/.test(t)
  })
  ok(log, `${label}: no markers or placeholders left`, left.length === 0, left.join(", "))
  ok(
    log,
    `${label}: only its surfaces' files`,
    all.some((f) => f.startsWith("src/")) === web &&
      all.some((f) => f.startsWith("api/")) === api &&
      all.includes("scripts/dev.ts") === (web && api),
  )
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  const declared = { ...pkg.dependencies, ...pkg.devDependencies }
  if (!web)
    ok(
      log,
      `${label}: no Vite or React`,
      !Object.keys(declared).some((d) => /^(vite|react|@vitejs|@tanstack\/router-plugin)/.test(d)),
    )
  // The shared install has every app's packages, so an import this app does
  // not declare would still resolve: check it here.
  const undeclared = [...imported(dir, all)].filter(
    (n) => !declared[n] && !n.includes(":") && n !== "bun",
  )
  ok(log, `${label}: every import is declared`, undeclared.length === 0, undeclared.join(", "))
})

// 3. One install: Signet's packages from packs, plus every app's dependencies.
const PACKS = join(TMP, "packs")
const SHARED = join(TMP, "shared")
mkdirSync(PACKS)
mkdirSync(SHARED)
await Promise.all(PACKAGES.map((p) => $`npm pack ${ROOT}/packages/${p}`.cwd(PACKS).quiet()))
const packs: Record<string, string> = Object.fromEntries(
  readdirSync(PACKS).map((f) => [
    `@dapplelight/${f.replace(/^dapplelight-/, "").replace(/-\d+\.\d+\.\d+\.tgz$/, "")}`,
    `file:${join(PACKS, f)}`,
  ]),
)
const superset: Record<string, string> = {}
for (const { label } of made) {
  const pkg = JSON.parse(readFileSync(join(TMP, label, "package.json"), "utf8"))
  for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const want = packs[name] ?? (range as string)
    if (superset[name] && superset[name] !== want)
      throw new Error(`${name}: ${superset[name]} vs ${want} across apps`)
    superset[name] = want
  }
}
writeFileSync(
  join(SHARED, "package.json"),
  JSON.stringify({ name: "shared", private: true, type: "module", dependencies: superset }),
)
const install = await $`bun install`.cwd(SHARED).nothrow().quiet()
if (install.exitCode !== 0) {
  console.log("FAIL shared install", out(install))
  process.exit(1)
}

// 4. The tool runs, in parallel; a step over byte-identical files runs once.
// The migration steps read only these (drizzle-kit is the same shared install).
const db = (f: string) => /^(drizzle\/|api\/db\/|drizzle\.config\.ts$)/.test(f)
const done = new Map<string, Promise<{ code: number; text: string; first: string }>>()
function step(label: string, name: string, cmd: string[], scope: (f: string) => boolean) {
  const dir = join(TMP, label)
  const hash = createHash("sha256").update(cmd.join(" "))
  for (const f of files(dir).filter(scope).sort()) hash.update(f).update(readFileSync(join(dir, f)))
  const key = `${name}:${hash.digest("hex")}`
  const seen = done.get(key)
  if (seen) return seen.then((r) => ({ ...r, same: r.first }))
  const run = $`${cmd}`
    .cwd(dir)
    .nothrow()
    .quiet()
    .then((r) => ({ code: r.exitCode, text: out(r), first: label }))
  done.set(key, run)
  return run.then((r) => ({ ...r, same: "" }))
}

await pool([...made], Math.max(2, Math.floor(availableParallelism() / 2)), async (c) => {
  const { label, surface } = c
  const log = logs.get(label) as Log
  const dir = join(TMP, label)
  // Its own node_modules of links, so caches (.vite, .tmp) stay per app.
  mkdirSync(join(dir, "node_modules"))
  for (const e of readdirSync(join(SHARED, "node_modules")))
    if (!e.startsWith(".") || e === ".bin")
      symlinkSync(join(SHARED, "node_modules", e), join(dir, "node_modules", e))

  // A dependency is used when the source imports it, or it is a peer of a
  // package the source imports (signet-ui's @base-ui/react and input-otp).
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  const used = imported(dir, files(dir))
  const peers = new Set(
    [...used].flatMap((u) => {
      const p = join(dir, "node_modules", u, "package.json")
      return existsSync(p)
        ? Object.keys(JSON.parse(readFileSync(p, "utf8")).peerDependencies ?? {})
        : []
    }),
  )
  const unused = Object.keys(pkg.dependencies).filter((d) => !used.has(d) && !peers.has(d))
  ok(log, `${label}: every dependency is used`, unused.length === 0, unused.join(", "))

  const web = surface !== "api"
  const api = surface !== "ui"
  const all = () => true
  for (const [script, needed] of [
    ["lint", true],
    ["typecheck", true],
    ["test", true],
    ["build", web],
    ["db:check", api],
  ] as const) {
    if (!needed) continue
    const r = await step(label, script, ["bun", "run", script], script === "db:check" ? db : all)
    ok(
      log,
      `${label}: ${script}${r.same ? ` (same files as ${r.same})` : ""}`,
      r.code === 0,
      r.text,
    )
  }
  if (api) {
    const sql = () => readdirSync(join(dir, "drizzle")).filter((f) => f.endsWith(".sql"))
    const before = sql()
    const r = await step(label, "generate", ["bun", "x", "drizzle-kit", "generate"], db)
    const added = sql().filter((f) => !before.includes(f))
    ok(
      log,
      `${label}: the migrations match the schema (nothing to generate)${r.same ? ` (same files as ${r.same})` : ""}`,
      r.code === 0 && /No schema changes/i.test(r.text),
      added.map((f) => readFileSync(join(dir, "drizzle", f), "utf8")).join("\n") || r.text,
    )
  }
})

for (const log of logs.values()) console.log(log.join("\n"))
rmSync(TMP, { recursive: true, force: true })
console.log(
  `\n${pass} passed, ${fail} failed in ${Math.round((performance.now() - started) / 1000)}s`,
)
if (fail) process.exit(1)
