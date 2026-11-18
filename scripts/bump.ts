#!/usr/bin/env bun
/**
 * Bump every package a pending `.changes/*.md` fragment names, once, so PRs
 * never touch versions and never conflict on them. The post-merge workflow
 * runs it on main before folding the fragments, then starts release.yml.
 *
 * A fragment's heading names its packages before the colon, short or full:
 * `### signet-db: ...`, `### db, ui: ...`, `### signet-db and signet-server: ...`,
 * `### all packages: ...`. Patch by default; `(minor)` or `(major)` after a
 * name raises that one: `### signet-ui (minor): ...`. Several fragments for
 * one package bump it once, at the highest level asked. A version a human
 * committed that is not on npm yet is a hand bump and is left as it is. A
 * version the last post-merge release commit set is bumped again even when not
 * on npm yet (its release may still be running). Needs git history. Private
 * packages are never bumped.
 *
 *   bun run scripts/bump.ts          bump (post-merge, on main)
 *   bun run scripts/bump.ts --check  every fragment names known packages (CI)
 *
 * BUMP_PUBLISHED='{"@dapplelight/signet-db":["0.2.0"]}' replaces the npm
 * lookup (tests). Tested by bump.test.ts.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Start of the subject post-merge.yml gives its commit. Keep the two in step. */
export const RELEASE_COMMIT = "chore: release,"

export type Level = "patch" | "minor" | "major"
export type Pkg = { dir: string; name: string; version: string; private: boolean }

const RANK: Record<Level, number> = { patch: 0, minor: 1, major: 2 }
const short = (name: string) => name.replace(/^@dapplelight\//, "").replace(/^signet-/, "")

/** Packages under packages/, keyed by short name ("db", "create-signet-app"). */
export function packages(root: string): Map<string, Pkg> {
  const out = new Map<string, Pkg>()
  for (const d of readdirSync(join(root, "packages"))) {
    const file = join(root, "packages", d, "package.json")
    if (!existsSync(file)) continue
    const p = JSON.parse(readFileSync(file, "utf8"))
    out.set(short(p.name), { dir: d, name: p.name, version: p.version, private: !!p.private })
  }
  return out
}

/** Pending fragments' headings, in file-name order. */
export function headings(root: string): { file: string; heading: string }[] {
  const dir = join(root, ".changes")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((file) => ({ file, heading: readFileSync(join(dir, file), "utf8").split("\n")[0] ?? "" }))
}

/** The packages one heading names, with the level asked for each. */
export function named(heading: string, known: Map<string, Pkg>) {
  const head = heading.replace(/^###\s*/, "")
  const colon = head.indexOf(":")
  const names = (colon < 0 ? head : head.slice(0, colon)).split(/,|\band\b/)
  const pkgs = new Map<string, Level>()
  const unknown: string[] = []
  for (const raw of names) {
    const level = (raw.match(/\((patch|minor|major)\)/)?.[1] ?? "patch") as Level
    const name = raw.replace(/\(.*?\)/g, "").trim()
    if (!name) continue
    if (name === "all packages") {
      for (const [k, p] of known) if (!p.private) pkgs.set(k, level)
      continue
    }
    const key = short(name)
    if (known.has(key)) pkgs.set(key, level)
    else unknown.push(name)
  }
  return { pkgs, unknown }
}

export function next(version: string, level: Level): string {
  const [maj = 0, min = 0, pat = 0] = version.split(/[.-]/).map(Number)
  if (level === "major") return `${maj + 1}.0.0`
  if (level === "minor") return `${maj}.${min + 1}.0`
  return `${maj}.${min}.${pat + 1}`
}

/**
 * True when the last commit to change this package's version line is a
 * post-merge release commit, not a human's. Such a version is bumped again even
 * if its release is still running and it is not on npm yet: that release was
 * checked out before this merge, so it publishes without this change.
 */
function bumpedByRelease(root: string, dir: string): boolean {
  const out = spawnSync(
    "git",
    ["log", "-1", "--format=%s", "-G", '"version":', "--", `packages/${dir}/package.json`],
    { cwd: root, encoding: "utf8" },
  )
  return out.status === 0 && out.stdout.startsWith(RELEASE_COMMIT)
}

async function onNpm(name: string, version: string): Promise<boolean> {
  if (process.env.BUMP_PUBLISHED)
    return (JSON.parse(process.env.BUMP_PUBLISHED)[name] ?? []).includes(version)
  // Three tries, then fail: guessing wrong either double-bumps a hand-bumped
  // package or skips one whose version is already taken.
  for (let i = 0; i < 3; i++) {
    if (i) await Bun.sleep(2000 * i)
    const res = await fetch(`https://registry.npmjs.org/${name}/${version}`, {
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null)
    if (res?.status === 404) return false
    if (res?.ok) return true
  }
  throw new Error(`${name}@${version}: npm registry unreachable; re-run the job`)
}

if (import.meta.main) {
  const ROOT =
    process.env.CHANGES_ROOT ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "")
  const known = packages(ROOT)
  const wanted = new Map<string, Level>()
  const bad: string[] = []
  for (const { file, heading } of headings(ROOT)) {
    const { pkgs, unknown } = named(heading, known)
    if (unknown.length || !pkgs.size)
      bad.push(
        `.changes/${file}: ${unknown.length ? `unknown ${unknown.join(", ")}` : "names no package"}`,
      )
    for (const [k, l] of pkgs) {
      const prev = wanted.get(k)
      if (!prev || RANK[l] > RANK[prev]) wanted.set(k, l)
    }
  }
  if (bad.length) {
    console.error(
      `${bad.join("\n")}\n\nName packages before the colon, e.g. "### signet-db: ..." or "### db, ui (minor): ...". Known: ${[...known.keys()].join(", ")}`,
    )
    process.exit(1)
  }
  if (process.argv.includes("--check")) {
    console.log(`  PASS fragments name ${wanted.size} package(s)`)
    process.exit(0)
  }
  for (const [k, level] of wanted) {
    const p = known.get(k) as Pkg
    if (p.private) continue
    if (!bumpedByRelease(ROOT, p.dir) && !(await onNpm(p.name, p.version))) {
      console.log(`${p.name}@${p.version}: not on npm yet, left as is`)
      continue
    }
    const file = join(ROOT, "packages", p.dir, "package.json")
    const v = next(p.version, level)
    // Only the version line changes, so the file keeps its formatting.
    writeFileSync(file, readFileSync(file, "utf8").replace(/("version":\s*")[^"]+(")/, `$1${v}$2`))
    console.log(`${p.name}: ${p.version} -> ${v}`)
  }
}
