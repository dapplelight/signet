// one-off, not committed: add imports to docs blocks
import { INDEX } from "./packages/mcp/src/generated/index.ts"
import { checkSnippets } from "./scripts/check-snippets.ts"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const only = process.argv[2]
const cands = new Map<string, { path: string; kind: string }[]>()
for (const e of INDEX.exports as any[])
  for (const s of e.symbols) {
    if (!cands.has(s.name)) cands.set(s.name, [])
    cands.get(s.name)!.push({ path: e.path, kind: s.kind })
  }

const REACT = "useState useEffect useRef useMemo useCallback useId useTransition useContext useReducer".split(" ")
const EXT: Record<string, string> = {
  z: "zod",
  Hono: "hono",
  betterAuth: "better-auth",
  drizzleAdapter: "better-auth/adapters/drizzle",
  eq: "drizzle-orm",
  desc: "drizzle-orm",
  sql: "drizzle-orm",
  sqliteTable: "drizzle-orm/sqlite-core",
  BarChart: "recharts", Bar: "recharts", XAxis: "recharts", CartesianGrid: "recharts",
  LineChart: "recharts", Line: "recharts", AreaChart: "recharts", Area: "recharts",
  join: "node:path", homedir: "node:os",
}
for (const r of REACT) EXT[r] = "react"
const DENY = new Set("request source id initials requestId app db env store payments user data page".split(" "))

function resolve(name: string, page: string): string | null {
  if (EXT[name]) return EXT[name]
  if (/^[A-Z]\w*Icon$/.test(name)) return "lucide-react"
  if (DENY.has(name)) return null
  let c = cands.get(name)
  if (!c) return null
  if (c.length > 1) c = c.filter((x) => x.path !== "@dapplelight/signet-ui" && x.path !== "@dapplelight/signet-ai")
  if (c.length > 1) {
    const nt = c.filter((x) => x.kind !== "type" && x.kind !== "interface")
    if (nt.length) c = nt
  }
  if (c.length > 1) {
    const hint = c.filter((x) => page.includes(`"${x.path}"`))
    if (hint.length === 1) c = hint
  }
  if (c.length > 1 && /^[A-Z]/.test(name)) {
    const ui = c.filter((x) => x.path.includes("signet-ui/"))
    if (ui.length === 1) c = ui
  }
  return c.length === 1 ? c[0].path : null
}

type B = { open: number; close: number; indent: string; lang: string; title: string | null }
function scan(lines: string[]): B[] {
  const out: B[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)(.*)$/.exec(lines[i])
    if (!m) continue
    let end = i + 1
    const close = new RegExp(`^\\s*${m[2][0]}{${m[2].length},}\\s*$`)
    while (end < lines.length && !close.test(lines[end])) end++
    out.push({ open: i, close: end, indent: m[1], lang: m[3], title: /\btitle="([^"]*)"/.exec(m[4])?.[1] ?? null })
    i = end
  }
  return out
}
const isTs = (b: B) => b.lang === "ts" || b.lang === "tsx"

function afterImports(lines: string[]): number {
  let i = 0
  let inImport = false
  for (; i < lines.length; i++) {
    const l = lines[i]
    if (inImport) inImport = !/\bfrom\s+["'][^"']+["']\s*;?\s*$/.test(l)
    else if (/^import\b/.test(l)) inImport = !/(?:\bfrom\s+)?["'][^"']+["']\s*;?\s*$/.test(l)
    else if (l.trim() && !/^\s*(\/\/|\/?\*)/.test(l)) break
  }
  return i
}
const hasImport = (body: string[]) => body.some((l) => /^import\b/.test(l))
const fmt = (names: string[], mod: string) => {
  const one = `import { ${names.join(", ")} } from "${mod}"`
  return one.length <= 100 ? [one] : ["import {", ...names.map((n) => `  ${n},`), `} from "${mod}"`]
}

