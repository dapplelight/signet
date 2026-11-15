/**
 * add / upgrade / diff / list against an app directory. No process.exit and no
 * console here: each returns what happened, and src/index.ts prints it.
 *
 * State lives in the app: signet.json records each added item and the hash of
 * every file as copied (its base), and .signet/base/ keeps those base copies,
 * because a 3-way merge on upgrade needs the original, not just its hash.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { IMPORT, type Registry } from "./registry.js"

export type Config = {
  /** Where items are copied, relative to the app root. */
  dir: string
  /** Import prefix that points at `dir`, e.g. @/components/signet. Empty keeps relative imports. */
  alias: string
  /** Added items: signet-ui version and item hash at the time of the last add or upgrade. */
  items: Record<string, { version: string; hash: string }>
  /** Every copied file (registry path) -> hash of the upstream file it was copied from. */
  files: Record<string, string>
  /** Codemods `signet upgrade` has applied (src/codemods.ts ids). */
  codemods?: string[]
}

export const CONFIG = "signet.json"
export const BASE_DIR = ".signet/base"
export const DEFAULTS = { dir: "src/components/signet", alias: "@/components/signet" }

export class SignetCliError extends Error {}

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : undefined)
const write = (p: string, s: string) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, s)
}

export function loadConfig(root: string): Config {
  const raw = read(join(root, CONFIG))
  const c = (raw ? JSON.parse(raw) : {}) as Partial<Config>
  return {
    dir: c.dir ?? DEFAULTS.dir,
    alias: c.alias ?? DEFAULTS.alias,
    items: c.items ?? {},
    files: c.files ?? {},
    ...(c.codemods && { codemods: c.codemods }),
  }
}
export const saveConfig = (root: string, c: Config) =>
  write(join(root, CONFIG), `${JSON.stringify(c, null, 2)}\n`)

/** The file as the app gets it: relative imports become `alias/<path>`. */
export function transform(reg: Registry, path: string, alias: string): string {
  const f = reg.files[path]
  if (!f) throw new SignetCliError(`registry has no file ${path}`)
  if (!alias) return f.content
  return f.content.replace(IMPORT, (m, pre: string, q: string, spec: string) => {
    const target = f.imports[spec]
    if (!target) return m
    const p = target.replace(/\.tsx?$/, "").replace(/\/index$/, "")
    return `${pre}${q}${alias}/${p}${q}`
  })
}

/** names plus their dependencies, dependencies first. */
export function resolve(reg: Registry, names: string[]): string[] {
  const out: string[] = []
  const visit = (n: string) => {
    if (out.includes(n)) return
    const item = reg.items[n]
    if (!item) {
      const near = Object.keys(reg.items).filter((k) => k.includes(n) || n.includes(k))
      throw new SignetCliError(
        `No item "${n}".${near.length ? ` Did you mean: ${near.join(", ")}?` : ""} Run signet list.`,
      )
    }
    for (const d of item.deps) visit(d)
    out.push(n)
  }
  for (const n of names) visit(n)
  return out
}

type Paths = { app: (p: string) => string; base: (p: string) => string }
/** Backend module files (`root: "app"`) live under the app's src/, the rest under `dir`. */
const paths = (root: string, c: Config, reg: Registry): Paths => ({
  app: (p) => join(root, reg.files[p]?.root === "app" ? "src" : c.dir, p),
  base: (p) => join(root, BASE_DIR, p),
})

/** Write the app copy and its base, and record both. */
function commit(root: string, c: Config, reg: Registry, path: string, app: string | null) {
  const next = transform(reg, path, c.alias)
  const p = paths(root, c, reg)
  if (app !== null) write(p.app(path), app)
  write(p.base(path), next)
  c.files[path] = reg.files[path]?.hash as string
}

function missingPeers(root: string, reg: Registry, items: string[]): Record<string, string> {
  const pkg = JSON.parse(read(join(root, "package.json")) ?? "{}") as Record<
    string,
    Record<string, string> | undefined
  >
  const have = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
  const out: Record<string, string> = {}
  for (const n of items)
    for (const [name, range] of Object.entries(reg.items[n]?.peers ?? {}))
      if (!have[name]) out[name] = range
  return out
}

