#!/usr/bin/env bun
/**
 * Fails when a ts/tsx block in the docs uses a name it never imports or defines,
 * so every copy button copies something that runs.
 *
 *   bun run scripts/check-snippets.ts
 *
 * Each block is compiled alone with tsc (no module resolution, so imports are
 * `any`) and only "Cannot find name" is kept. A block that carries the same
 * title="..." as an earlier block on the same page continues it: the earlier
 * blocks are compiled in front of it. An untitled block cannot be a continuation.
 *
 * Bare JSX is allowed as the end of a block (`<A /><B />`, or statements and then
 * JSX): a block that does not parse is retried with the JSX wrapped in a fragment.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"

export type Problem = { file: string; line: number; message: string }
export type Source = { file: string; src: string }
type Block = { title: string | null; ext: "ts" | "tsx"; lines: string[]; start: number }

/** Names the runtime provides that tsc's default libs do not (Workers, Node), and the JSX namespace. */
const GLOBALS = new Set(
  `process Buffer require module exports __dirname __filename JSX
D1Database D1PreparedStatement D1Result KVNamespace R2Bucket R2Object R2ObjectBody Queue MessageBatch
DurableObject DurableObjectState DurableObjectNamespace DurableObjectStub ExecutionContext ExportedHandler
ScheduledController ScheduledEvent Fetcher Hyperdrive Ai WebSocketPair HTMLRewriter caches`.split(
    /\s+/,
  ),
)

/** tsc reports `import "node:fs"` without @types/node as "Cannot find name 'node:fs'". Those are imports, not free names. */
const BUILTIN_MODULES = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]))

