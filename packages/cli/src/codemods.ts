/**
 * Versioned migrations for the app's own code, run by `signet upgrade`.
 *
 * Each codemod is keyed by a Signet package and the first version that needs
 * it. It runs once the app has that version installed (node_modules, else the
 * range in package.json), and signet.json records it so it never runs twice.
 *
 * Source is read with the TypeScript scanner from the app's own node_modules
 * (`typescript/unstable/ast/scanner` on 7, `createScanner` on 5 and 6), so
 * strings, comments and templates never look like code. Without TypeScript
 * the codemods are reported, not run.
 */

import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

export type CodemodEdit = { path: string; before: string; after: string }
export type CodemodResult = {
  id: string
  title: string
  edits: CodemodEdit[]
  /** Call sites to look at by hand, as `file:line: what to do`. */
  notes: string[]
}

type Tok = { text: string; start: number; end: number }
type Source = { path: string; text: string; toks: Tok[] }
type App = { root: string; sources: Source[] }
type Codemod = {
  id: string
  pkg: string
  /** The first version of `pkg` that needs this. */
  since: string
  title: string
  run(app: App): { edits: CodemodEdit[]; notes: string[] }
}

const lineOf = (s: Source, pos: number) => s.text.slice(0, pos).split("\n").length
const at = (s: Source, i: number) => `${s.path}:${lineOf(s, s.toks[i]?.start ?? 0)}`

/** Index of the token that closes the bracket at `i`. */
function closing(toks: Tok[], i: number): number {
  let depth = 0
  for (let j = i; j < toks.length; j++) {
    const t = toks[j]?.text
    if (t === "(" || t === "{" || t === "[") depth++
    else if (t === ")" || t === "}" || t === "]") if (--depth === 0) return j
  }
  return toks.length - 1
}

/** An edit replacing tokens a..b (inclusive) with `text`. */
const span = (s: Source, a: number, b: number, text: string): [number, number, string] => [
  s.toks[a]?.start ?? 0,
  s.toks[b]?.end ?? 0,
  text,
]

/** Edits as [start, end, text], applied back to front. */
function apply(text: string, edits: [number, number, string][]): string {
  let out = text
  for (const [s, e, t] of edits.sort((a, b) => b[0] - a[0]))
    out = out.slice(0, s) + t + out.slice(e)
  return out
}

/** Calls of `name(` that are not a declaration, with the index of the `(`. */
function* calls(s: Source, name: string): Generator<[number, number]> {
  for (let i = 0; i < s.toks.length; i++)
    if (
      s.toks[i]?.text === name &&
      s.toks[i + 1]?.text === "(" &&
      s.toks[i - 1]?.text !== "function"
    )
      yield [i, i + 1]
}

