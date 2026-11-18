/**
 * The composer: an app is surfaces (web, api or both) plus parts. Files come
 * from base/ and each selected part's folder, in halves:
 *
 *   shared/  always        web/  with the web surface
 *   api/     with the api  both/ with both surfaces
 *
 * each laid over the app root. Code shared between parts (api/app.ts, the
 * schema, services, the shell, the route tree) lives in base/ once, with each
 * part's lines marked; `applyBlocks` keeps the lines of what was chosen and
 * drops the markers, so the app carries no trace of the parts it left out.
 */

import { existsSync } from "node:fs"
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import account from "../parts/account/part.js"
import admin from "../parts/admin/part.js"
import auth from "../parts/auth/part.js"
import mcp from "../parts/mcp/part.js"
import notifications from "../parts/notifications/part.js"
import orgs from "../parts/orgs/part.js"
import payments from "../parts/payments/part.js"
import privacy from "../parts/privacy/part.js"

type Deps = Record<string, string>

/** What one part adds, besides its files. Its code in shared files is marked `// <name>:begin`. */
export type Part = {
  /** One line, for --help. */
  description: string
  /** Parts it cannot work without; added for you. */
  needs?: PartName[]
  /** Needs the API surface (it has no web half). */
  apiOnly?: boolean
  web?: { deps?: Deps }
  api?: { deps?: Deps }
  /** With both surfaces: dev deps and scripts (the browser test). */
  both?: { devDeps?: Deps; scripts?: Record<string, string> }
  /** Lines for the generated env file. A function, so secrets are fresh per app. */
  env?: () => string[]
  /** SQL tables its schema adds: the migrations keep only the chosen parts' tables. */
  tables?: string[]
  /** API files the web half also reads; a UI-only app gets a copy at the mapped path. */
  uiCopies?: Record<string, string>
}

/** In dependency order: a part comes after what it needs. */
export const PART_NAMES = [
  "auth",
  "account",
  "orgs",
  "admin",
  "notifications",
  "privacy",
  "payments",
  "mcp",
] as const
export type PartName = (typeof PART_NAMES)[number]
export const PARTS: Record<PartName, Part> = {
  auth,
  account,
  orgs,
  admin,
  notifications,
  privacy,
  payments,
  mcp,
}

/**
 * A named mix of parts. `full` is everything the full template had; `blank`
 * is the base alone (the shell, the API, the database), for parts of your own.
 * MCP is not listed: it is asked for (or --mcp / --no-mcp), as it always was.
 */
export const STARTERS = {
  full: { parts: PART_NAMES.filter((p) => p !== "mcp") },
  blank: { parts: [] },
} satisfies Record<string, { parts: PartName[] }>
export type StarterName = keyof typeof STARTERS

/**
 * The chosen parts plus everything they need, in PARTS order, and what was
 * added for a need. Throws on an unknown part or a need that was excluded.
 */
export function resolveParts(
  chosen: string[],
  without: string[],
): { parts: PartName[]; added: { part: PartName; for: PartName }[] } {
  for (const p of [...chosen, ...without])
    if (!PART_NAMES.includes(p as PartName))
      throw new Error(`Unknown part "${p}". Available: ${PART_NAMES.join(", ")}`)
  const both = chosen.filter((p) => without.includes(p))
  if (both.length) throw new Error(`"${both[0]}" is in both --with and --without.`)
  const set = new Set(chosen as PartName[])
  const added: { part: PartName; for: PartName }[] = []
  // ponytail: needs are at most two deep, so a few passes settle; a cycle would be a bug in a manifest.
  for (let pass = 0; pass < PART_NAMES.length; pass++)
    for (const p of [...set])
      for (const need of (PARTS[p] as Part).needs ?? []) {
        if (without.includes(need))
          throw new Error(`${p} needs ${need}: drop --without ${need}, or leave ${p} out.`)
        if (!set.has(need)) {
          set.add(need)
          added.push({ part: need, for: p })
        }
      }
  return { parts: PART_NAMES.filter((p) => set.has(p)), added }
}

