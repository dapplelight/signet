/**
 * `signet check` against fixture apps written to a temp dir: one with a known
 * violation per step, a clean one, the error states, and (when Chromium is
 * installed) a page served locally for the screenshot + axe step.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const PKG = new URL("..", import.meta.url).pathname
const ROOT = join(PKG, "../..")
const CLI = join(PKG, "src/index.ts")
const TMP = mkdtempSync(join(tmpdir(), "signet-cli-check-"))

type Finding = {
  file: string | null
  line: number | null
  rule: string
  level: string
  message: string
  fix: string
}
type Report = {
  ok: boolean
  errors: number
  warnings: number
  findings: Finding[]
  passed: string[]
  screenshots: string[]
}

/** An app dir: the files, plus node_modules linked to the repo's (biome, tsc). */
function app(name: string, files: Record<string, string>, modules = join(ROOT, "node_modules")) {
  const dir = join(TMP, name)
  mkdirSync(dir, { recursive: true })
  const all = {
    "package.json": '{ "name": "fixture-app" }',
    "biome.json": '{ "formatter": { "enabled": false }, "assist": { "enabled": false } }',
    "tsconfig.json":
      '{ "compilerOptions": { "strict": true, "noEmit": true, "skipLibCheck": true, "types": [] }, "include": ["src"] }',
    ...files,
  }
  for (const [p, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), text)
  }
  symlinkSync(modules, join(dir, "node_modules"))
  return dir
}

const run = async (...args: string[]) => {
  const p = Bun.spawn(["bun", CLI, "check", ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ])
  return { code, out: out + err }
}
const json = async (...args: string[]) => {
  const r = await run(...args, "--json")
  return { ...r, report: JSON.parse(r.out) as Report }
}
const has = (r: Report, rule: string, file: string | null, line?: number) =>
  r.findings.some(
    (f) => f.rule === rule && f.file === file && (line === undefined || f.line === line),
  )