/** Every ts/tsx fence in an MDX file: its title, dedented code and the file line of its first code line. */
export function extractBlocks(src: string): Block[] {
  const blocks: Block[] = []
  const lines = src.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)(.*)$/.exec(lines[i])
    if (!open) continue
    const [, indent, fence, lang, rest] = open
    let end = i + 1
    const close = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`)
    while (end < lines.length && !close.test(lines[end])) end++
    if (lang === "ts" || lang === "tsx") {
      const body = lines
        .slice(i + 1, end)
        .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()))
      blocks.push({
        title: /\btitle="([^"]*)"/.exec(rest)?.[1] ?? null,
        ext: lang,
        lines: body,
        start: i + 2,
      })
    }
    i = end
  }
  return blocks
}

/** Index of the first line after the leading imports, blank lines and comments. */
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

/** Same line count, so line numbers hold. Variant 0 is the block as written. */
function variant(lines: string[], v: number): string[] {
  if (v === 0) return lines
  const from = afterImports(lines)
  // 1: statements (maybe none), then JSX starting at an unindented tag. 2: the whole body is JSX.
  const at = v === 2 ? from : lines.findIndex((l, i) => i >= from && /^<[A-Za-z]/.test(l))
  if (at < 0 || at >= lines.length) return lines
  const out = [...lines]
  out[at] = `;(<>${out[at]}`
  out[out.length - 1] += "</>)"
  return out
}
const VARIANTS = 3

/** Syntax errors withhold every type error, so they are told apart: parse codes and "one parent element". */
const isSyntax = (code: number) => code < 2000 || (code >= 17000 && code < 18000) || code === 2657

const MESSAGE = (name: string) =>
  `${name} is used but never imported or defined. Import it in this block, or give the block the same title= as the block it continues.`

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/**
 * tsconfig `paths` that send every `@dapplelight/signet-*` import to the workspace source
 * (exports point at dist/, which CI has not built yet), so a name or subpath that does not exist fails.
 */
function workspacePaths(): Record<string, string[]> {
  // mcp's src/generated/ is gitignored and only written by its `gen` script.
  if (!existsSync(join(ROOT, "packages/mcp/src/generated/index.ts")))
    Bun.spawnSync(["bun", "run", "gen"], {
      cwd: join(ROOT, "packages/mcp"),
      stdout: "inherit",
      stderr: "inherit",
    })
  const paths: Record<string, string[]> = {}
  for (const d of readdirSync(join(ROOT, "packages"))) {
    let pkg: { name?: string; exports?: Record<string, unknown> }
    try {
      pkg = JSON.parse(readFileSync(join(ROOT, "packages", d, "package.json"), "utf8"))
    } catch {
      continue
    }
    for (const [sub, target] of Object.entries(pkg.exports ?? {})) {
      const t = typeof target === "string" ? target : (target as { import?: string }).import
      if (!pkg.name || !t) continue
      if (!t.startsWith("./dist/")) {
        paths[pkg.name + sub.slice(1)] = [join(ROOT, "packages", d, t)] // json, css: as is
        continue
      }
      const stem = join(ROOT, "packages", d, t.replace("./dist/", "src/")).replace(/\.js$/, "")
      const file = [".ts", ".tsx"].map((e) => stem + e).find((f) => existsSync(f))
      if (file) paths[pkg.name + sub.slice(1)] = [file]
    }
  }
  return paths
}

function tsc(dir: string, files: Map<string, string>) {
  for (const f of readdirSync(dir)) if (f !== "tsconfig.json") rmSync(join(dir, f))
  for (const [name, text] of files) writeFileSync(join(dir, name), text)
  const bin = new URL("../node_modules/.bin/tsc", import.meta.url).pathname
  const run = Bun.spawnSync([bin, "-p", dir, "--pretty", "false"])
  if (run.exitCode === null || run.stderr.length) throw new Error(`tsc did not run: ${run.stderr}`)
  const errors: { file: string; row: number; code: number; text: string }[] = []
  for (const m of run.stdout
    .toString()
    .matchAll(/^(?:\S*\/)?(b\d+\.tsx?)\((\d+),\d+\): error TS(\d+): (.*)$/gm))
    errors.push({ file: m[1], row: Number(m[2]), code: Number(m[3]), text: m[4] })
  return errors
}

export function checkSnippets(files: Source[]): Problem[] {
  const dir = mkdtempSync(join(tmpdir(), "snippets-"))
  try {
    const config = (paths?: Record<string, string[]>) =>
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "esnext",
            module: "esnext",
            moduleResolution: "bundler",
            jsx: "preserve",
            lib: ["esnext", "dom", "dom.iterable"],
            types: [],
            noEmit: true,
            skipLibCheck: true,
            paths,
          },
          include: ["*.ts", "*.tsx"],
        }),
      )
    config() // phase 1 only parses, so it skips loading the workspace
    // export {} makes each file a module, so blocks never share globals.
    const text = (lines: string[]) => `${lines.join("\n")}\nexport {}\n`
    const pages = files.map((f) => ({ file: f.file, blocks: extractBlocks(f.src) }))
    const all = pages.flatMap((p) => p.blocks.map((b) => ({ file: p.file, b })))

    // Phase 1: give every block a variant that parses; one that never does is a problem.
    const chosen = all.map(() => -1)
    const parseError = new Map<number, Problem>()
    for (let v = 0; v < VARIANTS; v++) {
      const todo = all.flatMap((_, i) => (chosen[i] < 0 ? [i] : []))
      if (!todo.length) break
      const written = new Map(
        todo.map((i) => [`b${i}.${all[i].b.ext}`, text(variant(all[i].b.lines, v))]),
      )
      const bad = new Map<number, Problem>()
      for (const e of tsc(dir, written)) {
        const i = Number(/\d+/.exec(e.file)?.[0])
        if (isSyntax(e.code) && !bad.has(i))
          bad.set(i, {
            file: all[i].file,
            line: all[i].b.start + e.row - 1,
            message: `Block does not parse (TS${e.code} ${e.text}). Fix the syntax so its imports can be checked.`,
          })
      }
      for (const i of todo) {
        if (bad.has(i)) parseError.set(i, bad.get(i)!)
        else chosen[i] = v
      }
    }

    const problems: Problem[] = []
    // Phase 2: one module per block: earlier same-title blocks first, then the block itself.
    const jobs: { file: string; first: number; map: number[]; name: string }[] = []
    const out = new Map<string, string>()
    let i = 0
    for (const p of pages) {
      const first = i
      i += p.blocks.length
      const normal = p.blocks.map((b, n) =>
        chosen[first + n] < 0 ? null : variant(b.lines, chosen[first + n]),
      )
      p.blocks.forEach((b, n) => {
        if (!normal[n]) {
          problems.push(parseError.get(first + n)!)
          return
        }
        const chain = b.title
          ? [...p.blocks.keys()]
              .filter((o) => o < n && p.blocks[o].title === b.title && normal[o])
              .concat(n)
          : [n]
        const map: number[] = []
        const code: string[] = []
        for (const c of chain)
          for (const [r, l] of normal[c]!.entries()) {
            code.push(l)
            map.push(p.blocks[c].start + r)
          }
        const name = `b${jobs.length}.${chain.some((c) => p.blocks[c].ext === "tsx") ? "tsx" : "ts"}`
        out.set(name, text(code))
        jobs.push({ file: p.file, first: map.length - b.lines.length, map, name })
      })
    }
    config(workspacePaths())
    const seen = new Set<string>()
    for (const e of tsc(dir, out)) {
      const job = jobs.find((j) => j.name === e.file)
      if (!job || e.row - 1 < job.first) continue
      const add = (key: string, message: string) => {
        if (seen.has(`${e.file} ${key}`)) return
        seen.add(`${e.file} ${key}`)
        problems.push({ file: job.file, line: job.map[e.row - 1], message })
      }
      // Imports from our own packages are resolved: the path and every name must exist.
      const missing = /^Module '"[^"]*"' has no exported member '([^']+)'/.exec(e.text)?.[1]
      const mod = /^Cannot find module '(@dapplelight\/[^']+)'/.exec(e.text)?.[1]
      const asValue = /^'([^']+)' only refers to a type, but is being used as a value/.exec(
        e.text,
      )?.[1]
      if (missing) {
        const from = /\bfrom\s+["']([^"']+)["']/.exec(
          out
            .get(e.file)!
            .split("\n")
            .slice(e.row - 1)
            .join("\n"),
        )?.[1]
        add(
          `m ${missing}`,
          `${missing} is imported from "${from}" but that module does not export it. Import a name it exports (see API.md) or define it in the block.`,
        )
      } else if (mod) {
        add(`p ${mod}`, `"${mod}" is not an import path of any Signet package. See API.md.`)
      } else if (asValue) {
        add(
          `v ${asValue}`,
          `${asValue} is only a type, but the block uses it as a value. Import a runtime export or define it in the block.`,
        )
      }
      const id =
        /^(?:Cannot find (?:name|namespace)|No value exists in scope for the shorthand property) '([^']+)'/.exec(
          e.text,
        )?.[1]
      if (id && !GLOBALS.has(id) && !BUILTIN_MODULES.has(id)) add(`n ${id}`, MESSAGE(id))
    }
    return problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function* mdxFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* mdxFiles(p)
    else if (e.name.endsWith(".mdx")) yield p
  }
}

if (import.meta.main) {
  // With file arguments, only those pages are checked.
  const root = new URL("../apps/docs/content/docs", import.meta.url).pathname
  const args = process.argv.slice(2)
  const files = (args.length ? args : [...mdxFiles(root)]).map((f) => ({
    file: f,
    src: readFileSync(f, "utf8"),
  }))
  const problems = checkSnippets(files)
  for (const p of problems)
    console.error(`${p.file.slice(p.file.indexOf("apps/docs"))}:${p.line}: ${p.message}`)
  if (problems.length) {
    console.error(
      `\n${problems.length} snippet problem(s). Every ts/tsx block must show its imports.`,
    )
    process.exit(1)
  }
  console.log("snippets ok")
}