const MARKER_NAMES = new Set<string>([...PART_NAMES, "web", "api"])
const BLOCK = /^\s*(?:\/\/|\{\/\*|<!--|#)\s*(!?[\w-]+):(begin|end)\s*(?:\*\/\}|-->)?\s*$/
const TAG =
  /\s+(?:\/\/\s*@(!?[\w-]+)|#\s*@(!?[\w-]+)|\{\/\*\s*@(!?[\w-]+)\s*\*\/\}|<!--\s*@(!?[\w-]+)\s*-->)\s*$/

/**
 * Keep what applies, drop the markers. A block is the lines between
 * `// name:begin` and `// name:end` (also `{/* name:begin *\/}`, `<!-- … -->`,
 * `# …`); blocks nest. A line ending in `// @name` is that one line. `!name`
 * means "without name". Names are parts and the surfaces, `web` and `api`.
 */
export function applyBlocks(text: string, on: ReadonlySet<string>): string {
  const name = (c: string) => c.replace(/^!/, "")
  // Only our names are markers, so a stray `// @ts-expect-error` stays put.
  const known = (c: string) => MARKER_NAMES.has(name(c))
  const holds = (c: string) => (c.startsWith("!") ? !on.has(name(c)) : on.has(c))
  const open: boolean[] = []
  const out: string[] = []
  for (const line of text.split("\n")) {
    const block = BLOCK.exec(line)
    if (block && known(block[1] as string)) {
      if (block[2] === "begin") open.push(holds(block[1] as string))
      else if (open.pop() === undefined) throw new Error(`Unmatched marker: ${line.trim()}`)
      continue
    }
    if (!open.every(Boolean)) continue
    const tag = TAG.exec(line)
    const cond = tag && (tag[1] ?? tag[2] ?? tag[3] ?? tag[4])
    if (!tag || !cond || !known(cond) || !line.slice(0, tag.index).trim()) out.push(line)
    else if (holds(cond)) out.push(line.slice(0, tag.index))
  }
  if (open.length) throw new Error(`Unclosed marker (${open.length} open)`)
  return out.join("\n")
}

/**
 * The blank lines a dropped block leaves, gone the way the formatter would
 * have it: none at the top, never two in a row, none just inside brackets.
 */
export function tidy(text: string): string {
  return text
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([{([]|=>)\n\n/g, "$1\n")
    .replace(/\n\n(\s*[})\]])/g, "\n$1")
}

/** Every file under dir, relative to it. */
async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full, base)))
    else out.push(full.slice(base.length + 1))
  }
  return out
}

/**
 * Keep the chosen parts' tables in drizzle/: drop each statement on a table
 * of a part left out, and the table from the snapshot. A migration left with
 * no statements goes, with its snapshot and journal entry.
 * ponytail: drops only trailing migrations cleanly (prevId is not relinked);
 * the base has two, and only the last can empty out.
 */
async function filterMigrations(dir: string, dropTables: Set<string>) {
  if (!dropTables.size) return
  const journalPath = join(dir, "meta/_journal.json")
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: { idx: number; tag: string }[]
  }
  const keep: typeof journal.entries = []
  for (const entry of journal.entries) {
    const sqlPath = join(dir, `${entry.tag}.sql`)
    const snapPath = join(dir, `meta/${entry.tag.slice(0, 4)}_snapshot.json`)
    const statements = (await readFile(sqlPath, "utf8")).split("--> statement-breakpoint")
    const kept = statements.filter((s) => {
      const table = /CREATE TABLE `(\w+)`/.exec(s)?.[1] ?? / ON `(\w+)`/.exec(s)?.[1]
      return !table || !dropTables.has(table)
    })
    if (!kept.some((s) => s.trim())) {
      await rm(sqlPath)
      await rm(snapPath)
      continue
    }
    keep.push(entry)
    if (kept.length !== statements.length)
      await writeFile(sqlPath, kept.join("--> statement-breakpoint").trim())
    // Snapshots are cumulative: a later one still lists an earlier one's tables.
    const snap = JSON.parse(await readFile(snapPath, "utf8")) as { tables: Record<string, unknown> }
    for (const t of dropTables) delete snap.tables[t]
    await writeFile(snapPath, JSON.stringify(snap, null, 2))
  }
  if (keep.length !== journal.entries.length) {
    journal.entries = keep
    await writeFile(journalPath, JSON.stringify(journal, null, 2))
  }
}

export type ComposeOptions = {
  parts: PartName[]
  web: boolean
  api: boolean
}

