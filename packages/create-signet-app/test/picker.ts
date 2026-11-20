/**
 * Off a terminal the picker never runs: stdout must stay byte for byte what it
 * was before the clack picker, since agents and CI read it. And `--starter api`,
 * the old name of api-billing, must still scaffold that starter. On a terminal
 * the picker's answers map to flags (src/picker.ts), checked here without one.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PART_NAMES, PARTS, resolveParts, STARTERS } from "../src/compose.js"
import {
  answer,
  choose,
  command,
  hasApi,
  hasUi,
  type Mix,
  mixRows,
  nameError,
  partRows,
  summary,
  THEME_LABELS,
  ticked,
  WHAT,
} from "../src/picker.js"

const CLI = new URL("../src/index.ts", import.meta.url).pathname
const DIR = mkdtempSync(join(tmpdir(), "csa-picker-"))

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

/** Runs the scaffolder with stdin from /dev/null, so it is not a TTY. */
function run(...args: string[]) {
  const p = Bun.spawnSync(["bun", CLI, ...args], { cwd: DIR, stdin: "ignore" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

// The picker's rows and what each set of answers scaffolds (src/picker.ts).
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const values = (rows: { value: string }[]) => rows.map((r) => r.value)
const allRows = [
  ...WHAT,
  ...mixRows("web"),
  ...mixRows("api"),
  ...partRows("web"),
  ...partRows("api"),
  ...Object.values(THEME_LABELS).map((label) => ({ value: "", label })),
]
ok(
  "what: five platforms and the mobile starter, web first",
  eq(values(WHAT), ["web", "api", "mobile", "cli", "extension", "desktop"]),
)
ok(
  "every row fits one line at 60 columns (label at most 44)",
  allRows.every((r) => r.label.length <= 44 && !r.label.includes("\n")),
  JSON.stringify(allRows.filter((r) => r.label.length > 44)),
)
ok(
  "no row shows an internal key as its label",
  allRows.every((r) => r.label !== r.value && !r.label.includes(" · ")),
)
const webMixes = values(mixRows("web"))
const apiMixes = values(mixRows("api"))
ok(
  "web start from: basics first, the starters, blank then everything last",
  webMixes[0] === "basics" &&
    eq(webMixes.slice(-2), ["blank", "full"]) &&
    !webMixes.includes("api-billing"),
  JSON.stringify(webMixes),
)
ok(
  "api start from: basics, Sign-in + billing, everything",
  eq(apiMixes, ["basics", "api-billing", "full"]),
)
ok(
  "every starter is offered (full on both paths; mobile is its own row in step 1)",
  Object.keys(STARTERS).every(
    (s) => s === "mobile" || webMixes.includes(s) || apiMixes.includes(s),
  ) && ![...webMixes, ...apiMixes].includes("mobile"),
)
ok(
  "features: every part but mcp on web; the API path drops web-only parts",
  eq(
    values(partRows("web")),
    PART_NAMES.filter((p) => p !== "mcp"),
  ) &&
    eq(
      values(partRows("api")),
      PART_NAMES.filter((p) => p !== "mcp" && !PARTS[p].webOnly),
    ),
)
ok(
  "features: a mix comes with its starter's parts and what they need ticked; every tick is a row",
  eq(ticked("basics"), []) &&
    eq(ticked("saas"), ["auth", ...STARTERS.saas.parts]) &&
    eq(ticked("api-billing"), ["auth", "account", "payments"]) &&
    webMixes.every((m) => ticked(m as Mix).every((p) => values(partRows("web")).includes(p))) &&
    apiMixes.every((m) => ticked(m as Mix).every((p) => values(partRows("api")).includes(p))),
)
const saas = [...STARTERS.saas.parts]
for (const [args, want] of [
  [["cli"], { template: "cli" }],
  [["extension"], { template: "extension" }],
  [["desktop"], { template: "desktop" }],
  [["mobile"], { template: "full", starter: "mobile" }],
  [["web", "basics", []], { template: "web" }],
  [["api", "basics", []], { template: "api" }],
  // A mix accepted as ticked (needs included) is the starter; with or without the needs.
  [["web", "saas", ticked("saas")], { template: "full", starter: "saas" }],
  [["api", "api-billing", ticked("api-billing")], { template: "full", starter: "api-billing" }],
  [["web", "saas", saas], { template: "full", starter: "saas" }],
  [["web", "blank", []], { template: "full", starter: "blank" }],
  [["web", "full", [...STARTERS.full.parts]], { template: "full", starter: "full" }],
  [["api", "api-billing", ["account", "payments"]], { template: "full", starter: "api-billing" }],
  [["api", "full", [...STARTERS.full.parts]], { template: "full", starter: "full", api: true }],
  // Ticks that equal a starter exactly are that starter, whatever the mix, in any order.
  [["web", "basics", ["pwa", "account"]], { template: "full", starter: "pwa" }],
  [["web", "launch", [...saas].reverse()], { template: "full", starter: "saas" }],
  // Anything else is --with (and --api on the API path).
  [
    ["web", "saas", [...saas, "ai"]],
    { template: "full", with: ["account", "admin", "notifications", "privacy", "payments", "ai"] },
  ],
  [["web", "basics", ["orgs", "payments"]], { template: "full", with: ["orgs", "payments"] }],
  [["api", "api-billing", ["account"]], { template: "full", with: ["account"], api: true }],
  // Everything unticked: the basics (blank on web, which equals no parts).
  [["api", "api-billing", []], { template: "api" }],
  [["web", "saas", []], { template: "full", starter: "blank" }],
] as const) {
  const got = choose(...(args as unknown as Parameters<typeof choose>))
  ok(`choose(${args.map((a) => JSON.stringify(a)).join(", ")})`, eq(got, want), JSON.stringify(got))
}
// Auto-required parts are dropped from --with, and the shorter flags resolve to the same parts.
for (const ticks of [
  ["auth", "orgs", "payments", "paywalls"],
  ["auth", "orgs", "admin", "ai"],
] as const) {
  const w = choose("web", "basics", [...ticks]).with ?? []
  ok(
    `choose: --with ${w.join(",")} is short and resolves to ${ticks.join(",")}`,
    w.length < ticks.length && eq(resolveParts(w, []).parts, resolveParts([...ticks], []).parts),
    JSON.stringify(w),
  )
}
ok(
  "command: the equivalent one-liner",
  command(
    "bunx create-signet-app",
    "demo",
    { template: "full", starter: "saas" },
    "finance",
    true,
  ) === "bunx create-signet-app demo --starter saas --theme finance --mcp" &&
    command("bunx create-signet-app", "demo", { template: "web" }, "editorial") ===
      "bunx create-signet-app demo" &&
    command("bunx create-signet-app", "demo", { template: "api" }, undefined, false) ===
      "bunx create-signet-app demo --platform api --no-mcp" &&
    command(
      "npx create-signet-app",
      "demo",
      { template: "full", with: ["ai"], api: true },
      undefined,
      true,
    ) === "npx create-signet-app demo --with ai --api --mcp",
)
ok(
  "summary: what, starter, the parts installed (needs too), theme, MCP",
  eq(summary("web", { template: "full", starter: "saas" }, saas, "finance", true), [
    "Web app (site + server)",
    "Starter: SaaS — teams, billing, admin, notifications",
    "Features: Sign-in, Account page, Teams & roles, Admin panel, Notifications, Privacy, Billing",
    "Theme: finance",
    "AI coding agents (MCP): yes",
  ]),
  JSON.stringify(summary("web", { template: "full", starter: "saas" }, saas, "finance", true)),
)
ok(
  "summary: Sign-in + billing is an API, with no theme",
  eq(
    summary(
      "api",
      { template: "full", starter: "api-billing" },
      ["account", "payments"],
      undefined,
      true,
    ),
    [
      "API only",
      "Starter: Sign-in + billing — accounts, API keys",
      "Features: Sign-in, Account page, Billing",
      "AI coding agents (MCP): yes",
    ],
  ),
)
ok(
  "summary: the web basics is a web app, no server",
  eq(summary("web", { template: "web" }, [], "editorial"), ["Web app", "Theme: editorial"]),
)
// A flag that answered a question is kept and the question is not asked.
let asked = 0
const yes = async () => (asked++, true)
const answers = [
  await answer(hasApi({ template: "api" }), false, yes), // --no-mcp, API only
  await answer(hasApi({ template: "full", starter: "saas" }), true, yes), // --mcp
  await answer(hasApi({ template: "api" }), undefined, yes), // no flag: asked
  await answer(hasApi({ template: "web" }), undefined, yes), // no API: not asked
  await answer(hasUi("web"), "finance", async () => (asked++, "editorial")), // --theme
  await answer(hasUi("api"), undefined, async () => (asked++, "editorial")), // no UI
]
ok(
  "--mcp / --no-mcp / --theme with the picker: kept, not asked; asked only where it applies",
  eq(answers, [false, true, true, undefined, "finance", undefined]) && asked === 1,
  JSON.stringify({ answers, asked }),
)
const NAMES = mkdtempSync(join(tmpdir(), "csa-names-"))
mkdirSync(join(NAMES, "taken"))
writeFileSync(join(NAMES, "taken/x"), "")
mkdirSync(join(NAMES, "empty"))
ok(
  "name prompt: empty is my-app, a free or empty dir is fine",
  nameError("", NAMES) === undefined &&
    nameError(undefined, NAMES) === undefined &&
    nameError("demo", NAMES) === undefined &&
    nameError("empty", NAMES) === undefined,
)
ok(
  "name prompt: a dash or a non-empty dir is refused",
  nameError("-x", NAMES) === "A name can't start with -." &&
    nameError(" taken ", NAMES) === "taken already exists and is not empty.",
)
rmSync(NAMES, { recursive: true, force: true })

try {
  const noName = run()
  ok(
    "no name, no TTY: the same error as before",
    noName.code === 1 &&
      noName.err === "\n  Missing target directory.\nUsage: create-signet-app <directory>\n\n",
    JSON.stringify(noName.err),
  )
  const noMcpWeb = run("my-no-mcp", "--no-mcp")
  ok(
    "--no-mcp with no platform, no TTY: refused as before (the web platform has no API)",
    noMcpWeb.code === 1 &&
      noMcpWeb.err === "\n  --mcp / --no-mcp apply to --platform api and composed apps only.\n\n",
    JSON.stringify(noMcpWeb.err),
  )
  // The summary's command, run off a terminal, builds what the picker said.
  const tweaked = run("my-tweaked", "--with", "orgs,payments", "--no-mcp")
  ok(
    "--with from ticks: needs come from compose (auth for orgs)",
    tweaked.code === 0 &&
      tweaked.out.includes("Parts: auth, orgs, payments (added auth for orgs)."),
    tweaked.out + tweaked.err,
  )
  const apiAll = run("my-api-all", "--starter", "full", "--api", "--no-mcp")
  ok(
    "API path everything = --starter full --api: the API half only",
    apiAll.code === 0 &&
      apiAll.out.includes("Created my-api-all: API.") &&
      !existsSync(join(DIR, "my-api-all/vite.config.ts")),
    apiAll.out + apiAll.err,
  )
  const apiTicked = run("my-api-ticked", "--with", "ai", "--api", "--no-mcp")
  ok(
    "API path ticks = --with ... --api: the API half only",
    apiTicked.code === 0 &&
      apiTicked.out.includes("Created my-api-ticked: API.") &&
      !existsSync(join(DIR, "my-api-ticked/vite.config.ts")),
    apiTicked.out + apiTicked.err,
  )
  const web = run("my-web")
  ok("no flags, no TTY: exits 0", web.code === 0, web.err)
  ok(
    "no flags, no TTY: the web platform's output, unchanged",
    web.out ===
      `
  Created my-web with the editorial theme.

  cd my-web
  bun install
  bun run dev

  Switch themes by editing the @dapplelight/signet-tokens import in src/app.css.

`,
    JSON.stringify(web.out),
  )
  ok("no flags, no TTY: scaffolds the web template", existsSync(join(DIR, "my-web/vite.config.ts")))

  const api = run("my-api", "--starter", "api")
  ok("--starter api: exits 0", api.code === 0, api.err)
  ok(
    "--starter api: resolves to api-billing (API half, account + payments)",
    api.out ===
      `
  Created my-api: API, MCP at /mcp.
  Parts: auth, account, payments, mcp (added auth for account).

  cd my-api
  bun install
  bun run dev

  Sign in with POST /api/auth/otp, then /api/auth/verify; in development the
  code is printed in this terminal.
  README.md walks through the first day. The API runs on Bun,
  whichever package manager installs it.

`,
    JSON.stringify(api.out),
  )
  ok("--starter api: no web half", !existsSync(join(DIR, "my-api/vite.config.ts")))

  const billing = run("my-billing", "--starter", "api-billing")
  ok(
    "--starter api-billing: the same app",
    billing.code === 0 && billing.out === api.out.replaceAll("my-api", "my-billing"),
    billing.err,
  )
  const help = run("--help")
  ok(
    "--help lists api-billing, not the alias",
    /\n {25}api-billing /.test(help.out) && !/\n {25}api /.test(help.out),
  )
} finally {
  rmSync(DIR, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