/** `name:` or shorthand `name` at the top level of the object literal opened at `open`. */
function property(toks: Tok[], open: number, close: number, name: string): number {
  let depth = 0
  for (let j = open; j < close; j++) {
    const t = toks[j]?.text
    if (t === "(" || t === "{" || t === "[") depth++
    else if (t === ")" || t === "}" || t === "]") depth--
    else if (depth === 1 && t === name && /^[{,]$/.test(toks[j - 1]?.text ?? "")) return j
  }
  return -1
}

/** The last token of the property value that starts at `from`, before a top-level `,` or `}`. */
function valueEnd(toks: Tok[], from: number, close: number): number {
  let depth = 0
  for (let j = from; j < close; j++) {
    const t = toks[j]?.text
    if (t === "(" || t === "{" || t === "[") depth++
    else if (t === ")" || t === "}" || t === "]") depth--
    else if (depth === 0 && t === ",") return j - 1
  }
  return close - 1
}

function versionOf(root: string, pkg: string): string | undefined {
  const installed = join(root, "node_modules", pkg, "package.json")
  if (existsSync(installed)) return JSON.parse(readFileSync(installed, "utf8")).version
  const app = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const range = app.dependencies?.[pkg] ?? app.devDependencies?.[pkg]
  return range ? /\d+(\.\d+){0,2}/.exec(range)?.[0] : undefined
}

const atLeast = (v: string, min: string) => {
  const a = v.split(".").map(Number)
  const b = min.split(".").map(Number)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}

export const CODEMODS: Codemod[] = [
  {
    id: "signet-ai@0.4.0/generate-text-output",
    pkg: "@dapplelight/signet-ai",
    since: "0.4.0",
    title: "AI SDK 7: generateObject becomes generateText with output: Output.object({ schema })",
    run(app) {
      const edits: CodemodEdit[] = []
      const notes: string[] = []
      for (const s of app.sources) {
        // Only files that import generateObject from "ai": an app function of that name is left alone.
        const imp = s.toks.findIndex(
          (t, i) =>
            t.text === "import" &&
            s.toks[i + 1]?.text === "{" &&
            /^["']ai["']$/.test(s.toks[closing(s.toks, i + 1) + 2]?.text ?? ""),
        )
        if (imp < 0) continue
        const impClose = closing(s.toks, imp + 1)
        const named = s.toks.slice(imp + 2, impClose).map((t) => t.text)
        const g = s.toks.findIndex((t, i) => i > imp && i < impClose && t.text === "generateObject")
        if (g < 0) continue
        const out: [number, number, string][] = []
        if (s.toks[g + 1]?.text === "as") {
          notes.push(
            `${at(s, g)}: generateObject is imported under another name; rewrite it by hand`,
          )
          continue
        }
        const want = ["generateText", "Output"].filter((n) => !named.includes(n))
        if (want.length) out.push(span(s, g, g, want.join(", ")))
        else {
          const comma = s.toks[g + 1]?.text === "," ? g + 1 : g
          out.push(span(s, g, comma, ""))
        }

        for (const [i, paren] of calls(s, "generateObject")) {
          if (i < impClose) continue
          const open = paren + 1
          if (s.toks[open]?.text !== "{") {
            notes.push(
              `${at(s, i)}: generateObject options are not an object literal; rewrite by hand`,
            )
            continue
          }
          const close = closing(s.toks, open)
          const k = property(s.toks, open, close, "schema")
          if (k < 0 || property(s.toks, open, close, "output") >= 0) {
            notes.push(
              `${at(s, i)}: no schema property (or one named output already); rewrite by hand`,
            )
            continue
          }
          for (const extra of ["schemaName", "schemaDescription", "mode"])
            if (property(s.toks, open, close, extra) >= 0)
              notes.push(`${at(s, i)}: check ${extra}, which Output.object does not take as is`)
          out.push(span(s, i, i, "generateText"))
          if (s.toks[k + 1]?.text === ":") {
            const end = valueEnd(s.toks, k + 2, close)
            const value = s.text.slice(s.toks[k + 2]?.start, s.toks[end]?.end)
            out.push(span(s, k, end, `output: Output.object({ schema: ${value} })`))
          } else out.push(span(s, k, k, "output: Output.object({ schema })"))

          // The result: `const r = await ...` reads r.object; `const { object } = ...` destructures it.
          let j = i - 1
          if (s.toks[j]?.text === "await") j--
          const before = s.toks[j - 1]
          if (s.toks[j]?.text === "=" && before && /^[A-Za-z_$][\w$]*$/.test(before.text)) {
            for (let m = close; m < s.toks.length - 2; m++)
              if (
                s.toks[m]?.text === before.text &&
                s.toks[m + 1]?.text === "." &&
                s.toks[m + 2]?.text === "object"
              )
                out.push(span(s, m + 2, m + 2, "output"))
          } else if (s.toks[j]?.text === "=" && before?.text === "}") {
            let o = j - 1
            for (let d = 0; o >= 0; o--) {
              const t = s.toks[o]?.text
              if (t === "}") d++
              else if (t === "{" && --d === 0) break
            }
            const p = property(s.toks, o, j - 1, "object")
            if (p < 0) notes.push(`${at(s, i)}: read result.output instead of result.object`)
            else if (s.toks[p + 1]?.text === ":") out.push(span(s, p, p, "output"))
            else out.push(span(s, p, p, "output: object"))
          } else notes.push(`${at(s, i)}: read result.output instead of result.object`)
        }
        edits.push({ path: s.path, before: s.text, after: apply(s.text, out) })
      }

      // The new call shape needs AI SDK 7.
      const pj = join(app.root, "package.json")
      const before = readFileSync(pj, "utf8")
      const pkg = JSON.parse(before)
      let bumped = false
      for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        const r = pkg[field]?.ai
        const major = Number(/\d+/.exec(r ?? "")?.[0] ?? 99)
        if (r && major < 7) {
          pkg[field].ai = "^7.0.0"
          bumped = true
        }
      }
      if (bumped)
        edits.push({ path: "package.json", before, after: `${JSON.stringify(pkg, null, 2)}\n` })
      return { edits, notes }
    },
  },
  {
    id: "signet-db@0.1.0/set-plan-precedence",
    pkg: "@dapplelight/signet-db",
    since: "0.1.0",
    title: "signet-db: setPlan no longer overrides a live subscription on a later plan",
    run(app) {
      const notes: string[] = []
      for (const s of app.sources)
        for (const [i] of calls(s, "setPlan"))
          if (s.toks[i - 1]?.text === ".")
            notes.push(
              `${at(s, i)}: setPlan sets the manual plan only; a live subscription on a later plan still wins`,
            )
      return { edits: [], notes }
    },
  },
  {
    // The first signet-server release after 0.4.0 carries the change.
    id: "signet-server@0.4.1/ingest-user-id",
    pkg: "@dapplelight/signet-server",
    since: "0.4.1",
    title: "Analytics: registerIngest drops a client-sent userId",
    run(app) {
      const notes: string[] = []
      for (const s of app.sources)
        for (const [i, paren] of calls(s, "registerIngest")) {
          const args = s.toks.slice(paren, closing(s.toks, paren)).map((t) => t.text)
          if (args.includes("userId") || args.includes("trustClientUserId")) continue
          notes.push(
            `${at(s, i)}: TODO a client-sent userId is now dropped; pass a userId resolver (the signed-in user) or trustClientUserId: true`,
          )
        }
      return { edits: [], notes }
    },
  },
]

type Scanner = {
  scan(): number
  getTokenStart(): number
  getTokenEnd(): number
  getTokenText(): string
  reScanTemplateToken(tagged: boolean): number
  reScanSlashToken(): number
}

/** A tokenizer over the app's own TypeScript, or undefined when it has none. */
async function loadTokenizer(root: string): Promise<((text: string) => Tok[]) | undefined> {
  const req = createRequire(join(root, "package.json"))
  let make: ((text: string) => Scanner) | undefined
  try {
    const { createScanner } = await import(req.resolve("typescript/unstable/ast/scanner"))
    make = (text) => createScanner(true, 0, text)
  } catch {
    try {
      const ts = req("typescript")
      if (typeof ts.createScanner === "function")
        make = (text) => ts.createScanner(ts.ScriptTarget.Latest, true, 0, text)
    } catch {}
  }
  if (!make) return undefined
  const scanner = make
  return (text) => {
    const s = scanner(text)
    const toks: Tok[] = []
    const stack: ("{" | "${")[] = []
    // After these a `/` starts a regular expression, not a division.
    const regexAfter = /^(|[(,=:[!&|?{};+\-*%<>~^]|=>|return|typeof|case|in|of)$/
    for (let n = 0; n < 1e6; n++) {
      s.scan()
      const start = s.getTokenStart()
      if (start >= text.length) break
      let t = s.getTokenText()
      if (t === "}" && stack.at(-1) === "${") {
        s.reScanTemplateToken(false)
        t = s.getTokenText()
        if (t.endsWith("`")) stack.pop()
      } else if ((t === "/" || t === "/=") && regexAfter.test(toks.at(-1)?.text ?? "")) {
        s.reScanSlashToken()
        t = s.getTokenText()
      } else if (t === "{") stack.push("{")
      else if (t === "}") stack.pop()
      else if (t.startsWith("`") && t.endsWith("${")) stack.push("${")
      toks.push({ text: t, start, end: s.getTokenEnd() })
    }
    return toks
  }
}

function sourcesOf(root: string, tokenize: (text: string) => Tok[]): Source[] {
  const glob = new Bun.Glob("src/**/*.{ts,tsx,mts,cts,js,jsx}")
  return [...glob.scanSync({ cwd: root })]
    .filter((p) => !p.includes("node_modules") && !p.endsWith(".d.ts"))
    .sort()
    .map((path) => {
      const text = readFileSync(join(root, path), "utf8")
      return { path, text, toks: tokenize(text) }
    })
}

export type CodemodRun = {
  results: CodemodResult[]
  /** Due codemods that could not run, and why. */
  skipped?: { ids: string[]; reason: string }
}

/** Run every codemod the app's installed versions call for that `done` does not list. */
export async function runCodemods(root: string, done: string[]): Promise<CodemodRun> {
  if (!existsSync(join(root, "package.json"))) return { results: [] }
  const due = CODEMODS.filter((m) => {
    if (done.includes(m.id)) return false
    const v = versionOf(root, m.pkg)
    return v !== undefined && atLeast(v, m.since)
  })
  if (!due.length) return { results: [] }
  const tokenize = await loadTokenizer(root)
  if (!tokenize)
    return {
      results: [],
      skipped: {
        ids: due.map((m) => m.id),
        reason:
          "typescript is not in the app's node_modules; add it as a dev dependency and run signet upgrade again",
      },
    }
  const app = { root, sources: sourcesOf(root, tokenize) }
  return {
    results: due.map((m) => {
      const r = m.run(app)
      return {
        id: m.id,
        title: m.title,
        edits: r.edits.filter((e) => e.before !== e.after),
        notes: r.notes,
      }
    }),
  }
}
