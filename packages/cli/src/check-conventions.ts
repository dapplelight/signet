/**
 * The convention checks of `signet check`, over an app's source files. Rule
 * ids are the ones the MCP `check_app` tool uses (env-module-scope,
 * error-handler); raw-colour is new here.
 * ponytail: the env scan is a brace heuristic copied from packages/mcp/src/checks.ts
 * (an IIFE at module scope is missed); move both to one package when the CLI is published.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type Finding = {
  file: string | null
  line: number | null
  rule: string
  level: "error" | "warn"
  message: string
  fix: string
}

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|css)$/
const SKIP_DIR = new Set(["node_modules", "dist", "build", ".git", ".signet", ".next", "coverage"])
const isTest = (p: string) => /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[jt]sx?$/.test(p)
const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length

/** Source files under `root` (relative paths, `/`-separated), no tests, no build output. */
export function sourceFiles(root: string, dir = ""): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) out.push(...sourceFiles(root, rel))
    } else if (SOURCE.test(e.name) && !isTest(rel)) out.push(rel)
  }
  return out.sort()
}

/** Blank out strings and comments, keeping offsets, so braces and names can be scanned. */
function code(src: string, keepStrings = false): string {
  return src.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g,
    (m) => (keepStrings && m[0] !== "/" ? m : m.replace(/[^\n]/g, " ")),
  )
}

/** Offsets of `process.env` / `Bun.env` reads that run when the module loads. */
function moduleScopeEnvReads(src: string): number[] {
  const c = code(src)
  const hits: number[] = []
  const stack: boolean[] = []
  let fnDepth = 0
  for (let i = 0; i < c.length; i++) {
    const ch = c[i]
    if (ch === "{") {
      const before = c.slice(Math.max(0, i - 200), i).trimEnd()
      // `) {`, `=> {`, `else {`, or `): ReturnType {` (the return type may hold `=>` but no `;={}`)
      const fn =
        before.endsWith(")") ||
        before.endsWith("=>") ||
        /\b(?:else|try|finally|do)$/.test(before) ||
        /\)\s*:\s*(?:[^;={}]|=>)+$/.test(before)
      stack.push(fn)
      if (fn) fnDepth++
    } else if (ch === "}") {
      if (stack.pop()) fnDepth--
    } else if (fnDepth === 0 && (c.startsWith("process.env", i) || c.startsWith("Bun.env", i))) {
      const lineStart = c.lastIndexOf("\n", i) + 1
      const prevLine = c.slice(c.lastIndexOf("\n", lineStart - 2) + 1, lineStart).trimEnd()
      if (!c.slice(lineStart, i).includes("=>") && !prevLine.endsWith("=>")) hits.push(i)
    }
  }
  return hits
}

// Tailwind's stock colour scales, as utilities: bg-red-500, text-slate-900/50, ...
const STOCK =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone"
const RAW_COLOUR = new RegExp(
  `#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\\b|\\b(?:rgba?|hsla?|oklch|oklab)\\(|\\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|decoration|shadow|accent|caret)-(?:${STOCK})-\\d{2,3}\\b`,
  "g",
)

/** Raw colours in components. A CSS custom property line (`--primary: #e11d48`) is a token definition, so it is skipped. */
function rawColours(src: string, css: boolean): number[] {
  const c = code(src, true)
  const hits: number[] = []
  for (const m of c.matchAll(RAW_COLOUR)) {
    const at = m.index ?? 0
    const line = c.slice(c.lastIndexOf("\n", at) + 1, at)
    if (css && /--[\w-]+\s*:/.test(line)) continue
    if (!css && /^\s*(?:import|export)\b.*\bfrom\b/.test(line)) continue
    if (!hits.length || lineOf(c, hits[hits.length - 1] as number) !== lineOf(c, at)) hits.push(at) // one finding per line
  }
  return hits
}

export function conventions(root: string, paths = sourceFiles(root)): Finding[] {
  const findings: Finding[] = []
  const texts = new Map(paths.map((p) => [p, readFileSync(join(root, p), "utf8")]))
  const script = paths.filter((p) => !p.endsWith(".css"))
  const allCode = script.map((p) => code(texts.get(p) ?? "", true)).join("\n")

  for (const p of script) {
    const src = texts.get(p) ?? ""
    const server = /from\s+["'](?:hono|@dapplelight\/signet-server[^"']*)["']/.test(src)
    // A Bun or Node entry runs with its env already loaded; that is where module-scope reads belong.
    const processEntry =
      /Bun\.serve\(|@hono\/node-server|from\s+["']node:http["']|\/\/\/\s*<reference types="bun"\s*\/>/.test(
        src,
      )
    if (!server || processEntry) continue
    for (const at of moduleScopeEnvReads(src))
      findings.push({
        file: p,
        line: lineOf(src, at),
        rule: "env-module-scope",
        level: "error",
        message: "Reads process.env at import time.",
        fix: "Declare the key in the createEnv schema (@dapplelight/signet-server/env) and read `env.KEY` inside the handler, after initRuntimeEnv(c.env).",
      })
  }

  if (/new\s+Hono\b/.test(allCode) && !/errorHandler\s*\(/.test(allCode))
    findings.push({
      file: null,
      line: null,
      rule: "error-handler",
      level: "warn",
      message:
        "No errorHandler: errors will not be the Signet envelope, and 500s may leak their message.",
      fix: 'app.onError(errorHandler({ isProduction }))   // from "@dapplelight/signet-server/http"',
    })

  for (const p of paths) {
    const src = texts.get(p) ?? ""
    for (const at of rawColours(src, p.endsWith(".css")))
      findings.push({
        file: p,
        line: lineOf(src, at),
        rule: "raw-colour",
        level: "error",
        message: "Uses a raw colour instead of a theme token.",
        fix: "Use a token utility (bg-primary, text-muted-foreground, border-border) or var(--primary); define new colours as tokens in your theme CSS.",
      })
  }
  return findings
}
