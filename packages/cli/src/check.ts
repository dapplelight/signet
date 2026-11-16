/**
 * signet check: the verify loop for agent-written code. Typecheck, Biome,
 * Signet's conventions, then (when asked) the conformance suite against a
 * running API and screenshots + axe for pages. One finding list, exit 1 on
 * any error. Every tool failure is a finding, never a throw.
 */

import { existsSync, realpathSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { conventions, type Finding, sourceFiles } from "./check-conventions.js"
import { checkPages } from "./check-pages.js"
import { FLAGS } from "./conformance.js"
import { SignetCliError } from "./core.js"

const USAGE =
  "Usage: signet check [--api <url>] [--pages <path...>] [--web <url>] [--json] [--cwd <path>]"
const DEFAULT_WEB = "http://localhost:5173"

type Step = { name: string; status: "pass" | "fail" | "skip"; reason: string; findings: Finding[] }

export type CheckReport = {
  ok: boolean
  errors: number
  warnings: number
  findings: Finding[]
  passed: string[]
  screenshots: string[]
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const count = (fs: Finding[]) => {
  const errors = fs.filter((f) => f.level === "error").length
  return { errors, warnings: fs.length - errors }
}
const tally = (fs: Finding[]) => {
  const c = count(fs)
  return [c.errors && plural(c.errors, "error"), c.warnings && plural(c.warnings, "warning")]
    .filter(Boolean)
    .join(", ")
}

/** `node_modules/.bin/<name>` in the app or any folder above it (a workspace root). */
function findBin(root: string, name: string): string | null {
  for (let dir = root; ; dir = dirname(dir)) {
    const p = join(dir, "node_modules/.bin", name)
    if (existsSync(p)) return p
    if (dirname(dir) === dir) return null
  }
}

async function run(cmd: string[], cwd: string) {
  const p = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  })
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ])
  return { out, err, code }
}

const toolFailed = (rule: string, tool: string, text: string, fix: string): Finding => ({
  file: null,
  line: null,
  rule,
  level: "error",
  message: `${tool} failed: ${text.trim().split("\n")[0] || "no output"}`,
  fix,
})

async function typecheck(root: string): Promise<Step> {
  const name = "typecheck"
  if (!existsSync(join(root, "tsconfig.json")))
    return { name, status: "skip", reason: "(no tsconfig.json)", findings: [] }
  const tsc = findBin(root, "tsc")
  const findings: Finding[] = []
  if (!tsc) findings.push(toolFailed(name, "tsc", "not installed", "bun add -d typescript"))
  else {
    const r = await run([tsc, "--noEmit", "--pretty", "false"], root)
    for (const m of `${r.out}\n${r.err}`.matchAll(/^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/gm))
      findings.push({
        file: m[1] as string,
        line: Number(m[2]),
        rule: name,
        level: "error",
        message: `${m[3]}: ${m[4]}`,
        fix: "Fix the type error; `tsc --noEmit` shows it in full.",
      })
    if (r.code !== 0 && !findings.length)
      findings.push(
        toolFailed(name, "tsc", r.out || r.err, "Run `tsc --noEmit` and fix what it prints."),
      )
  }
  return finish(name, findings)
}

async function lint(root: string): Promise<Step> {
  const name = "lint"
  const biome = findBin(root, "biome")
  if (!biome) return { name, status: "skip", reason: "(biome not installed)", findings: [] }
  const r = await run([biome, "check", "--reporter=github"], root)
  const findings: Finding[] = []
  for (const m of `${r.out}\n${r.err}`.matchAll(
    /^::(error|warning|notice) title=([^,]*),file=([^,]*),line=(\d+)[^\n]*?::(.*)$/gm,
  )) {
    const rule = m[2] as string
    const docs = /^lint\//.test(rule)
      ? `; rule docs: https://biomejs.dev/linter/rules/${(rule.split("/").pop() ?? "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
      : ""
    findings.push({
      file: relative(realpathSync(root), realpathSync(resolve(root, m[3] as string))),
      line: Number(m[4]),
      rule,
      level: m[1] === "error" ? "error" : "warn",
      message: m[5] as string,
      fix: `Run \`biome check --write\` for the safe fixes${docs}`,
    })
  }
  if (r.code !== 0 && !findings.some((f) => f.level === "error"))
    findings.push(
      toolFailed(name, "biome", r.err || r.out, "Run `biome check` and fix what it prints."),
    )
  return finish(name, findings)
}

function finish(name: string, findings: Finding[]): Step {
  const c = count(findings)
  return {
    name,
    status: c.errors ? "fail" : "pass",
    reason: findings.length ? `(${tally(findings)})` : "",
    findings,
  }
}

