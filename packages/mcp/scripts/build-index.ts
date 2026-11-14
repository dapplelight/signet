#!/usr/bin/env bun
/**
 * Build `src/generated/` from the repo, so the published server is
 * self-contained and says only what the repo says:
 *
 *   index.ts         docs, exports with signatures and JSDoc, components,
 *                    themes, contract tokens, recipes, create-signet-app templates
 *   doctor-check.ts  packages/server/src/doctor/check.ts, verbatim
 *   contrast.ts      packages/tokens/test/contrast.ts, verbatim
 *
 * The two copies are how check_app and check_theme reuse the repo's own logic
 * without the server or tokens package exporting it.
 *
 *   bun run scripts/build-index.ts           write
 *   bun run scripts/build-index.ts --check   exit 1 if anything is stale
 */

import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import type {
  ComponentInfo,
  CvaInfo,
  Doc,
  ExportPath,
  PackageInfo,
  Recipe,
  ScaffoldTemplate,
  SignetIndex,
  SymbolInfo,
  TemplateFile,
  ThemeInfo,
  TokenInfo,
} from "../src/types"

const ROOT = resolve(import.meta.dirname, "../../..")
const OUT = resolve(import.meta.dirname, "../src/generated")
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")
const rel = (abs: string) => relative(ROOT, abs)

// ---------------------------------------------------------------- packages

type Target = string | { import?: string; types?: string; default?: string }
type PkgJson = {
  name: string
  version: string
  description?: string
  private?: boolean
  exports?: Record<string, Target>
}
const pkgDirs = readdirSync(join(ROOT, "packages"))
  .filter((d) => existsSync(join(ROOT, "packages", d, "package.json")))
  .sort()
const pkgJson = (d: string) => JSON.parse(read(`packages/${d}/package.json`)) as PkgJson
const packages: PackageInfo[] = pkgDirs.map((dir) => {
  const p = pkgJson(dir)
  return {
    name: p.name,
    dir: `packages/${dir}`,
    version: p.version,
    description: p.description ?? "",
    private: p.private === true,
  }
})

// ---------------------------------------------------------------- docs

const titleOf = (text: string, fallback: string) => /^# (.+)$/m.exec(text)?.[1]?.trim() ?? fallback
const docs: Doc[] = []
const addDoc = (name: string, path: string) => {
  const text = read(path)
  docs.push({ name, path, title: titleOf(text, name), text })
}
for (const [name, path] of [
  ["signet", "README.md"],
  ["api", "API.md"],
  ["conventions", "CONVENTIONS.md"],
  ["migration", "MIGRATION.md"],
  ["changelog", "CHANGELOG.md"],
  ["contributing", "CONTRIBUTING.md"],
  ["publishing", "PUBLISHING.md"],
  ["repo-guide", "CLAUDE.md"],
] as const)
  addDoc(name, path)
// Every package README is `<dir>`; any other upper-case .md is its lower-cased
// name (CONTRACT.md -> contract). A new package's docs appear with no change here.
for (const dir of pkgDirs) {
  const files = readdirSync(join(ROOT, "packages", dir))
    .filter((f) => /^[A-Z]+\.md$/.test(f))
    .sort()
  for (const f of files) {
    const base = f === "README.md" ? dir : f.slice(0, -3).toLowerCase()
    const name = docs.some((d) => d.name === base) ? `${dir}-${base}` : base
    addDoc(name, `packages/${dir}/${f}`)
  }
}

// ---------------------------------------------------------------- source parsing

