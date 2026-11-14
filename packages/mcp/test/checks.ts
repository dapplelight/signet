// check_theme, check_app and scaffold_files against the repo's real files.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { checkApp, checkTheme } from "../src/checks"
import { migration, scaffoldFiles, search } from "../src/content"
import { INDEX } from "../src/generated/index"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c
    ? (pass++, console.log("  PASS", n))
    : (fail++, console.log("  FAIL", n, typeof d === "string" ? d : JSON.stringify(d, null, 1)))
}
const ROOT = new URL("../../..", import.meta.url).pathname
const theme = (n: string) => readFileSync(`${ROOT}packages/tokens/src/themes/${n}.css`, "utf8")
const has = (r: ReturnType<typeof checkApp>, check: string, level = "error") =>
  r.findings.some((f) => f.check === check && f.level === level)

// --- index sanity -----------------------------------------------------------
ok(
  "contract: index has the counts CONTRACT.md states",
  INDEX.tokens.filter((t) => t.kind === "required").length === INDEX.contractCounts.required &&
    INDEX.tokens.filter((t) => t.kind !== "required").length === INDEX.contractCounts.optional,
  INDEX.contractCounts,
)
ok(
  "every package has a README doc",
  INDEX.packages.every((p) => INDEX.docs.some((d) => d.path === `${p.dir}/README.md`)),
)
ok(
  "every non-css export has symbols with signatures",
  INDEX.exports
    .filter((e) => /\.tsx?$/.test(e.source ?? ""))
    .every((e) => e.symbols.length && e.symbols.every((s) => s.signature)),
  INDEX.exports
    .filter((e) => /\.tsx?$/.test(e.source ?? "") && !e.symbols.every((s) => s.signature))
    .map((e) => e.path),
)

// --- check_theme ------------------------------------------------------------
for (const t of ["editorial", "cinematic"]) {
  const r = checkTheme(theme(t))
  ok(`check_theme: ${t} passes`, r.ok && r.contrast.checked > 20, r.findings)
}
const editorial = theme("editorial")
const noRing = checkTheme(editorial.replace(/^\s*--color-ring:.*$/m, ""))
ok(
  "check_theme: a missing required variable is named",
  noRing.findings.some(
    (f) => f.check === "contract.required" && f.message.includes("--color-ring"),
  ),
  noRing.findings,
)
const pale = checkTheme(
  editorial.replace(/(:root\s*\{[\s\S]*?--text-primary:)[^;]+;/, "$1 #dddddd;"),
)
ok(
  "check_theme: low contrast fails with the ratio",
  pale.findings.some(
    (f) => f.check === "contrast" && f.message.startsWith("light: --text-primary on --bg-base"),
  ),
  pale.findings,
)
const stock = checkTheme(
  editorial.replace("@theme inline {", "@theme inline {\n  --color-red-500: #ff0000;"),
)
ok(
  "check_theme: repainting stock red fails",
  stock.findings.some((f) => f.check === "contract.stock-palette"),
)
const sourced = checkTheme(`${editorial}\n@source "../../ui/src";`)
ok(
  "check_theme: @source in a theme fails",
  sourced.findings.some((f) => f.check === "contract.no-source"),
)
const empty = checkTheme(":root { --bg-base: #fff; }")
ok(
  "check_theme: an empty theme misses all required vars",
  empty.findings.some((f) => f.message.startsWith(`Missing ${INDEX.contractCounts.required} of`)),
)

// --- check_app --------------------------------------------------------------
const files = (list: { path: string; content: string }[]) =>
  Object.fromEntries(list.map((f) => [f.path, f.content]))
const api = files(scaffoldFiles("my-api", "api", "editorial"))
const web = files(scaffoldFiles("my-app", "web", "cinematic"))
const clean = checkApp(api)
ok("check_app: the api template is clean", clean.ok && clean.warnings === 0, clean.findings)
for (const c of [
  "env-module-scope",
  "rate-limit",
  "rate-limit-do",
  "csrf",
  "error-handler",
  "env-schema",
])
  ok(`check_app: api template ran ${c}`, clean.passed.includes(c), clean.passed)
const webResult = checkApp(web)
ok(
  "check_app: the web template is clean",
  webResult.ok && webResult.warnings === 0,
  webResult.findings,
)
ok("check_app: web template ran tailwind-source", webResult.passed.includes("tailwind-source"))

const with_ = (base: Record<string, string>, path: string, edit: (s: string) => string) => ({
  ...base,
  [path]: edit(base[path] ?? ""),
})
const envRead = checkApp(
  with_(
    api,
    "src/app.ts",
    (s) =>
      `${s}\nconst KEY = process.env.API_KEY\nexport const lazy = () => process.env.LAZY\nexport function f() {\n  return process.env.INSIDE\n}\n`,
  ),
)
const envHits = envRead.findings.filter((f) => f.check === "env-module-scope")
ok(
  "check_app: module-scope process.env is an error, with its line; reads inside functions are not",
  envHits.length === 1 &&
    envHits[0]?.file === "src/app.ts" &&
    envHits[0]?.line === (api["src/app.ts"] ?? "").split("\n").length + 1,
  envHits,
)
const noCsrf = with_(api, "src/app.ts", (s) =>
  s.replace(/\.use\("\/api\/\*", csrfMiddleware\(\)\)/, ""),
)
ok("check_app: no csrfMiddleware warns", has(checkApp(noCsrf), "csrf", "warn"))
ok(
  'check_app: no csrfMiddleware with sameSite: "none" is an error',
  has(
    checkApp(
      with_(noCsrf, "src/app.ts", (s) => `${s}\nconst opts = { sameSite: "none" as const }\n`),
    ),
    "csrf",
  ),
)
ok(
  "check_app: rateLimit without trust is an error",
  has(
    checkApp(with_(api, "src/app.ts", (s) => s.replace("{ ...limit, max: 60 }", "{ max: 60 }"))),
    "rate-limit",
  ),
)
const noExport = checkApp(
  with_(api, "src/index.ts", (s) => s.replace(/^export \{ RateLimitCounter \}.*$/m, "")),
)
ok(
  "check_app: signet-doctor flags the missing Durable Object export",
  noExport.findings.some(
    (f) => f.check === "rate-limit-do" && f.message.includes("does not export RateLimitCounter"),
  ),
  noExport.findings,
)
const drift = checkApp(
  with_(
    with_(api, "wrangler.jsonc", (s) =>
      s.replace('"APP_ENV": "development"', '"APP_ENV": "development", "FEATURE_X": "on"'),
    ),
    "src/env.ts",
    (s) => s.replace("APP_ENV: z", "API_TOKEN: z.string(),\n  APP_ENV: z"),
  ),
)
ok(
  "check_app: a wrangler var missing from the schema warns",
  drift.findings.some((f) => f.message.includes("FEATURE_X")),
  drift.findings,
)
ok(
  "check_app: a required schema key missing from vars warns",
  drift.findings.some((f) => f.message.includes("API_TOKEN")),
)
ok(
  "check_app: a Signet theme with no @source for the components is an error",
  has(
    checkApp(with_(web, "src/app.css", (s) => s.replace(/@source[^;]*;/, ""))),
    "tailwind-source",
  ),
)

const repo = {
  "packages/tokens/src/themes/editorial.css": editorial,
  "packages/tokens/src/themes/cinematic.css": theme("cinematic"),
  "packages/ui/src/index.ts": readFileSync(`${ROOT}packages/ui/src/index.ts`, "utf8"),
}
const repoResult = checkApp(repo)
ok(
  "check_app: the Signet repo's base packages carry no domain vocabulary",
  repoResult.ok && repoResult.passed.includes("domain-vocabulary"),
  repoResult.findings,
)
ok(
  "check_app: a money slot in a base theme is an error",
  has(
    checkApp({
      ...repo,
      "packages/tokens/src/themes/editorial.css": `${editorial}\n:root { --money-credit: green; }`,
    }),
    "domain-vocabulary",
  ),
)
ok(
  "check_app: a domain component in the ui barrel is an error",
  has(
    checkApp({
      ...repo,
      "packages/ui/src/index.ts": `${repo["packages/ui/src/index.ts"]}export * from "./components/domain/trend-chip.js"\n`,
    }),
    "domain-vocabulary",
  ),
)

// --- scaffold_files matches create-signet-app byte for byte -------------------
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) =>
    statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)],
  )