try {
  const bad = app("bad", {
    "src/shims.d.ts": `declare module "hono" { export class Hono { get(path: string, h: () => unknown): void } }
declare const process: { env: Record<string, string | undefined> }
`,
    "src/server/app.ts": `import { Hono } from "hono"
const secret = process.env.SESSION_SECRET
export const app = new Hono()
app.get("/", () => secret)
`,
    "src/types.ts": 'export const count: number = "three"\n',
    "src/legacy.ts": "export function pause() {\n  debugger\n}\n",
    "src/classes.ts":
      'export const card = "bg-red-500 text-[#ff0000]"\nexport const ok = "bg-primary"\n',
    "src/styles.css": ".card { color: #fff; }\n:root { --primary: #e11d48; }\n",
  })
  const r = await json("--cwd", bad)
  ok("known violations: exit 1", r.code === 1 && !r.report.ok, r.out)
  ok("typecheck finding has file and line", has(r.report, "typecheck", "src/types.ts", 1), r.out)
  ok(
    "lint finding names the Biome rule",
    has(r.report, "lint/suspicious/noDebugger", "src/legacy.ts", 2),
    r.out,
  )
  ok(
    "env-module-scope found at the read",
    has(r.report, "env-module-scope", "src/server/app.ts", 2),
    r.out,
  )
  ok(
    "error-handler is a warning",
    r.report.findings.some((f) => f.rule === "error-handler" && f.level === "warn"),
    r.out,
  )
  ok(
    "raw colours in a class string and in CSS",
    has(r.report, "raw-colour", "src/classes.ts", 1) &&
      has(r.report, "raw-colour", "src/styles.css", 1),
    r.out,
  )
  ok(
    "a token definition is not a raw colour",
    !has(r.report, "raw-colour", "src/styles.css", 2) &&
      !has(r.report, "raw-colour", "src/classes.ts", 2),
    r.out,
  )
  ok(
    "every finding has file, line, rule, level, message, fix",
    r.report.findings.every(
      (f) => ["file", "line", "rule", "level", "message", "fix"].every((k) => k in f) && f.fix,
    ),
    r.out,
  )
  ok(
    "counts match the findings",
    r.report.errors + r.report.warnings === r.report.findings.length && r.report.errors > 0,
    r.out,
  )

  // A function with a return type annotation is a function body, not module scope.
  const typed = app("typed", {
    "src/app.ts": `import { Hono } from "hono"
export function getKey(): string {
  return process.env.KEY ?? ""
}
export async function f(): Promise<void> {
  if (process.env.X) return
}
export const g = (): (() => void) => {
  return () => process.env.Y
}
export const app = new Hono()
`,
  })
  const t = (await import("../src/check-conventions.js")).conventions(typed)
  ok(
    "env read inside a function with a return type is not module scope",
    !t.some((f) => f.rule === "env-module-scope"),
    t,
  )

  const h = await run("--cwd", bad)
  ok(
    "human output: steps, finding lines, fix line, summary",
    h.code === 1 &&
      /\n {4}fail {2}typecheck/.test(h.out) &&
      /\n {4}fail {2}lint/.test(h.out) &&
      /\n {4}fail {2}conventions/.test(h.out) &&
      h.out.includes("    skip  conformance  (no --api)") &&
      h.out.includes("    skip  pages  (no --pages)") &&
      /\n {6}src\/server\/app\.ts:2 {2}env-module-scope {2}Reads process\.env at import time\.\n {8}fix: /.test(
        h.out,
      ) &&
      /\n {2}\d+ errors?, 1 warning in \d+ files?\.\n/.test(h.out),
    h.out,
  )

  const clean = app("clean", { "src/ok.ts": "export const n: number = 1\n" })
  const c = await run("--cwd", clean)
  ok(
    "clean app: every step passes, exit 0",
    c.code === 0 &&
      c.out.includes("    pass  typecheck") &&
      c.out.includes("    pass  lint") &&
      c.out.includes("    pass  conventions") &&
      c.out.includes("  All checks passed."),
    c.out,
  )
  const cj = await json("--cwd", clean)
  ok(
    "clean --json: ok, no findings, steps passed",
    cj.report.ok &&
      cj.report.findings.length === 0 &&
      cj.report.passed.join() === "typecheck,lint,conventions",
    cj.out,
  )

  const warn = app("warn", {
    "src/app.ts": 'import { Hono } from "hono"\nexport const app = new Hono()\n',
    "src/shims.d.ts": 'declare module "hono" { export class Hono {} }\n',
  })
  const w = await json("--cwd", warn)
  ok(
    "only warnings: exit 0",
    w.code === 0 && w.report.ok && w.report.warnings === 1 && w.report.errors === 0,
    w.out,
  )

  const none = await run("--cwd", join(TMP, "missing"))
  ok(
    "no package.json: named, exit 1",
    none.code === 1 &&
      /No package\.json in .*missing\. Run signet check from the app root\./.test(none.out),
    none.out,
  )
  const badApi = await run("--cwd", clean, "--api", "not-a-url")
  ok(
    "bad --api: the conformance message, exit 1",
    badApi.code === 1 &&
      badApi.out.includes('"not-a-url" is not a URL. Example: http://localhost:3000'),
    badApi.out,
  )
  const down = await json("--cwd", clean, "--api", "http://localhost:1")
  ok(
    "API unreachable: one conformance finding, no stack trace",
    down.code === 1 &&
      down.report.findings.length === 1 &&
      down.report.findings[0]?.rule === "conformance/unreachable" &&
      down.report.findings[0].message.includes("Could not connect to http://localhost:1") &&
      !down.out.includes("    at "),
    down.out,
  )

  const stub = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 500 }) })
  try {
    const nc = await json("--cwd", clean, "--api", `http://localhost:${stub.port}`)
    ok(
      "a non-conformant API: a finding per failed case",
      nc.code === 1 && nc.report.findings.some((f) => f.rule === "conformance/unknown-route-404"),
      nc.out,
    )
  } finally {
    stub.stop(true)
  }

  const noPw = await json("--cwd", clean, "--pages", "/dashboard")
  ok(
    "--pages without Playwright: a finding with the install fix",
    noPw.code === 1 &&
      noPw.report.findings.length === 1 &&
      noPw.report.findings[0]?.rule === "pages/playwright" &&
      noPw.report.findings[0].fix.includes("bunx playwright install chromium"),
    noPw.out,
  )

  // Pages: a real browser against a page with known axe violations.
  const modules = join(TMP, "pw-modules")
  mkdirSync(join(modules, "@playwright"), { recursive: true })
  symlinkSync(join(PKG, "../test/node_modules/@playwright/test"), join(modules, "@playwright/test"))
  symlinkSync(join(ROOT, "node_modules/axe-core"), join(modules, "axe-core"))
  const pw = app("pw", { "src/ok.ts": "export const n = 1\n" }, modules)
  const site = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        '<!doctype html><html><head><title>Projects</title></head><body><main><h1>Projects</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main></body></html>',
        { headers: { "content-type": "text/html" } },
      ),
  })
  try {
    const pr = await json(
      "--cwd",
      pw,
      "--pages",
      "/dashboard",
      "--web",
      `http://localhost:${site.port}`,
    )
    const noBrowser = pr.report.findings.find((f) => f.rule === "pages/browser")
    if (noBrowser) {
      // No Chromium here (not installed, or the sandbox blocks it): the finding names the fix.
      ok(
        "browser missing: a finding with the install fix, exit 1",
        pr.code === 1 && noBrowser.fix === "bunx playwright install chromium",
        pr.out,
      )
      console.log("  SKIP pages in a browser:", noBrowser.message)
    } else {
      const img = pr.report.findings.find((f) => f.rule === "axe/image-alt")
      ok(
        "axe violation: file is the page, rule is axe/<id>, fix is axe's help",
        img?.file === "/dashboard" && img.level === "error" && !!img.fix,
        pr.out,
      )
      ok(
        "screenshots at both viewports, relative to the app",
        pr.report.screenshots.join() ===
          ".signet/check/dashboard__mobile.png,.signet/check/dashboard__desktop.png" &&
          pr.report.screenshots.every((s) => existsSync(join(pw, s))),
        pr.out,
      )
      ok("an axe violation exits 1", pr.code === 1, pr.out)
      const ph = await run(
        "--cwd",
        pw,
        "--pages",
        "/dashboard",
        "--web",
        `http://localhost:${site.port}`,
      )
      ok(
        "human output lists the screenshots under pages",
        ph.out.includes("    fail  pages") &&
          ph.out.includes("      .signet/check/dashboard__mobile.png") &&
          ph.out.includes("      /dashboard  axe/image-alt"),
        ph.out,
      )
    }
  } finally {
    site.stop(true)
  }
  const gone = await json("--cwd", pw, "--pages", "/x", "--web", "http://localhost:1")
  if (!gone.report.findings.some((f) => f.rule === "pages/browser"))
    ok(
      "page unreachable: a finding, not a throw",
      gone.report.findings.some((f) => f.rule === "pages/unreachable"),
      gone.out,
    )
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
