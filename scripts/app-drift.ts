#!/usr/bin/env bun
/**
 * Which app is behind on which Signet fix?
 *
 * Reads the `@dapplelight/signet-*` (and `create-signet-app`) versions in each
 * app's package.json, compares them with npm `latest`, and lists the
 * security-relevant CHANGELOG entries published in between, apps with the most
 * missed fixes first.
 *
 *   bun run scripts/app-drift.ts <app dir or package.json>...
 *
 * Reads the declared range's lower bound (`^0.3.0` is 0.3.0), not a lockfile.
 * `workspace:`, `file:` and `link:` ranges are skipped. Needs git history and
 * the npm registry. Read-only.
 *
 * Which entries are "in between": an entry headed `### pkg 0.4.0` counts when
 * that version is above the installed one. A fragment folded by the release
 * commit has no version, so it counts when the commit that added it came after
 * the installed version was published. Security-relevant is a keyword match on
 * the entry (SECURITY below), so skim the list; it can over-report.
 * Tested by app-drift.test.ts.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { named, packages } from "./bump.ts"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const REGISTRY = "https://registry.npmjs.org"

export const SECURITY =
  /security|csrf|xss|ssrf|spoof|vulnerab|injection|bypass|forged|cf-connecting-ip|its own bucket|scrub|timing attack|constant-time|\bleak|\bcve\b|open redirect/i

export type Entry = { heading: string; body: string; date: string }

export const semver = (s: string) => s.match(/\d+\.\d+\.\d+/)?.[0]
const cmp = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number))
  return (x[0] - y[0]) * 1e6 + (x[1] - y[1]) * 1e3 + (x[2] - y[2])
}

/** Every CHANGELOG entry with the date of the commit that first added it. */
export function entries(root: string): Entry[] {
  const out = spawnSync("git", ["log", "-p", "-U0", "--format=%x01%aI", "--", "CHANGELOG.md"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  }).stdout
  const found: Entry[] = []
  let date = ""
  let cur: Entry | undefined
  for (const line of out.split("\n")) {
    if (line.startsWith("\x01")) {
      date = line.slice(1)
      cur = undefined
    } else if (line.startsWith("@@")) cur = undefined
    else if (line.startsWith("+### ")) {
      cur = { heading: line.slice(1), body: "", date }
      found.push(cur)
    } else if (cur && line.startsWith("+") && !line.startsWith("+++"))
      cur.body += `${line.slice(1)}\n`
  }
  // Same text added again by a later edit: log runs newest first, so the last write is the oldest.
  return [...new Map(found.map((e) => [`${e.heading}\n${e.body}`, e])).values()]
}

/** Entries for `pkg` (short name) newer than `installed`, security-relevant only. */
export function missed(
  all: Entry[],
  known: ReturnType<typeof packages>,
  pkg: string,
  installed: string,
  latest: string,
  installedAt: string,
) {
  return all.filter((e) => {
    // "### signet-server 0.4.0 (web push)" names the package before its version
    if (!named(e.heading.replace(/\s+\d+\.\d+\.\d+.*/, ""), known).pkgs.has(pkg)) return false
    if (!SECURITY.test(`${e.heading}\n${e.body}`)) return false
    const v = semver(e.heading)
    return v ? cmp(v, installed) > 0 && cmp(v, latest) <= 0 : e.date > installedAt
  })
}

type Meta = { latest: string; time: Record<string, string> }
const meta = (name: string): Promise<Meta> =>
  fetch(`${REGISTRY}/${name}`)
    .then(
      (r) => r.json() as Promise<{ "dist-tags": { latest: string }; time: Record<string, string> }>,
    )
    .then((m) => ({ latest: m["dist-tags"].latest, time: m.time }))

if (import.meta.main) {
  const dirs = process.argv.slice(2)
  if (!dirs.length) {
    console.error("usage: bun run scripts/app-drift.ts <app dir or package.json>...")
    process.exit(1)
  }
  const known = packages(ROOT)
  const all = entries(ROOT)
  const metas = new Map<string, Promise<Meta>>()
  const report: { app: string; lines: string[]; count: number }[] = []

  for (const d of dirs) {
    const file = existsSync(d) && statSync(d).isDirectory() ? join(d, "package.json") : d
    const pj = JSON.parse(readFileSync(file, "utf8"))
    const deps = { ...pj.peerDependencies, ...pj.devDependencies, ...pj.dependencies } as Record<
      string,
      string
    >
    const lines: string[] = []
    const seen = new Set<string>()
    for (const [name, range] of Object.entries(deps)) {
      if (!/^@dapplelight\/signet-|^create-signet-app$/.test(name)) continue
      const installed = /^(workspace|file|link):/.test(range) ? undefined : semver(range)
      if (!installed) {
        lines.push(`   ${name}  ${range}  (skipped)`)
        continue
      }
      if (!metas.has(name)) metas.set(name, meta(name))
      const m = await metas.get(name)?.catch(() => undefined)
      if (!m) {
        lines.push(`   ${name}  ${range}  (npm lookup failed)`)
        continue
      }
      const key = name.replace(/^@dapplelight\//, "").replace(/^signet-/, "")
      const miss = missed(all, known, key, installed, m.latest, m.time[installed] ?? "")
      lines.push(
        `   ${name}  ${installed} -> ${m.latest}${installed === m.latest ? "  current" : `  ${miss.length} security-relevant`}`,
      )
      for (const e of miss) {
        const first = e.body.split("\n").find((l) => l.trim()) ?? ""
        const text = `${e.heading.replace(/^###\s*/, "")}  ${first.replace(/^[-\s*]+/, "").slice(0, 90)}`
        if (!seen.has(text)) lines.push(`      ${text}`)
        seen.add(text)
      }
    }
    report.push({ app: pj.name ?? d, lines, count: seen.size })
  }

  for (const r of report.sort((a, b) => b.count - a.count)) {
    console.log(`${r.app}: ${r.count} security-relevant entries missed`)
    for (const l of r.lines) console.log(l)
    console.log()
  }
}