const tmp = mkdtempSync(join(tmpdir(), "signet-mcp-"))
try {
  for (const [name, template, theme] of [
    ["web-app", "web", "cinematic"],
    ["api-app", "api", "editorial"],
  ] as const) {
    execFileSync(
      process.execPath,
      [
        `${ROOT}packages/create-signet-app/src/index.ts`,
        name,
        "--template",
        template,
        "--theme",
        theme,
      ],
      {
        cwd: tmp,
        stdio: "ignore",
      },
    )
    const dir = join(tmp, name)
    const real = Object.fromEntries(
      walk(dir).map((f) => [relative(dir, f), readFileSync(f, "utf8")]),
    )
    const ours = files(scaffoldFiles(name, template, theme))
    const diff = [...new Set([...Object.keys(real), ...Object.keys(ours)])].filter(
      (p) => real[p] !== ours[p],
    )
    ok(`scaffold_files: ${template} matches create-signet-app exactly`, diff.length === 0, diff)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// --- search and migration ---------------------------------------------------
const hits = search("rate limit durable object")
ok(
  "search: rate limiting finds the server docs",
  hits.some((h) => h.ref.startsWith("signet://docs/server")),
  hits.slice(0, 3),
)
ok(
  "search: a symbol name finds its export",
  search("parseBody").some(
    (h) => h.kind === "export" && h.ref === "@dapplelight/signet-server/http/validate",
  ),
)
const mig = migration("0.3.0", "0.4.0", "server")
ok(
  "migration: server 0.3.0 -> 0.4.0 lists the clientIp trust break",
  mig.entries.length > 0 && mig.entries.some((e) => e.breaking.some((b) => b.includes("clientIp"))),
  mig.entries.map((e) => e.heading),
)
ok(
  "migration: 0.1 -> 0.2 includes the README's 'Migrating from 0.1.x'",
  migration("0.1.0", "0.2.0", "signet-server").migrationNotes.some(
    (n) => n.title === "Migrating from 0.1.x",
  ),
)
ok(
  "migration: an out-of-range window is empty",
  migration("0.4.0", "0.4.0", "server").entries.length === 0,
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
