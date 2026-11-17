#!/usr/bin/env bun
/**
 * Fails on prose that MDX parses as JSX or an expression and then breaks the
 * docs build or the rendered page: "<reason>", "<$0.01", a bare {total}.
 *
 *   bun run scripts/check-mdx.ts
 *
 * Skips frontmatter, fenced code and inline code. Real JSX (balanced tags such
 * as <Callout>...</Callout>) passes. The fix is always to wrap the text in
 * backticks, or escape the character with a backslash.
 *
 * ponytail: tag balance by name only, not a real parser. If a case slips
 * through, run @mdx-js/mdx compile() per file instead.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type Problem = { line: number; message: string }

// Real ESM statement openers only, so prose like "export the usage with <reason>" is still checked.
const ESM_START =
  /^import(?:\s+type)?\s*(?:[{*"']|[\w$]+\s*(?:,|\s+from\b))|^export\s*[{*]|^export\s+(?:const|let|var|function|async|class|default|type|interface|enum)\b/

/** Blank out text that MDX does not parse, keeping every newline so line numbers hold. */
function mask(src: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ")
  let fence: { ch: string; len: number } | null = null
  const lines = src.split("\n")
  let inFront = lines[0] === "---"
  let esm = 0
  const out = lines.map((line, i) => {
    if (inFront) {
      if (i > 0 && line === "---") inFront = false
      return blank(line)
    }
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && !m[2].trim()) fence = null
      return blank(line)
    }
    if (m) {
      fence = { ch: m[1][0], len: m[1].length }
      return blank(line)
    }
    // ESM: `import { A } from "x"` / `export const x = ...`, possibly over several lines.
    if (esm > 0 || ESM_START.test(line)) {
      // Braces inside string literals do not open or close a block.
      const code = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "")
      esm = Math.max(0, esm + (code.match(/\{/g)?.length ?? 0) - (code.match(/\}/g)?.length ?? 0))
      return blank(line)
    }
    return line
  })
  return out.join("\n").replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, blank)
}

// A complete tag: name (empty = fragment), attributes that may hold quoted strings or {...}, optional self-close.
const TAG = /<(\/?)([A-Za-z_$][\w.:$-]*)?((?:"[^"]*"|'[^']*'|\{[^}]*\}|[^<>"'{])*?)(\/?)>/y

export function checkMdx(src: string): Problem[] {
  const text = mask(src)
  const problems: Problem[] = []
  const lineAt = (i: number) => text.slice(0, i).split("\n").length
  const add = (i: number, message: string) => problems.push({ line: lineAt(i), message })
  const stack: { name: string; at: number }[] = []

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== "<" && c !== "{") continue
    if (text[i - 1] === "\\") continue
    if (c === "{") {
      // A comment, or braces holding exactly one string literal, is valid MDX.
      if (/^\{\s*(?:\/\*|"(?:[^"\\\n]|\\.)*"\s*\}|'(?:[^'\\\n]|\\.)*'\s*\})/.test(text.slice(i)))
        continue
      const m = /^\{[^}\n]*\}?/.exec(text.slice(i))
      add(i, `bare \`${m?.[0]}\` is parsed as a JS expression. Wrap it in backticks: \`${m?.[0]}\``)
      continue
    }
    if (/\s/.test(text[i + 1] ?? " ")) continue // "a < b" is plain text
    TAG.lastIndex = i
    const m = TAG.exec(text)
    if (!m) {
      const bad = /^<[^\s]*/.exec(text.slice(i))?.[0]
      add(i, `\`${bad}\` is not a valid JSX tag. Wrap it in backticks: \`${bad}\``)
      continue
    }
    const [whole, close, name = "", , selfClose] = m
    i += whole.length - 1
    if (selfClose) continue
    if (!close) {
      stack.push({ name, at: m.index })
      continue
    }
    const open = stack.map((s) => s.name).lastIndexOf(name)
    if (open < 0) {
      add(m.index, `closing \`${whole}\` has no opening tag. Wrap it in backticks: \`${whole}\``)
      continue
    }
    for (const s of stack.splice(open).slice(1))
      add(s.at, `\`<${s.name}>\` is never closed. Wrap it in backticks: \`<${s.name}>\``)
  }
  for (const s of stack)
    add(s.at, `\`<${s.name}>\` is never closed. Wrap it in backticks: \`<${s.name}>\``)
  return problems.sort((a, b) => a.line - b.line)
}

function* mdxFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* mdxFiles(p)
    else if (e.name.endsWith(".mdx")) yield p
  }
}

if (import.meta.main) {
  const root = new URL("../apps/docs/content/docs", import.meta.url).pathname
  let bad = 0
  for (const f of mdxFiles(root)) {
    for (const p of checkMdx(readFileSync(f, "utf8"))) {
      bad++
      console.error(`${f.slice(f.indexOf("apps/docs"))}:${p.line}: ${p.message}`)
    }
  }
  if (bad) {
    console.error(
      `\n${bad} MDX problem(s). MDX reads < and { in prose as code; put them in backticks.`,
    )
    process.exit(1)
  }
  console.log("mdx prose ok")
}