export type AddResult = {
  items: string[]
  written: string[]
  unchanged: string[]
  /** Edited locally and upstream differs: left alone unless force. */
  refused: string[]
  missingPeers: Record<string, string>
}

/**
 * Copy items and their dependencies. All or nothing: if any file has local
 * edits that would be overwritten, nothing is written unless `force`.
 */
export function add(
  root: string,
  reg: Registry,
  names: string[],
  opts: { force?: boolean; config?: Partial<Pick<Config, "dir" | "alias">> } = {},
): AddResult {
  const c = { ...loadConfig(root), ...opts.config }
  const p = paths(root, c, reg)
  const items = resolve(reg, names)
  const res: AddResult = { items, written: [], unchanged: [], refused: [], missingPeers: {} }
  const plan: string[] = []
  for (const path of new Set(items.flatMap((n) => reg.items[n]?.files ?? []))) {
    const next = transform(reg, path, c.alias)
    const cur = read(p.app(path))
    const base = c.files[path] ? read(p.base(path)) : undefined
    if (cur === undefined || cur === base) plan.push(path)
    else if (cur === next || base === next) res.unchanged.push(path)
    else res.refused.push(path)
  }
  if (res.refused.length && !opts.force) return res
  for (const path of [...plan, ...res.refused]) {
    commit(root, c, reg, path, transform(reg, path, c.alias))
    res.written.push(path)
  }
  // Recorded but left as the app has them; their base becomes current upstream
  // only when it already matches (cur === next), so local edits stay mergeable.
  for (const path of res.unchanged)
    if (read(p.app(path)) === transform(reg, path, c.alias)) commit(root, c, reg, path, null)
  for (const n of items) c.items[n] = { version: reg.version, hash: reg.items[n]?.hash as string }
  saveConfig(root, c)
  res.missingPeers = missingPeers(root, reg, items)
  return res
}

export type FileUpgrade = {
  path: string
  status: "current" | "updated" | "merged" | "conflict" | "added" | "needs-merge"
  /** Conflict hunks git left in the file. */
  conflicts?: number
}
export type UpgradeResult = {
  files: FileUpgrade[]
  /** New dependencies the upgrade pulled in. */
  added: string[]
  missingPeers: Record<string, string>
  git: boolean
}