function mergeImportOnly(lines: string[]): string[] {
  for (;;) {
    const bs = scan(lines).filter(isTs)
    let did = false
    for (let k = 0; k + 1 < bs.length; k++) {
      const a = bs[k]
      const b = bs[k + 1]
      if (a.title || b.title || a.indent !== b.indent) continue
      const abody = lines.slice(a.open + 1, a.close)
      const bbody = lines.slice(b.open + 1, b.close)
      if (afterImports(abody) < abody.length || !hasImport(abody) || hasImport(bbody)) continue
      if (lines.slice(a.close + 1, b.open).some((l) => l.trim())) continue
      // a's imports go on top of b, a's fences and the gap go away
      const merged = [...abody, "", ...bbody]
      lines.splice(a.open, b.close + 1 - a.open, lines[b.open], ...merged.map((l) => (l ? a.indent + l : l)), lines[b.close])
      did = true
      break
    }
    if (!did) return lines
  }
}

function addImports(body: string[], need: Map<string, string[]>): string[] {
  let end = afterImports(body)
  // keep blank/comment lines that trail the imports out of the import region
  while (end > 0 && !/^\s*import\b|from\s+["']/.test(body[end - 1]) && !/["']\s*;?$/.test(body[end - 1])) end--
  let head = body.slice(0, end)
  const rest = body.slice(end)
  for (const [mod, names] of need) {
    const re = new RegExp(`import\\s+\\{([^}]*)\\}\\s+from\\s+"${mod.replace(/[/.]/g, "\\$&")}"`)
    const text = head.join("\n")
    const m = re.exec(text)
    if (m) {
      const have = m[1].split(",").map((s) => s.trim()).filter(Boolean)
      const all = [...new Set([...have, ...names])].sort((a, b) => a.localeCompare(b))
      head = text.replace(re, fmt(all, mod).join("\n")).split("\n")
    } else {
      head.push(...fmt([...names].sort((a, b) => a.localeCompare(b)), mod))
    }
  }
  // order: new statements stay after the originals
  while (head.length && head[head.length - 1].trim() === "") head.pop()
  const first = rest.findIndex((l) => l.trim())
  return [...head, "", ...rest.slice(first < 0 ? rest.length : first)]
}

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* files(p)
    else if (e.name.endsWith(".mdx")) yield p
  }
}

const root = join(import.meta.dirname, "apps/docs/content/docs")
const left = new Map<string, string[]>()
for (const f of files(root)) {
  if (only && !f.includes(only)) continue
  const orig = readFileSync(f, "utf8")
  let lines = orig.split("\n")
  lines = mergeImportOnly(lines)
  const problems = checkSnippets([{ file: f, src: lines.join("\n") }])
    .map((p) => ({ line: p.line, name: /^(\S+) is used/.exec(p.message)?.[1] }))
    .filter((p): p is { line: number; name: string } => !!p.name)
  const bs = scan(lines).filter(isTs)
  for (const b of bs.reverse()) {
    const names = [...new Set(problems.filter((p) => p.line > b.open + 1 - 1 && p.line <= b.close).map((p) => p.name))]
    if (!names.length) continue
    const need = new Map<string, string[]>()
    for (const n of names) {
      const mod = resolve(n, lines.join("\n"))
      if (!mod) {
        left.set(f, [...(left.get(f) ?? []), n])
        continue
      }
      need.set(mod, [...(need.get(mod) ?? []), n])
    }
    if (!need.size) continue
    const body = lines.slice(b.open + 1, b.close).map((l) => (l.startsWith(b.indent) ? l.slice(b.indent.length) : l.trimStart()))
    const next = addImports(body, need).map((l) => (l ? b.indent + l : l))
    lines.splice(b.open + 1, b.close - b.open - 1, ...next)
  }
  const out = lines.join("\n")
  if (out !== orig) writeFileSync(f, out)
}
let n = 0
for (const [f, names] of left) {
  n += names.length
}
console.log("unresolved name uses:", n, "in", left.size, "files")
