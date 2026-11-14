/**
 * check_theme and check_app: pure functions over file contents. The theme
 * checks are CONTRACT.md plus `tokens/test/contrast.ts` (vendored into
 * `generated/`), the Durable Object checks are `signet-doctor`'s own `diagnose`.
 */

import { block, PAIRS, ratio, resolve } from "./generated/contrast.js"
import { diagnose, parseWranglerConfig } from "./generated/doctor-check.js"
import { INDEX } from "./generated/index.js"

export type Finding = {
  level: "error" | "warn"
  check: string
  message: string
  /** What to change, verbatim where possible. */
  fix?: string
  file?: string
  line?: number
}

export type CheckResult = {
  ok: boolean
  errors: number
  warnings: number
  findings: Finding[]
  /** Checks that ran and found nothing. */
  passed: string[]
}

function result(findings: Finding[], ran: string[]): CheckResult {
  const failed = new Set(findings.map((f) => f.check))
  const errors = findings.filter((f) => f.level === "error").length
  return {
    ok: errors === 0,
    errors,
    warnings: findings.length - errors,
    findings,
    passed: [...new Set(ran)].filter((c) => !failed.has(c)),
  }
}

const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "")

// Tailwind's stock colour scales. A theme must not repaint them (CONTRACT.md).
const STOCK =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone"

/** Validate a theme's CSS against CONTRACT.md and the WCAG pairs tokens' test checks. */
export function checkTheme(
  rawCss: string,
): CheckResult & { contrast: { checked: number; skipped: number } } {
  const css = stripCssComments(rawCss)
  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string))
  const findings: Finding[] = []
  const ran = [
    "contract.required",
    "contract.optional-slots",
    "contract.stock-palette",
    "contract.no-source",
    "contrast",
  ]

  const missing = INDEX.tokens.filter((t) => t.kind === "required" && !defined.has(t.name))
  if (missing.length)
    findings.push({
      level: "error",
      check: "contract.required",
      message: `Missing ${missing.length} of ${INDEX.contractCounts.required} required variables: ${missing.map((t) => t.name).join(" ")}`,
      fix: "Define each inside `@theme inline { ... }`. Copy the missing lines from a shipped theme (get_theme editorial, include_css) and change the values.",
    })
  if (!/@theme\b/.test(css))
    findings.push({
      level: "warn",
      check: "contract.required",
      message:
        "No `@theme` block. Tailwind v4 only turns variables into utilities from inside `@theme inline { ... }`.",
    })

  const light = /:root\s*\{/.test(css) ? block(css, /:root\s*\{/) : {}
  const darkSel = /(?:^|[\s,}])(?:\.dark|\[data-theme=["'][^"']+["']\])[^{};]*\{/m
  const hasDark = darkSel.test(css)
  const dark = hasDark ? block(css, darkSel) : {}

  // An optional slot `--color-X` maps to a runtime `--X` set in both modes.
  for (const t of INDEX.tokens.filter((t) => t.kind !== "required" && defined.has(t.name))) {
    if (!t.name.startsWith("--color-")) continue
    const runtime = `--${t.name.slice(8)}`
    const where = [
      !light[runtime] && ":root",
      hasDark && !dark[runtime] && "the dark block",
    ].filter(Boolean)
    if (where.length)
      findings.push({
        level: "warn",
        check: "contract.optional-slots",
        message: `${t.name} is defined but ${runtime} is not set in ${where.join(" or ")}.`,
        fix: `Set ${runtime} in both the light and the dark block, and map \`${t.name}: var(${runtime})\` in @theme.`,
      })
  }

  const stock = [...defined].filter((n) => new RegExp(`^--color-(?:${STOCK})-\\d{2,3}$`).test(n))
  if (stock.length)
    findings.push({
      level: "error",
      check: "contract.stock-palette",
      message: `Repaints Tailwind's stock palette: ${stock.join(" ")}. An app's bg-red-500 must stay Tailwind's red under every theme.`,
      fix: "Remove these and set the semantic tokens (--destructive, --accent-red, ...) to the colour you want instead.",
    })

  if (/@source\b/.test(css))
    findings.push({
      level: "error",
      check: "contract.no-source",
      message:
        "The theme carries `@source`. A theme cannot know where it is installed; the consuming app declares it.",
      fix: 'Delete the @source line here; the app adds `@source "../node_modules/@dapplelight/signet-ui/dist";` after its imports.',
    })

  let checked = 0
  let skipped = 0
  const modes: [string, Record<string, string>][] = [["light", light]]
  if (hasDark) modes.push(["dark", { ...light, ...dark }])
  for (const [mode, vars] of modes) {
    for (const [fg, bg, min] of PAIRS) {
      const a = resolve(vars, vars[fg] ?? "")
      const b = resolve(vars, vars[bg] ?? "")
      const r = ratio(a, b)
      if (r === null) {
        skipped++ // not a plain hex (rgba, color-mix, or not set): checked by eye, as tokens' test does
        continue
      }
      checked++
      if (r < min)
        findings.push({
          level: "error",
          check: "contrast",
          message: `${mode}: ${fg} on ${bg} is ${r.toFixed(2)}:1 (${a} on ${b}); needs ${min}:1.`,
          fix: `Change ${fg} or ${bg} in the ${mode} block until the pair reaches ${min}:1.`,
        })
    }
  }
  return { ...result(findings, ran), contrast: { checked, skipped } }
}

// ------------------------------------------------------------------ check_app

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs)$/
const isTest = (p: string) => /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[jt]sx?$/.test(p)
const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length

