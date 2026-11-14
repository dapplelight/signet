/** Reading the generated index: doc sections, search, scaffold files, migration notes. */

import { INDEX } from "./generated/index.js"
import type { Doc, TemplateFile } from "./types.js"

export const doc = (name: string): Doc | undefined => INDEX.docs.find((d) => d.name === name)

export const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")

export type Section = { doc: string; heading: string; level: number; text: string }

/** A doc split at every heading (outside code fences). The intro is heading "". */
export function sections(d: Doc): Section[] {
  const out: Section[] = []
  let cur: Section = { doc: d.name, heading: "", level: 1, text: "" }
  let fence = false
  for (const line of d.text.split("\n")) {
    if (line.startsWith("```")) fence = !fence
    const h = fence ? null : /^(#{1,4}) (.+)$/.exec(line)
    if (h) {
      out.push(cur)
      cur = {
        doc: d.name,
        heading: (h[2] as string).trim(),
        level: (h[1] as string).length,
        text: "",
      }
    }
    cur.text += `${line}\n`
  }
  out.push(cur)
  return out.filter((s) => s.text.trim())
}

/** One section by heading or its slug, with its subsections. */
export function section(d: Doc, heading: string): string | null {
  const all = sections(d)
  const want = heading
    .replace(/^#+\s*/, "")
    .trim()
    .toLowerCase()
  const i = all.findIndex((s) => s.heading.toLowerCase() === want || slug(s.heading) === slug(want))
  if (i < 0) return null
  const level = (all[i] as Section).level
  let text = (all[i] as Section).text
  for (const s of all.slice(i + 1)) {
    if (s.level <= level) break
    text += s.text
  }
  return text.trim()
}

export type SearchHit = {
  kind: "doc" | "export" | "component" | "recipe"
  title: string
  /** `signet://docs/<name>#<slug>`, an import path, or a component/recipe name. */
  ref: string
  snippet: string
  score: number
}

function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase()
  const at = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0), text.length)
  const start = Math.max(0, at - 80)
  return `${start ? "…" : ""}${text
    .slice(start, start + 280)
    .replace(/\s+/g, " ")
    .trim()}…`
}

/**
 * Keyword search over doc sections, export symbols, components and recipes.
 * ponytail: term counting, no stemming or ranking model; enough for a few
 * hundred sections. Swap for BM25 if the index grows tenfold.
 */