/** git merge-file on three strings: [result, conflict count], or undefined without git. */
export function merge3(
  ours: string,
  base: string,
  theirs: string,
  labels: [string, string, string],
): [string, number] | undefined {
  if (!Bun.which("git")) return undefined
  const dir = mkdtempSync(join(tmpdir(), "signet-merge-"))
  try {
    const [o, b, t] = ["ours", "base", "theirs"].map((n) => join(dir, n)) as [
      string,
      string,
      string,
    ]
    writeFileSync(o, ours)
    writeFileSync(b, base)
    writeFileSync(t, theirs)
    const r = Bun.spawnSync([
      "git",
      "merge-file",
      "-p",
      ...labels.flatMap((l) => ["-L", l]),
      o,
      b,
      t,
    ])
    // Exit code is the number of conflicts; git reports errors as negative (>127 here).
    if (r.exitCode > 127) throw new SignetCliError(`git merge-file failed: ${r.stderr.toString()}`)
    return [r.stdout.toString(), r.exitCode]
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Bring added items up to the registry. Per file: untouched copies are
 * replaced, edited ones get a 3-way merge (base, upstream, app) with conflict
 * markers where both sides changed the same lines. No names: every added item.
 */
export function upgrade(
  root: string,
  reg: Registry,
  names: string[],
  opts: { dryRun?: boolean } = {},
): UpgradeResult {
  const c = loadConfig(root)
  const p = paths(root, c, reg)
  const wanted = names.length ? names : Object.keys(c.items)
  for (const n of wanted)
    if (!c.items[n]) throw new SignetCliError(`"${n}" is not added. Run signet add ${n}.`)
  const items = resolve(reg, wanted)
  const res: UpgradeResult = {
    files: [],
    added: items.filter((n) => !c.items[n]),
    missingPeers: {},
    git: !!Bun.which("git"),
  }
  const writes: [string, string | null][] = []
  for (const path of new Set(items.flatMap((n) => reg.items[n]?.files ?? []))) {
    const theirs = transform(reg, path, c.alias)
    const ours = read(p.app(path))
    const base = c.files[path] ? read(p.base(path)) : undefined
    const f: FileUpgrade = { path, status: "current" }
    res.files.push(f)
    if (ours === theirs) {
      if (base !== theirs) writes.push([path, null])
    } else if (ours === undefined) {
      f.status = "added"
      writes.push([path, theirs])
    } else if (base === undefined) {
      // In the app but never recorded: nothing to merge against.
      f.status = "needs-merge"
    } else if (base === theirs) {
      // Only the app changed it.
    } else if (ours === base) {
      f.status = "updated"
      writes.push([path, theirs])
    } else {
      const m = merge3(ours, base, theirs, ["app", "base", `signet-ui ${reg.version}`])
      if (!m) f.status = "needs-merge"
      else {
        f.status = m[1] ? "conflict" : "merged"
        if (m[1]) f.conflicts = m[1]
        writes.push([path, m[0]])
      }
    }
  }
  res.missingPeers = missingPeers(root, reg, items)
  if (opts.dryRun) return res
  for (const [path, app] of writes) commit(root, c, reg, path, app)
  const stuck = new Set(res.files.filter((f) => f.status === "needs-merge").map((f) => f.path))
  for (const n of items)
    if (!reg.items[n]?.files.some((f) => stuck.has(f)))
      c.items[n] = { version: reg.version, hash: reg.items[n]?.hash as string }
  saveConfig(root, c)
  return res
}

/** Unified diff of a -> b, via git (or diff -u without it). */
export function unifiedDiff(a: string, b: string, label: string): string {
  const dir = mkdtempSync(join(tmpdir(), "signet-diff-"))
  try {
    writeFileSync(join(dir, "a"), a)
    writeFileSync(join(dir, "b"), b)
    const cmd = Bun.which("git")
      ? ["git", "diff", "--no-index", "--no-color", "a", "b"]
      : ["diff", "-u", "a", "b"]
    const out = Bun.spawnSync(cmd, { cwd: dir }).stdout.toString()
    return out
      .replace(/^diff --git .*\n(index .*\n)?/m, "")
      .replace(/^--- a?\/?a.*$/m, `--- ${label} (base)`)
      .replace(/^\+\+\+ b?\/?b.*$/m, `+++ ${label} (upstream)`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** What changed upstream since the copy, per file (base -> current registry). */
export function diff(root: string, reg: Registry, name: string): string {
  const c = loadConfig(root)
  if (!c.items[name]) throw new SignetCliError(`"${name}" is not added. Run signet add ${name}.`)
  const p = paths(root, c, reg)
  return resolve(reg, [name])
    .slice(-1)
    .flatMap((n) => reg.items[n]?.files ?? [])
    .map((path) => unifiedDiff(read(p.base(path)) ?? "", transform(reg, path, c.alias), path))
    .join("")
}

export type ListEntry = {
  name: string
  deps: string[]
  added?: string
  /** Upstream changed since the copy. */
  update?: boolean
  /** The app's copy differs from what was copied. */
  edited?: boolean
}

export function list(root: string, reg: Registry): ListEntry[] {
  const c = loadConfig(root)
  const p = paths(root, c, reg)
  return Object.entries(reg.items).map(([name, item]) => {
    const rec = c.items[name]
    if (!rec) return { name, deps: item.deps }
    return {
      name,
      deps: item.deps,
      added: rec.version,
      update: rec.hash !== item.hash,
      edited: item.files.some((f) => read(p.app(f)) !== read(p.base(f))),
    }
  })
}