/** Blank out strings and comments, keeping offsets, so braces and names can be scanned. */
function code(src: string, keepStrings = false): string {
  return src.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g,
    (m) => (keepStrings && m[0] !== "/" ? m : m.replace(/[^\n]/g, " ")),
  )
}

/**
 * Offsets of `process.env` / `Bun.env` reads that run when the module loads.
 * ponytail: brace heuristic — a `{` after `)` or `=>` opens a function (or a
 * control block); an arrow with an expression body is caught by `=>` earlier
 * on the line. An IIFE at module scope is missed; a real parser fixes that.
 */
function moduleScopeEnvReads(src: string): number[] {
  const c = code(src)
  const hits: number[] = []
  const stack: boolean[] = []
  let fnDepth = 0
  for (let i = 0; i < c.length; i++) {
    const ch = c[i]
    if (ch === "{") {
      const before = c.slice(Math.max(0, i - 200), i).trimEnd()
      const fn =
        before.endsWith(")") || before.endsWith("=>") || /\b(?:else|try|finally|do)$/.test(before)
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

/** A call's argument text: `name(` ... `)`. */
function calls(src: string, name: string): { index: number; args: string }[] {
  const c = code(src)
  const out: { index: number; args: string }[] = []
  for (const m of c.matchAll(new RegExp(`\\b${name}\\s*(?:<[^()]*>)?\\(`, "g"))) {
    const open = (m.index ?? 0) + m[0].length - 1
    let depth = 0
    let i = open
    for (; i < c.length; i++) {
      if (c[i] === "(") depth++
      else if (c[i] === ")" && --depth === 0) break
    }
    out.push({ index: m.index ?? 0, args: c.slice(open + 1, i) })
  }
  return out
}

/** The keys of the env schema: `createEnv(z.object({...}))` or `const envSchema = z.object({...})`. */
function envSchemaKeys(src: string): { key: string; optional: boolean }[] | null {
  const at = /(?:createEnv\(\s*|[Ee]nv[A-Za-z]*\s*=\s*)z\.object\(\{/.exec(src)
  if (!at) return null
  const start = at.index + at[0].length
  let depth = 1
  let i = start
  for (; i < src.length && depth; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") depth--
  }
  const body = src.slice(start, i - 1)
  // ponytail: one key per line, as the template writes them; a key split over lines reads as required.
  return [...body.matchAll(/^\s*["']?([A-Z][A-Z0-9_]*)["']?\s*:(.*)$/gm)].map((m) => ({
    key: m[1] as string,
    optional: /\.optional\(\)|\.default\(/.test(m[2] as string),
  }))
}

const TEMPLATE_RATE_LIMIT =
  'app.use("/api/*", rateLimit({ max: 60, trust: "cloudflare" }))   // from "@dapplelight/signet-server/middleware/rate-limit"; off Cloudflare: trust: { forwardedHops: n }'
const TEMPLATE_CSRF =
  'app.use("/api/*", csrfMiddleware({ originEnvKeys: ["WEB_URL"] }))   // from "@dapplelight/signet-server/middleware/csrf"'

/**
 * Signet's conventions over an app's files (path -> contents, paths relative
 * to the app root). Works on a Worker API, a web app, or the Signet repo itself.
 */
export function checkApp(files: Record<string, string>): CheckResult {
  const findings: Finding[] = []
  const ran: string[] = []
  const paths = Object.keys(files)
    .filter((p) => !/(?:^|\/)(?:node_modules|dist|\.git)\//.test(p))
    .sort()
  const sources = paths.filter((p) => SOURCE.test(p) && !isTest(p))
  const text = (p: string) => files[p] ?? ""
  const all = sources.map(text).join("\n")
  const allCode = sources.map((p) => code(text(p), true)).join("\n") // comments out, strings kept
  const isHonoApp = /new\s+Hono\b/.test(allCode)
  const wranglerPath = paths
    .filter((p) => /(?:^|\/)wrangler\.jsonc?$/.test(p))
    .sort((a, b) => a.length - b.length)[0]
  const wranglerText = wranglerPath ? text(wranglerPath) : null
  let wrangler: ReturnType<typeof parseWranglerConfig> & { vars?: Record<string, unknown> } = {}
  if (wranglerText !== null) {
    try {
      wrangler = parseWranglerConfig(wranglerText)
    } catch (err) {
      findings.push({
        level: "error",
        check: "wrangler",
        file: wranglerPath,
        message: `wrangler config does not parse: ${String(err)}`,
      })
    }
  }
  if (!wranglerPath && paths.some((p) => /(?:^|\/)wrangler\.toml$/.test(p)))
    findings.push({
      level: "warn",
      check: "wrangler",
      message:
        "wrangler.toml is not checked; convert to wrangler.jsonc to check bindings, migrations and vars.",
    })

  // 1. Server modules never read env at module scope.
  ran.push("env-module-scope")
  for (const p of sources) {
    const src = text(p)
    const server = /from\s+["'](?:hono|@dapplelight\/signet-server[^"']*)["']/.test(src)
    // A Bun or Node entry runs with its env already loaded; that is where module-scope reads belong.
    const processEntry =
      /Bun\.serve\(|@hono\/node-server|\/\/\/\s*<reference types="bun"\s*\/>/.test(src)
    if (!server || processEntry) continue
    for (const at of moduleScopeEnvReads(src))
      findings.push({
        level: "error",
        check: "env-module-scope",
        file: p,
        line: lineOf(src, at),
        message:
          "Reads env when the module loads. Workers do not populate env at import time, so this is undefined in production.",
        fix: "Declare the key in the createEnv schema (@dapplelight/signet-server/env) and read `env.KEY` inside the handler, after initRuntimeEnv(c.env).",
      })
  }

  // 2. Rate limiting is wired, with a trust setting.
  if (isHonoApp) {
    ran.push("rate-limit")
    const limits = sources.flatMap((p) => calls(text(p), "rateLimit").map((c) => ({ ...c, p })))
    if (!limits.length)
      findings.push({
        level: "warn",
        check: "rate-limit",
        message: "The API has no rate limit.",
        fix: TEMPLATE_RATE_LIMIT,
      })
    for (const l of limits) {
      if (/\.\.\.|\btrust\b|\bkeyFor\b/.test(l.args)) continue // a spread may carry trust
      findings.push({
        level: "error",
        check: "rate-limit",
        file: l.p,
        line: lineOf(text(l.p), l.index),
        message:
          "rateLimit without `trust` or `keyFor` throws at construction (signet-server 0.4.0).",
        fix: 'Pass trust: "cloudflare" on Cloudflare, trust: { forwardedHops: n } behind n proxies of your own, or trust: "none" to put every client in one bucket.',
      })
    }
  }

  // 3. signet-doctor: the Durable Object rate limiter's binding, migration and export.
  if (wranglerText !== null || /durableObjectStore\s*\(/.test(allCode)) {
    ran.push("rate-limit-do")
    const dir = wranglerPath?.includes("/")
      ? wranglerPath.slice(0, wranglerPath.lastIndexOf("/") + 1)
      : ""
    const entryPath = wrangler.main ? `${dir}${wrangler.main.replace(/^\.\//, "")}` : undefined
    for (const f of diagnose({
      wranglerConfig: wranglerText,
      entrySource: entryPath && entryPath in files ? text(entryPath) : null,
      appSource: all,
    })) {
      if (f.level === "ok") continue
      findings.push({
        level: f.level,
        check: "rate-limit-do",
        file: wranglerPath,
        message: f.message,
        ...(f.fix ? { fix: f.fix } : {}),
      })
    }
  }

  // 4. CSRF on cookie-carrying APIs.
  if (isHonoApp) {
    ran.push("csrf")
    if (!/csrfMiddleware\s*\(/.test(allCode)) {
      const none = /sameSite\s*:\s*["']none["']/i.test(allCode)
      const cookies = none || /sessionCookie\(|setCookie\(|Set-Cookie|betterAuth\(/.test(allCode)
      findings.push({
        level: none ? "error" : "warn",
        check: "csrf",
        message: none
          ? 'A sameSite: "none" cookie with no csrfMiddleware: cross-site form posts ride the session.'
          : cookies
            ? "Cookies are set but csrfMiddleware is not mounted."
            : "csrfMiddleware is not mounted. The create-signet-app API template enables it on /api/*.",
        fix: TEMPLATE_CSRF,
      })
    }
  }

  // 5. The error envelope.
  if (isHonoApp) {
    ran.push("error-handler")
    if (!/errorHandler\s*\(/.test(allCode))
      findings.push({
        level: "warn",
        check: "error-handler",
        message:
          "No errorHandler: errors will not be the Signet envelope, and 500s may leak their message.",
        fix: 'app.onError(errorHandler({ isProduction }))   // from "@dapplelight/signet-server/http"',
      })
  }

  // 6. The env schema against wrangler vars.
  const schemaFile = sources.find((p) => envSchemaKeys(text(p)) !== null)
  if (schemaFile) {
    ran.push("env-schema")
    const keys = envSchemaKeys(text(schemaFile)) ?? []
    if (!/initRuntimeEnv\s*\(/.test(allCode) && wranglerText !== null)
      findings.push({
        level: "error",
        check: "env-schema",
        file: schemaFile,
        message:
          "createEnv is used but initRuntimeEnv is never called: on Workers the schema sees no bindings.",
        fix: 'app.use("*", async (c, next) => { initRuntimeEnv(c.env); await next() })   // first middleware',
      })
    if (wranglerText !== null) {
      const vars = Object.keys(wrangler.vars ?? {})
      for (const v of vars.filter((v) => !keys.some((k) => k.key === v)))
        findings.push({
          level: "warn",
          check: "env-schema",
          file: wranglerPath,
          message: `wrangler var ${v} is not in the env schema, so nothing validates it.`,
          fix: `Add \`${v}: z.string()\` (or a tighter type) to the schema in ${schemaFile}, and read it as env.${v}.`,
        })
      for (const k of keys.filter((k) => !k.optional && !vars.includes(k.key)))
        findings.push({
          level: "warn",
          check: "env-schema",
          file: schemaFile,
          message: `${k.key} is required by the env schema but is not a wrangler var.`,
          fix: `If it is a secret: \`wrangler secret put ${k.key}\` (and .dev.vars locally). Otherwise add it to "vars" in ${wranglerPath}, or give it .default(...).`,
        })
    }
  }

  // 7. A web app's CSS must let Tailwind see the components.
  for (const p of paths.filter((p) => p.endsWith(".css"))) {
    const css = stripCssComments(text(p))
    if (!/@import\s+["']@dapplelight\/signet-tokens\//.test(css)) continue
    ran.push("tailwind-source")
    if (!/@source\s+["'][^"']*signet-ui/.test(css))
      findings.push({
        level: "error",
        check: "tailwind-source",
        file: p,
        message:
          "Imports a Signet theme but has no @source for @dapplelight/signet-ui: every component renders unstyled.",
        fix: '@source "../node_modules/@dapplelight/signet-ui/dist";   // after the @import lines',
      })
  }

  // 8. No domain vocabulary in a base package (when checking the Signet repo itself).
  const baseThemes = paths.filter((p) =>
    /tokens\/src\/themes\/(?:editorial|cinematic)\.css$/.test(p),
  )
  const uiBarrel = paths.find((p) => /(?:^|\/)packages\/ui\/src\/index\.ts$/.test(p))
  if (baseThemes.length || uiBarrel) {
    ran.push("domain-vocabulary")
    const domain = INDEX.tokens.filter((t) => t.kind === "domain").map((t) => t.name)
    for (const p of baseThemes) {
      const css = stripCssComments(text(p))
      for (const d of domain.filter(
        (d) => css.includes(`${d}:`) || css.includes(`--${d.slice(8)}:`),
      ))
        findings.push({
          level: "error",
          check: "domain-vocabulary",
          file: p,
          message: `${d} is a domain slot in a base theme.`,
          fix: "Move it to tokens/src/themes/finance.css (or the product's own theme).",
        })
    }
    if (uiBarrel && /from\s+["']\.\/components\/domain\//.test(text(uiBarrel)))
      findings.push({
        level: "error",
        check: "domain-vocabulary",
        file: uiBarrel,
        message: "The ui barrel re-exports a domain/ component.",
        fix: "Export it only from its own subpath (@dapplelight/signet-ui/domain/<name>).",
      })
  }

  return result(findings, ran)
}