async function conformanceStep(
  api: string | undefined,
  opts: Record<string, string>,
): Promise<Step> {
  const name = "conformance"
  if (!api) return { name, status: "skip", reason: "(no --api)", findings: [] }
  const unreachable = (e: unknown): Step =>
    finish(name, [
      {
        file: api,
        line: null,
        rule: "conformance/unreachable",
        level: "error",
        message: `Could not connect to ${api}${e instanceof Error && e.message ? ` (${e.message.split("\n")[0]})` : ""}.`,
        fix: "Start the API, then pass its address with --api.",
      },
    ])
  try {
    await fetch(api, { signal: AbortSignal.timeout(5000) })
  } catch (e) {
    return unreachable(e)
  }
  try {
    const { runConformance } = await import("@dapplelight/signet-spec/conformance")
    const report = await runConformance({
      baseUrl: api,
      authPrefix: opts.authPrefix ?? "/api/auth",
      ingestPath: opts.ingestPath ?? "/api/analytics",
      sessionsPrefix: opts.sessionsPrefix,
      jsonPath: opts.jsonPath,
    })
    const step = finish(
      name,
      report.results
        .filter((r) => !r.ok)
        .map((r) => ({
          file: api,
          line: null,
          rule: `conformance/${r.id}`,
          level: "error" as const,
          message: r.reason,
          fix: `Make the API satisfy the case: https://signet.dapplelight.in/docs/packages/spec/conformance (${r.id}).`,
        })),
    )
    if (!step.findings.length) step.reason = `(${plural(report.passed, "case")})`
    return step
  } catch (e) {
    return unreachable(e)
  }
}

async function pagesStep(
  root: string,
  pages: string[],
  web: string,
): Promise<Step & { screenshots: string[] }> {
  const name = "pages"
  if (!pages.length)
    return { name, status: "skip", reason: "(no --pages)", findings: [], screenshots: [] }
  const r = await checkPages(root, pages, web)
  const step = finish(name, r.findings)
  if (!r.findings.length)
    step.reason = `(${plural(pages.length, "page")}, ${plural(r.screenshots.length, "screenshot")})`
  return { ...step, screenshots: r.screenshots }
}

export function formatReport(steps: Step[], screenshots: string[], findings: Finding[]): string {
  const lines: string[] = []
  for (const s of steps) {
    lines.push(`    ${s.status}  ${s.name}${s.reason ? `  ${s.reason}` : ""}`)
    for (const f of s.findings) {
      const at = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "(app)"
      lines.push(`      ${at}  ${f.rule}  ${f.message}`, `        fix: ${f.fix}`)
    }
    if (s.name === "pages") for (const p of screenshots) lines.push(`      ${p}`)
  }
  const files = new Set(findings.map((f) => f.file).filter(Boolean)).size
  const summary = findings.length
    ? `${tally(findings)} in ${plural(files, "file")}.`
    : "All checks passed."
  return `\n${lines.join("\n")}\n\n  ${summary}\n`
}

export async function check(args: string[]): Promise<number> {
  const opts: Record<string, string> = {}
  let json = false
  let api: string | undefined
  let web = DEFAULT_WEB
  let cwd = process.cwd()
  const pages: string[] = []
  const value = (i: number, flag: string) => {
    const v = args[i]
    if (v === undefined) throw new SignetCliError(`${flag} needs a value.`)
    return v
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    const key = FLAGS[a]
    if (a === "--json") json = true
    else if (a === "--cwd") cwd = resolve(value(++i, a))
    else if (a === "--api") api = value(++i, a)
    else if (a === "--web") web = value(++i, a)
    else if (a === "--pages") {
      value(i + 1, a)
      while (args[i + 1] !== undefined && !(args[i + 1] as string).startsWith("-"))
        pages.push(args[++i] as string)
    } else if (key) opts[key] = value(++i, a)
    else throw new SignetCliError(a.startsWith("-") ? `Unknown option "${a}".` : USAGE)
  }
  for (const u of [api, ...(pages.length ? [web] : [])])
    if (u !== undefined)
      try {
        new URL(u)
      } catch {
        throw new SignetCliError(`"${u}" is not a URL. Example: http://localhost:3000`)
      }
  if (!existsSync(join(cwd, "package.json")))
    throw new SignetCliError(`No package.json in ${cwd}. Run signet check from the app root.`)

  const steps: Step[] = [await typecheck(cwd), await lint(cwd)]
  try {
    steps.push(finish("conventions", conventions(cwd)))
    const n = sourceFiles(cwd).length
    const s = steps[2] as Step
    if (!s.findings.length) s.reason = `(${plural(n, "file")})`
  } catch (e) {
    steps.push(
      finish("conventions", [
        toolFailed(
          "conventions",
          "The convention scan",
          String(e),
          "Report this with the file it names.",
        ),
      ]),
    )
  }
  steps.push(await conformanceStep(api, opts))
  const pagesRun = await pagesStep(cwd, pages, web)
  steps.push(pagesRun)

  const findings = steps.flatMap((s) => s.findings)
  const c = count(findings)
  const report: CheckReport = {
    ok: c.errors === 0,
    errors: c.errors,
    warnings: c.warnings,
    findings,
    passed: steps.filter((s) => s.status === "pass" && !s.findings.length).map((s) => s.name),
    screenshots: pagesRun.screenshots,
  }
  console.log(json ? JSON.stringify(report) : formatReport(steps, pagesRun.screenshots, findings))
  return report.ok ? 0 : 1
}