/** A module specifier relative to `from`, resolved to a source file. */
function resolveModule(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null
  const base = resolve(dirname(from), spec.replace(/\.js$/, ""))
  for (const c of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`])
    if (existsSync(c)) return c
  return null
}

const DECL_KINDS = "function\\*?|const|let|var|class|abstract\\s+class|interface|type|enum"
const declRe = (name: string) =>
  new RegExp(
    `^(?:export\\s+)?(?:declare\\s+)?(?:async\\s+)?(${DECL_KINDS})\\s+${name.replace(/\$/g, "\\$")}\\b`,
    "m",
  )

/** The JSDoc block directly above `index`, cleaned. */
function docAbove(src: string, index: number): string {
  const before = src.slice(0, index).trimEnd()
  if (!before.endsWith("*/")) return ""
  const start = before.lastIndexOf("/**")
  if (start < 0) return ""
  return before
    .slice(start + 3, -2)
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim()
}

/** Index of the closer matching the opener at `open`, skipping strings and comments. */
function matchClose(src: string, open: number): number {
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]" }
  const stack: string[] = []
  for (let i = open; i < src.length; i++) {
    const ch = src[i] as string
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === "\\") i++
      continue
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2) + 1
      continue
    }
    if (pairs[ch]) stack.push(pairs[ch])
    else if (ch === stack[stack.length - 1]) {
      stack.pop()
      if (!stack.length) return i
    }
  }
  return src.length - 1
}

/** The head of a declaration: up to its body, or the whole thing for a type. */
function signatureAt(src: string, index: number, kind: string): string {
  const rest = src.slice(index)
  const cap = (s: string) => {
    const lines = s.trim().split("\n")
    return lines.length > 40 ? `${lines.slice(0, 40).join("\n")}\n  …` : lines.join("\n")
  }
  if (kind.startsWith("function")) {
    const open = rest.indexOf("(")
    const close = matchClose(rest, open)
    const body = rest.indexOf("{", close)
    const semi = rest.indexOf("\n", close) // an overload or `declare function` ends at the line
    const end =
      body < 0 || (semi >= 0 && semi < body && !/[:<|&,]\s*$/.test(rest.slice(close, semi)))
        ? semi
        : body
    return cap(rest.slice(0, end < 0 ? undefined : end))
  }
  if (kind.includes("class")) return cap(rest.slice(0, rest.indexOf("{")))
  if (kind === "interface" || kind === "enum")
    return cap(rest.slice(0, matchClose(rest, rest.indexOf("{")) + 1))
  if (kind === "type") {
    // A type ends at the first `;` or blank-line/new-statement at depth 0.
    let depth = 0
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i]
      if (ch === "{" || ch === "(" || ch === "[" || ch === "<") depth++
      else if (
        (ch === "}" || ch === ")" || ch === "]" || (ch === ">" && rest[i - 1] !== "=")) &&
        depth > 0
      )
        depth--
      else if (
        depth === 0 &&
        (ch === ";" ||
          (ch === "\n" &&
            /^\n(?:export|const|function|type|interface|\/\*\*|\/\/|\n)/.test(rest.slice(i))))
      )
        return cap(rest.slice(0, i))
    }
    return cap(rest)
  }
  // const / let: the declared type, or an arrow function's head, or the first line.
  const eq = rest.search(/\s=\s/)
  const head = rest.slice(0, eq < 0 ? rest.indexOf("\n") : eq)
  if (eq < 0) return cap(head)
  const value = rest.slice(eq).replace(/^\s=\s/, "")
  if (/^(?:async\s*)?(?:<[^>]*>\s*)?\(/.test(value)) {
    const open = value.indexOf("(")
    const close = matchClose(value, open)
    const arrow = value.indexOf("=>", close)
    return cap(`${head} = ${value.slice(0, arrow + 2)} …`)
  }
  if (head.includes(":")) return cap(head)
  const line = value.split("\n")[0] as string
  return cap(`${head} = ${line.length > 160 ? `${line.slice(0, 160)}…` : line}`)
}

type Found = { name: string; file: string; declName: string }

/** Every symbol a module exports, following `export *` and `export { } from`. */
function moduleSymbols(file: string, depth = 0): Found[] {
  if (depth > 4 || !existsSync(file)) return []
  const src = readFileSync(file, "utf8")
  const out: Found[] = []
  for (const m of src.matchAll(
    new RegExp(`^export\\s+(?:declare\\s+)?(?:async\\s+)?(?:${DECL_KINDS})\\s+([\\w$]+)`, "gm"),
  ))
    out.push({ name: m[1] as string, file, declName: m[1] as string })
  for (const m of src.matchAll(
    /^export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/gm,
  )) {
    const target = m[2] ? resolveModule(file, m[2]) : file
    for (const raw of (m[1] as string).split(",")) {
      const part = raw.replace(/^\s*type\s+/, "").trim()
      if (!part) continue
      const [orig, alias] = part.split(/\s+as\s+/).map((s) => s.trim()) as [string, string?]
      if (!target) continue
      const inner =
        target === file ? null : moduleSymbols(target, depth + 1).find((f) => f.name === orig)
      out.push(
        inner
          ? { ...inner, name: alias ?? orig }
          : { name: alias ?? orig, file: target, declName: orig },
      )
    }
  }
  for (const m of src.matchAll(/^export\s+\*\s+from\s+["']([^"']+)["']/gm)) {
    const target = resolveModule(file, m[1] as string)
    if (target) out.push(...moduleSymbols(target, depth + 1))
  }
  const seen = new Set<string>()
  return out.filter((f) => !seen.has(f.name) && seen.add(f.name))
}

function symbolInfo(f: Found, depth = 0): SymbolInfo {
  const src = readFileSync(f.file, "utf8")
  const m = declRe(f.declName).exec(src)
  if (!m) {
    // `import { x } from "./y"` then `export { x }`: follow the import.
    for (const im of src.matchAll(
      /^import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm,
    )) {
      const hit = (im[1] as string)
        .split(",")
        .map((p) =>
          p
            .replace(/^\s*type\s+/, "")
            .trim()
            .split(/\s+as\s+/),
        )
        .find((p) => (p[1] ?? p[0]) === f.declName)
      const target = hit && resolveModule(f.file, im[2] as string)
      if (target && depth < 4)
        return {
          ...symbolInfo({ name: f.name, file: target, declName: hit[0] as string }, depth + 1),
          name: f.name,
        }
    }
    return { name: f.name, kind: "unknown", signature: "", doc: "", source: rel(f.file) }
  }
  const kind = (m[1] as string).replace(/\s+/g, " ").replace("function*", "function")
  return {
    name: f.name,
    kind,
    signature: signatureAt(src, m.index, kind),
    doc: docAbove(src, m.index),
    source: rel(f.file),
  }
}

/** First sentence of the file's leading doc comment, as gen-api.ts reads it. */
function fileSummary(file: string): string {
  const doc = readFileSync(file, "utf8").match(/^(?:#!.*\n+)?\/\*\*\s*\n([\s\S]*?)\*\//)
  if (!doc) return ""
  const text = (doc[1] as string)
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
  return (text.split(/\.\s/)[0] ?? "").slice(0, 200)
}

// ---------------------------------------------------------------- exports

const exportsIndex: ExportPath[] = []
const sourceOf = (dir: string, target: Target) => {
  const built =
    typeof target === "string" ? target : (target.import ?? target.types ?? target.default ?? "")
  const src = built.replace("./dist/", "./src/").replace(/\.d\.ts$|\.js$/, ".ts")
  for (const c of [src, src.replace(/\.ts$/, ".tsx")]) {
    const abs = join(ROOT, "packages", dir, c)
    if (existsSync(abs)) return abs
  }
  return null
}
for (const dir of pkgDirs) {
  const p = pkgJson(dir)
  for (const [sub, target] of Object.entries(p.exports ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const path = sub === "." ? p.name : `${p.name}${sub.slice(1)}`
    if (sub.endsWith(".css")) {
      exportsIndex.push({
        package: p.name,
        path,
        source:
          typeof target === "string"
            ? `packages/${dir}/${target.replace("./dist/", "src/")}`
            : null,
        summary: "stylesheet",
        symbols: [],
        stylesheet: true,
      })
      continue
    }
    const abs = sourceOf(dir, target)
    exportsIndex.push({
      package: p.name,
      path,
      source: abs ? rel(abs) : null,
      summary: !abs ? "" : abs.endsWith(".json") ? "JSON config file" : fileSummary(abs),
      symbols: abs && /\.tsx?$/.test(abs) ? moduleSymbols(abs).map((f) => symbolInfo(f)) : [],
    })
  }
}

// ---------------------------------------------------------------- contract tokens

const CONTRACT = read("packages/tokens/CONTRACT.md")
/** As tokens/test/themes.ts parses it: the variable names in each section's code blocks. */
function contractSection(from: string, to: string, kind: TokenInfo["kind"]): TokenInfo[] {
  const a = CONTRACT.indexOf(from)
  const b = CONTRACT.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`CONTRACT.md lost its "${from}" section`)
  const body = CONTRACT.slice(a, b)
  const out: TokenInfo[] = []
  for (const block of body.matchAll(/```\n([\s\S]*?)```/g)) {
    // The group is the nearest heading or "Label:" line above the block.
    const above = body.slice(0, block.index).trimEnd().split("\n").reverse()
    const label = above.find((l) => /^#{2,4} |:$/.test(l.trim())) ?? from
    const group =
      kind === "required"
        ? label
            .replace(/^#+\s*/, "")
            .replace(/:$/, "")
            .trim()
        : kind === "optional"
          ? "Optional — generic slots"
          : "Optional — domain slots (finance.css only)"
    for (const [n] of (block[1] as string).matchAll(/--[a-z0-9-]+/g))
      if (!out.some((t) => t.name === n)) out.push({ name: n, kind, group })
  }
  return out
}
const tokens = [
  ...contractSection("## Required — color", "## Optional", "required"),
  ...contractSection("## Optional", "Domain — ", "optional"),
  ...contractSection("Domain — ", "## Not part of the contract", "domain"),
]
const counted = CONTRACT.match(/\*\*(\d+) required, (\d+) optional\.\*\*/)
const contractCounts = { required: Number(counted?.[1]), optional: Number(counted?.[2]) }

/** A regex for the utility classes that resolve through a contract variable. */
function utilityRe(v: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const direct = `var\\(${esc(v)}\\)`
  const end = "(?![\\w-])"
  let util: string
  if (v.startsWith("--color-"))
    util = `(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|fill|stroke|outline|divide|from|via|to|shadow|accent|caret|placeholder|decoration)-${esc(v.slice(8))}${end}`
  else if (v === "--radius") util = `rounded${end}`
  else if (v.startsWith("--radius-")) util = `rounded(?:-[trblse]{1,2})?-${esc(v.slice(9))}${end}`
  else if (v === "--spacing")
    util = `(?:^|[\\s"'\`:])-?(?:h|w|size|gap(?:-[xy])?|p[xytrblse]?|m[xytrblse]?|space-[xy]|min-[hw]|max-[hw]|top|left|right|bottom|inset(?:-[xy])?|translate-[xy])-\\d`
  else if (v.startsWith("--font-weight-")) util = `font-${esc(v.slice(14))}${end}`
  else util = `${esc(v.slice(2))}${end}` // --text-sm -> text-sm, --shadow-md, --font-sans, --ease-out, --leading-display
  return new RegExp(`${util}|${direct}`)
}

// ---------------------------------------------------------------- components

const SHOWCASE = existsSync(join(ROOT, "apps/showcase/src/app.tsx"))
  ? read("apps/showcase/src/app.tsx")
  : ""
const pascal = (kebab: string) => kebab.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase())

/** Top-level `key: value` pairs of an object literal's body text. */
function objectEntries(body: string): [string, string][] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < body.length && body[i] !== ch; i++) if (body[i] === "\\") i++
    } else if (ch === "/" && body[i + 1] === "/") {
      while (i < body.length && body[i] !== "\n") i++
    } else if ("{([".includes(ch as string)) depth++
    else if ("})]".includes(ch as string)) depth--
    else if (ch === "," && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  const out: [string, string][] = []
  for (const p of parts) {
    const clean = p.replace(/^\s*\/\/.*$/gm, "").trim()
    const m = /^(["']?)([\w@/.-]+)\1\s*:\s*([\s\S]*)$/.exec(clean)
    if (m) out.push([m[2] as string, (m[3] as string).trim()])
  }
  return out
}
const innerOf = (text: string, key: string): string | null => {
  const m = new RegExp(`\\b${key}\\s*:\\s*\\{`).exec(text)
  if (!m) return null
  const open = m.index + m[0].length - 1
  return text.slice(open + 1, matchClose(text, open))
}

function cvaOf(src: string): CvaInfo[] {
  const out: CvaInfo[] = []
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*cva\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1
    const call = src.slice(open, matchClose(src, open) + 1)
    const variants: Record<string, string[]> = {}
    for (const [k, v] of objectEntries(innerOf(call, "variants") ?? ""))
      variants[k] = objectEntries(v.replace(/^\{|\}$/g, "")).map(([name]) => name)
    const defaults: Record<string, string> = {}
    for (const [k, v] of objectEntries(innerOf(call, "defaultVariants") ?? ""))
      defaults[k] = v.replace(/^["']|["']$/g, "")
    out.push({ name: m[1] as string, variants, defaults })
  }
  return out
}

function exampleFor(
  importPath: string,
  values: string[],
  main: string,
  props: string | undefined,
): string {
  const importLine = `import { ${values.join(", ")} } from "${importPath}"`
  // The first one-line use, else the first use.
  const oneLine = new RegExp(`^[ \\t]*<${main}[\\s>/][^\\n]*(?:/>|</${main}>)[ \\t]*$`, "m").exec(
    SHOWCASE,
  )
  if (oneLine) return `${importLine}\n\n${oneLine[0].trim()}`
  const at = SHOWCASE.search(new RegExp(`<${main}[\\s>/]`))
  if (at < 0) return `${importLine}\n\n// ${main}(${props ?? ""})\n<${main} />`
  const lines = SHOWCASE.slice(SHOWCASE.lastIndexOf("\n", at) + 1).split("\n")
  const indent = /^\s*/.exec(lines[0] as string)?.[0].length ?? 0
  const take: string[] = []
  for (const l of lines.slice(0, 16)) {
    take.push(l.slice(indent))
    if (take.length > 1 && (/^\s*$/.test(l) || (/^\s*/.exec(l)?.[0].length ?? 0) <= indent)) break
    if (take.length === 1 && new RegExp(`(/>|</${main}>)\\s*$`).test(l)) break
  }
  return `${importLine}\n\n${take.join("\n").trim()}`
}

const components: ComponentInfo[] = []
{
  const ui = pkgJson("ui")
  for (const [sub, target] of Object.entries(ui.exports ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!sub.startsWith("./components/") && !sub.startsWith("./domain/")) continue
    const abs = sourceOf("ui", target)
    if (!abs) continue
    const src = readFileSync(abs, "utf8")
    const name = sub.split("/").pop() as string
    const importPath = `${ui.name}${sub.slice(1)}`
    const found = moduleSymbols(abs)
    const exports = found.map((f) => f.name)
    const values = found
      .filter((f) => !/^(type|interface)$/.test(symbolInfo(f).kind))
      .map((f) => f.name)
    const props: Record<string, string> = {}
    for (const e of values.filter((x) => /^[A-Z]/.test(x))) {
      const m = new RegExp(`function\\s+${e}\\s*(?:<[^(]*>)?\\(`).exec(src)
      if (!m) continue
      const open = m.index + m[0].length - 1
      props[e] = src
        .slice(open + 1, matchClose(src, open))
        .replace(/\s+/g, " ")
        .trim()
    }
    const propTypes = [...src.matchAll(/^(?:export\s+)?(interface|type)\s+\w*Props\b/gm)].map((m) =>
      signatureAt(src, m.index ?? 0, m[1] as string),
    )
    const main = values.includes(pascal(name))
      ? pascal(name)
      : (values.find((e) => /^[A-Z]/.test(e) && props[e] !== undefined) ?? pascal(name))
    components.push({
      name,
      importPath,
      source: rel(abs),
      exports,
      props,
      propTypes,
      cva: cvaOf(src),
      tokens: tokens.filter((t) => utilityRe(t.name).test(src)).map((t) => t.name),
      example: exampleFor(importPath, values, main, props[main]),
      domain: sub.startsWith("./domain/"),
    })
  }
}

// ---------------------------------------------------------------- themes

const themes: ThemeInfo[] = []
{
  const t = pkgJson("tokens")
  const readme = read("packages/tokens/README.md")
  for (const [sub, target] of Object.entries(t.exports ?? {})) {
    if (sub === "./base.css" || typeof target !== "string") continue
    const name = sub.slice(2, -4)
    const file = `packages/tokens/${target.replace("./dist/", "src/")}`
    const css = read(file)
    const description =
      new RegExp(`\\|\\s*\`${name}\\.css\`\\s*\\|\\s*([^|]+)\\|`).exec(readme)?.[1]?.trim() ?? ""
    const overlay = /@import\s+["']\.\/([\w-]+)\.css["']/.exec(css)?.[1] ?? null
    themes.push({
      name,
      file,
      importPath: `${t.name}${sub.slice(1)}`,
      description,
      overlayOf: overlay,
      css,
    })
  }
}

// ---------------------------------------------------------------- recipes

/** A section of a doc: its heading line to the next heading of the same or higher level. */
function section(docName: string, heading: string, shallow = false): string {
  const doc = docs.find((d) => d.name === docName)
  if (!doc) throw new Error(`recipe: no doc "${docName}"`)
  const lines = doc.text.split("\n")
  if (heading === "") {
    // The intro: after the title, before the first ##.
    const start = lines.findIndex((l) => l.startsWith("# ")) + 1
    const end = lines.findIndex((l, i) => i >= start && l.startsWith("## "))
    return lines
      .slice(start, end < 0 ? undefined : end)
      .join("\n")
      .trim()
  }
  const start = lines.findIndex((l) => /^#{2,4} /.test(l) && l.replace(/^#+\s*/, "") === heading)
  if (start < 0) throw new Error(`recipe: "${docName}" has no heading "${heading}"`)
  const level = /^#+/.exec(lines[start] as string)?.[0].length ?? 2
  let inFence = false
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if ((lines[i] as string).startsWith("```")) inFence = !inFence
    const h = inFence ? null : /^(#+) /.exec(lines[i] as string)
    if (h && (shallow || (h[1] as string).length <= level)) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join("\n").trim()
}

type Ref = [doc: string, heading: string, shallow?: boolean]
type RecipeSpec = Omit<Recipe, "steps"> & { refs: Ref[] }
// Authored here: which doc sections make up each job, and how to check it.
// The steps themselves are the docs' own text and code, so they cannot drift.
const RECIPES: RecipeSpec[] = [
  {
    id: "add-auth",
    title: "Add authentication (passcode gate, sessions, Better Auth)",
    keywords: ["auth", "login", "session", "passcode", "better-auth", "sign in", "user"],
    install: ["@dapplelight/signet-server", "hono"],
    refs: [
      ["server", "Modules"],
      ["server", "Passcode gate"],
      ["server", "User system"],
      ["server", 'CSRF: turn it on with `sameSite: "none"`'],
    ],
    verify: [
      "check_app: CSRF is wired before cookie-reading routes",
      "bun run test && bun run typecheck",
    ],
  },
  {
    id: "add-rate-limit",
    title: "Add rate limiting (memory, Durable Object, Upstash)",
    keywords: ["rate limit", "ratelimit", "throttle", "429", "durable object", "abuse"],
    install: ["@dapplelight/signet-server", "hono"],
    refs: [
      ["server", "Middleware", true],
      ["server", "Rate limiting has a pluggable store, on purpose"],
    ],
    verify: [
      "check_app (runs signet-doctor's Durable Object checks)",
      "npx signet-doctor in the Worker's directory",
    ],
  },
  {
    id: "add-csrf",
    title: "Add CSRF protection",
    keywords: ["csrf", "cross-site", "origin", "samesite", "cookie"],
    install: ["@dapplelight/signet-server", "hono"],
    refs: [
      ["server", "Middleware", true],
      ["server", 'CSRF: turn it on with `sameSite: "none"`'],
    ],
    verify: ["check_app: csrf finding is gone"],
  },
  {
    id: "add-error-envelope",
    title: "Add the error envelope and request validation",
    keywords: ["error", "envelope", "validation", "parseBody", "errorHandler", "zod", "400", "500"],
    install: ["@dapplelight/signet-server", "@dapplelight/signet-lib", "hono", "zod"],
    refs: [
      ["server", "HTTP — error envelope and validation"],
      ["lib", "The contract"],
    ],
    verify: ["check_app: errorHandler is wired with onError"],
  },
  {
    id: "add-env",
    title: "Add Workers-safe env configuration",
    keywords: ["env", "environment", "config", "secrets", "process.env", "wrangler vars"],
    install: ["@dapplelight/signet-server", "zod"],
    refs: [["server", "Env — Workers-safe configuration"]],
    verify: ["check_app: no env read at module scope; env schema matches wrangler vars"],
  },
  {
    id: "add-api-client",
    title: "Add the typed API client (and TanStack Query)",
    keywords: ["api client", "fetch", "client", "tanstack query", "react query", "frontend"],
    install: ["@dapplelight/signet-lib"],
    refs: [
      ["lib", "Use"],
      ["lib", "The contract"],
    ],
    verify: ["bun run typecheck"],
  },
  {
    id: "add-web-push",
    title: "Add web push and other notifications",
    keywords: ["push", "web push", "notification", "vapid", "email", "telegram", "notify"],
    install: ["@dapplelight/signet-server"],
    refs: [["server", "Notifications and reporting"]],
    verify: ["bun run test"],
  },
  {
    id: "add-ai-extraction",
    title: "Add AI extraction with a budget",
    keywords: [
      "ai",
      "llm",
      "extract",
      "extraction",
      "budget",
      "structured output",
      "model",
      "classifier",
    ],
    install: ["@dapplelight/signet-ai", "zod", "ai"],
    refs: [
      ["ai", ""],
      ["ai", "Budgets across isolates"],
      ["ai", "Testing without network or spend"],
      ["ai", "Errors"],
    ],
    verify: ["test with the fake provider (no network, no spend)"],
  },
  {
    id: "add-analytics",
    title: "Add analytics (Cloudflare Web Analytics or Analytics Engine)",
    keywords: ["analytics", "events", "tracking", "pageview", "analytics engine", "beacon"],
    install: ["@dapplelight/signet-lib", "@dapplelight/signet-server"],
    refs: [
      ["analytics", "Tier 1 — invite, gift and marketing sites"],
      ["analytics", "Tier 2 — products wanting custom events"],
      ["analytics", "Things that bite"],
    ],
    verify: ["check_app: the ingest route is rate limited"],
  },
  {
    id: "add-portability-adapters",
    title: "Run off Cloudflare: KV, queue, blob and defer adapters",
    keywords: [
      "portability",
      "adapter",
      "node",
      "bun",
      "docker",
      "upstash",
      "supabase",
      "kv",
      "queue",
      "blob",
      "r2",
    ],
    install: ["@dapplelight/signet-server"],
    refs: [["server", "Portability adapters"]],
    verify: ["bun run test"],
  },
  {
    id: "add-mcp-tools",
    title: "Add MCP tools to an app",
    keywords: ["mcp", "tools", "model context protocol", "agent", "defineTool", "stdio"],
    install: ["@dapplelight/signet-server", "@modelcontextprotocol/server", "zod"],
    refs: [
      ["server", "MCP servers", true],
      ["server", "stdio"],
      ["server", "Errors"],
      ["server", "zod: one copy, 4.2 or later"],
    ],
    verify: ["call tools/list from an MCP client; bun run test"],
  },
  {
    id: "add-oauth",
    title: "Protect an API or MCP endpoint with OAuth 2.1 (resource server)",
    keywords: ["oauth", "token", "jwt", "jwks", "bearer", "scope", "resource server"],
    install: ["@dapplelight/signet-server", "hono"],
    refs: [["server", "OAuth 2.1 resource server"]],
    verify: ["bun run test"],
  },
  {
    id: "add-logging",
    title: "Add structured logging and Sentry",
    keywords: ["log", "logging", "logger", "sentry", "observability", "errors"],
    install: ["@dapplelight/signet-server"],
    refs: [["server", "Logging", true]],
    verify: ["bun run test"],
  },
  {
    id: "add-theme",
    title: "Make a theme",
    keywords: ["theme", "tokens", "css variables", "design", "colors", "dark mode"],
    install: ["@dapplelight/signet-tokens"],
    refs: [
      ["tokens", "Make your own theme"],
      ["contributing", "Add a theme"],
      ["contract", "Required — color"],
    ],
    verify: ["check_theme with the theme's CSS"],
  },
]
const recipes: Recipe[] = RECIPES.map(({ refs, ...r }) => ({
  ...r,
  steps: refs.map(([doc, heading, shallow]) => ({
    title: heading || (docs.find((d) => d.name === doc)?.title ?? doc),
    source: `signet://docs/${doc}`,
    markdown: section(doc, heading, shallow),
  })),
}))

// ---------------------------------------------------------------- scaffold

const CSA = read("packages/create-signet-app/src/index.ts")
function objectConst(name: string): Record<string, string> {
  const m = new RegExp(`const ${name} = \\{`).exec(CSA)
  if (!m) throw new Error(`create-signet-app lost ${name}`)
  const open = m.index + m[0].length - 1
  return Object.fromEntries(
    objectEntries(CSA.slice(open + 1, matchClose(CSA, open))).map(([k, v]) => [
      k,
      v.replace(/^"|"$/g, ""),
    ]),
  )
}
function scripts(kind: "api" | "web"): Record<string, string> {
  const m = /scripts:\s*template === "api"\s*\?\s*\{/.exec(CSA)
  if (!m) throw new Error("create-signet-app lost its scripts")
  const apiOpen = m.index + m[0].length - 1
  const apiClose = matchClose(CSA, apiOpen)
  const webOpen = CSA.indexOf("{", apiClose + 1)
  const [open, close] = kind === "api" ? [apiOpen, apiClose] : [webOpen, matchClose(CSA, webOpen)]
  return Object.fromEntries(
    objectEntries(CSA.slice(open + 1, close)).map(([k, v]) => [k, v.replace(/^"|"$/g, "")]),
  )
}
/** What create-signet-app copies: the tracked template files, renamed as it renames them. */
function templateFiles(dir: string): TemplateFile[] {
  const files = execFileSync("git", ["ls-files", dir], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
  return files.sort().map((f) => ({
    path: f
      .slice(dir.length + 1)
      .replace(/^_gitignore$/, ".gitignore")
      .replace(/^_dockerignore$/, ".dockerignore")
      .replace(/^_github\//, ".github/"),
    content: read(f),
  }))
}
const themeNames = /const THEMES = \[([^\]]*)\]/.exec(CSA)?.[1]?.match(/[\w-]+/g) ?? []
const scaffold: SignetIndex["scaffold"] = {
  themes: themeNames,
  web: {
    files: templateFiles("packages/create-signet-app/template"),
    scripts: scripts("web"),
    dependencies: objectConst("DEPS"),
    devDependencies: objectConst("DEV_DEPS"),
  } satisfies ScaffoldTemplate,
  api: {
    files: templateFiles("packages/create-signet-app/template-api"),
    scripts: scripts("api"),
    dependencies: objectConst("API_DEPS"),
    devDependencies: objectConst("API_DEV_DEPS"),
  } satisfies ScaffoldTemplate,
}

// ---------------------------------------------------------------- write

const index: SignetIndex = {
  packages,
  docs,
  exports: exportsIndex,
  components,
  themes,
  tokens,
  contractCounts,
  recipes,
  scaffold,
}
const banner =
  "// Generated by scripts/build-index.ts from the repo. Do not edit; run `bun run gen`.\n"
const outputs: [string, string][] = [
  [
    "index.ts",
    `${banner}import type { SignetIndex } from "../types.js"\n\nexport const INDEX: SignetIndex = ${JSON.stringify(index, null, 1)}\n`,
  ],
  ["doctor-check.ts", `${banner}${read("packages/server/src/doctor/check.ts")}`],
  ["contrast.ts", `${banner}${read("packages/tokens/test/contrast.ts")}`],
]

const check = process.argv.includes("--check")
let stale = 0
for (const [file, text] of outputs) {
  const path = join(OUT, file)
  const current = existsSync(path) ? readFileSync(path, "utf8") : ""
  if (current === text) continue
  if (check) {
    stale++
    console.log(`  STALE src/generated/${file}`)
  } else writeFileSync(path, text)
}
if (check) {
  console.log(
    stale
      ? `\n${stale} stale; run \`bun run gen\` in packages/mcp.`
      : "  PASS generated index is current",
  )
  process.exit(stale ? 1 : 0)
}
console.log(
  `index: ${docs.length} docs, ${exportsIndex.length} export paths, ${components.length} components, ${themes.length} themes, ${tokens.length} tokens, ${recipes.length} recipes`,
)