/** The base's own dependencies per surface, from index.ts (signet-mcp's index reads them there). */
export type BaseDeps = {
  web: { deps: Deps; devDeps: Deps }
  api: { deps: Deps; devDeps: Deps }
}

const ROOT = resolve(import.meta.dirname, "..")
const sorted = (o: Deps) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))

/**
 * Lay the base and the chosen parts' files into dest and resolve their
 * markers. Returns the package.json body and the env file lines.
 */
export async function compose(dest: string, { parts, web, api }: ComposeOptions, base: BaseDeps) {
  const halves = ["shared", ...(web ? ["web"] : []), ...(api ? ["api"] : [])]
  if (web && api) halves.push("both")
  for (const dir of ["base", ...parts.map((p) => `parts/${p}`)])
    for (const half of halves) {
      const src = join(ROOT, dir, half)
      if (existsSync(src)) await cp(src, dest, { recursive: true })
    }
  const chosen = parts.map((p) => PARTS[p] as Part)
  if (!api)
    for (const p of parts)
      for (const [from, to] of Object.entries((PARTS[p] as Part).uiCopies ?? {}))
        await cp(join(ROOT, "parts", p, "api", from), join(dest, to))

  const on = new Set<string>([...parts, ...(web ? ["web"] : []), ...(api ? ["api"] : [])])
  for (const f of await walk(dest)) {
    const path = join(dest, f)
    const text = await readFile(path, "utf8")
    let out = applyBlocks(text, on)
    if (out === text) continue
    // Code only: in Markdown a blank line before `)` or after `(` can matter.
    if (/\.(tsx?|json)$/.test(f)) out = tidy(out)
    await writeFile(path, out.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n"))
  }

  if (api)
    await filterMigrations(
      join(dest, "drizzle"),
      new Set(
        PART_NAMES.filter((p) => !parts.includes(p)).flatMap(
          (p) => (PARTS[p] as Part).tables ?? [],
        ),
      ),
    )

  const refs = [...(web ? ["app", "node", "test"] : []), ...(api ? ["api"] : [])]
  const ref = (r: string) => `{ "path": "./tsconfig.${r}.json" }`
  await writeFile(
    join(dest, "tsconfig.json"),
    `{\n  "files": [],\n  "references": ${
      refs.length > 1
        ? `[\n${refs.map((r) => `    ${ref(r)}`).join(",\n")}\n  ]`
        : `[${ref(refs[0] as string)}]`
    }\n}\n`,
  )

  const deps: Deps = {}
  const devDeps: Deps = {}
  for (const [on, b] of [
    [web, base.web],
    [api, base.api],
  ] as const) {
    if (!on) continue
    Object.assign(deps, b.deps)
    Object.assign(devDeps, b.devDeps)
  }
  for (const p of chosen) {
    if (web) Object.assign(deps, p.web?.deps)
    if (api) Object.assign(deps, p.api?.deps)
    if (web && api) Object.assign(devDeps, p.both?.devDeps)
  }
  const scripts: Record<string, string> =
    web && api
      ? {
          // Both halves: the API (restarting on change) and Vite, which proxies /api to it.
          dev: "bun scripts/dev.ts",
          build: "tsc -b && vite build",
          // One process serves the API and the built app from dist/.
          start: "bun api/server.ts",
          preview: "vite preview",
          lint: "biome check .",
          format: "biome check --write .",
          typecheck: "tsc -b --noEmit",
          test: "bun test src test",
          ...Object.assign({}, ...chosen.map((p) => p.both?.scripts)),
        }
      : web
        ? {
            dev: "vite",
            build: "tsc -b && vite build",
            preview: "vite preview",
            lint: "biome check .",
            format: "biome check --write .",
            typecheck: "tsc -b --noEmit",
            test: "bun test src",
          }
        : {
            dev: "bun --watch api/server.ts",
            start: "bun api/server.ts",
            lint: "biome check .",
            format: "biome check --write .",
            typecheck: "tsc -b --noEmit",
            test: "bun test test",
          }
  if (api)
    Object.assign(scripts, {
      "db:generate": "drizzle-kit generate",
      "db:check": "signet-db-check drizzle",
    })

  return {
    pkg: { scripts, dependencies: sorted(deps), devDependencies: sorted(devDeps) },
    env: api ? ["APP_ENV=development", ...chosen.flatMap((p) => p.env?.() ?? []), ""] : [],
  }
}