export function search(query: string, limit = 10): SearchHit[] {
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\w@/.-]+/)
        .filter((t) => t.length > 1),
    ),
  ]
  if (!terms.length) return []
  const count = (hay: string, t: string) => Math.min(hay.split(t).length - 1, 10)
  const score = (title: string, body: string, titleWeight = 5) => {
    const tl = title.toLowerCase()
    const bl = body.toLowerCase()
    let s = 0
    let matched = 0
    for (const t of terms) {
      const hit = (tl.includes(t) ? titleWeight : 0) + count(bl, t)
      if (hit) matched++
      s += hit
    }
    return matched ? s * (matched / terms.length) ** 2 : 0
  }
  const hits: SearchHit[] = []
  for (const d of INDEX.docs) {
    for (const s of sections(d)) {
      const sc = score(`${d.title} ${s.heading}`, s.text)
      if (sc)
        hits.push({
          kind: "doc",
          title: `${d.title}${s.heading ? ` › ${s.heading}` : ""}`,
          ref: `signet://docs/${d.name}${s.heading ? `#${slug(s.heading)}` : ""}`,
          snippet: snippet(s.text, terms),
          score: sc,
        })
    }
  }
  for (const e of INDEX.exports) {
    for (const sym of e.symbols) {
      const sc = score(sym.name, `${sym.signature}\n${sym.doc}\n${e.path}`, 8)
      if (sc)
        hits.push({
          kind: "export",
          title: `${sym.name} (${sym.kind})`,
          ref: e.path,
          snippet: (sym.doc || sym.signature).replace(/\s+/g, " ").slice(0, 280),
          score: sc,
        })
    }
  }
  for (const c of INDEX.components) {
    const sc = score(c.name, `${c.exports.join(" ")} ${c.importPath}`, 8)
    if (sc)
      hits.push({
        kind: "component",
        title: c.name,
        ref: c.importPath,
        snippet: c.exports.join(", "),
        score: sc,
      })
  }
  for (const r of INDEX.recipes) {
    const sc = score(`${r.id} ${r.title}`, r.keywords.join(" "), 8)
    if (sc)
      hits.push({
        kind: "recipe",
        title: r.title,
        ref: r.id,
        snippet: `recipe("${r.id}")`,
        score: sc,
      })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ------------------------------------------------------------------ scaffold

export const APP_NAME = /^[a-z0-9][a-z0-9._-]{0,213}$/

/** What `create-signet-app <name>` writes: its template, renamed and filled in, plus package.json. */
export function scaffoldFiles(
  name: string,
  template: "web" | "api",
  theme: string,
): TemplateFile[] {
  const t = INDEX.scaffold[template]
  const files = t.files.map((f) => ({
    path: f.path,
    content: f.content.replaceAll("__APP_NAME__", name).replaceAll("__THEME__", theme),
  }))
  const pkg = {
    name,
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: t.scripts,
    dependencies: t.dependencies,
    devDependencies: t.devDependencies,
  }
  files.push({ path: "package.json", content: `${JSON.stringify(pkg, null, 2)}\n` })
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export function scaffoldCommand(name: string, template: "web" | "api", theme: string): string {
  return `bunx create-signet-app ${name}${template === "api" ? " --template api" : ` --theme ${theme}`}`
}

// ------------------------------------------------------------------ migration

type Version = [number, number, number]
export const VERSION = /^\d+(?:\.\d+){0,2}$/
const parse = (v: string): Version => {
  const [a = 0, b = 0, c = 0] = v.split(".").map(Number)
  return [a, b, c]
}
const cmp = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** `server`, `signet-server` and `@dapplelight/signet-server` all name one package. */
export function packageKey(name: string): string {
  const bare = name.replace(/^@dapplelight\//, "")
  return bare === "create-signet-app" || bare.startsWith("signet-") ? bare : `signet-${bare}`
}

type Entry = { heading: string; packages: string[]; versions: Record<string, string>; body: string }

function changelogEntries(): Entry[] {
  const out: Entry[] = []
  for (const s of sections(doc("changelog") as Doc)) {
    if (s.level !== 3) continue
    const versions: Record<string, string> = {}
    for (const m of s.heading.matchAll(/(signet-[a-z]+|create-signet-app)\s+(\d+\.\d+\.\d+)/g))
      versions[m[1] as string] ??= m[2] as string
    const packages = [
      ...new Set([...s.heading.matchAll(/signet-[a-z]+|create-signet-app/g)].map((m) => m[0])),
    ]
    out.push({
      heading: s.heading,
      packages,
      versions,
      body: s.text.split("\n").slice(1).join("\n").trim(),
    })
  }
  return out
}

/** Bullets that call out a break or a migration step. */
function breaking(body: string): string[] {
  const bullets = body.split(/\n(?=- )/).map((b) => b.trim())
  return bullets.filter((b) => /\*\*Breaking|Migration:|Behaviour change/i.test(b))
}

/**
 * What changed for a package between two versions: CHANGELOG entries in
 * (from, to], unversioned (Unreleased) entries when `to` is "unreleased",
 * and any "Migrating from x.y" section in the package's README in range.
 */
export function migration(from: string, to: string, pkg?: string) {
  const key = pkg ? packageKey(pkg) : undefined
  const lo = parse(from)
  const hi = to === "unreleased" ? ([Infinity, 0, 0] as Version) : parse(to)
  const inRange = (v: string) => cmp(parse(v), lo) > 0 && cmp(parse(v), hi) <= 0
  const entries = changelogEntries().filter((e) => {
    if (key && !e.packages.includes(key)) return false
    const v = key ? e.versions[key] : Object.values(e.versions)[0]
    return v ? inRange(v) : to === "unreleased"
  })
  const notes: { title: string; ref: string; markdown: string }[] = []
  const readme = key ? doc(key.replace(/^signet-/, "")) : undefined
  for (const s of readme ? sections(readme) : []) {
    const m = /^Migrating from (\d+)\.(\d+)/.exec(s.heading)
    // "Migrating from 0.1.x" describes the move to the next minor.
    if (m && inRange(`${m[1]}.${Number(m[2]) + 1}.0`))
      notes.push({
        title: s.heading,
        ref: `signet://docs/${readme?.name}#${slug(s.heading)}`,
        markdown: section(readme as Doc, s.heading) ?? s.text,
      })
  }
  const current = Object.fromEntries(INDEX.packages.map((p) => [p.name, p.version]))
  return {
    package: key ?? "all",
    from,
    to,
    currentVersions: current,
    entries: entries.map((e) => ({
      heading: e.heading,
      version: key
        ? (e.versions[key] ?? "unreleased")
        : (Object.values(e.versions)[0] ?? "unreleased"),
      breaking: breaking(e.body),
      body: e.body,
    })),
    migrationNotes: notes,
  }
}
