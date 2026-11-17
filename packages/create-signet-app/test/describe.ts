/**
 * --describe: five sentences must give the same template, theme and pages every
 * run, the plan files must be deterministic, and the flag must not change what
 * a scaffold without it writes. Scaffolds without installing: it only checks files.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { $ } from "bun"
import { describeApp, renderAgents, renderPlan } from "../src/describe"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const CLI = `${ROOT}/packages/create-signet-app/src/index.ts`

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, JSON.stringify(d)))
}

// [sentence, template, theme, pages in the order the sentence names them]
const FIXTURES: [string, string, string, string[]][] = [
  [
    "a team inbox with settings and pricing",
    "web",
    "editorial",
    ["list-detail", "settings", "pricing"],
  ],
  [
    "an invoice dashboard with a visitors chart, a login screen and a checkout",
    "full",
    "finance",
    ["analytics-dashboard", "auth-page", "checkout-summary"],
  ],
  [
    "a movie gallery with an onboarding flow and a not found page",
    "web",
    "cinematic",
    ["onboarding", "error-page"],
  ],
  [
    "a backend api with webhooks and rate limiting",
    "api",
    "editorial",
    ["add-backend-module", "payments", "add-rate-limit"],
  ],
  ["a spaceship to mars", "web", "editorial", []],
]
const runner = { run: "bun run", x: "bunx" }

for (const [sentence, template, theme, pages] of FIXTURES) {
  const d = describeApp(sentence, {})
  ok(
    `"${sentence}": ${template}, ${theme}, ${pages.length} pages`,
    d.template === template &&
      d.theme === theme &&
      d.pages.map((p) => p.name).join() === pages.join(),
    [d.template, d.theme, d.pages.map((p) => p.name)],
  )
  const plan = renderPlan("my-app", sentence, d, runner)
  ok(
    `"${sentence}": the plan is the same on every run`,
    plan === renderPlan("my-app", sentence, describeApp(sentence, {}), runner),
  )
  ok(
    `"${sentence}": no path or timestamp in the plan`,
    !/\/Users\/|\/tmp\/|\d{4}-\d\d-\d\d|T\d\d:\d\d/.test(plan),
  )
  if (!pages.length) {
    ok(
      "no match: says which words to try",
      plan.includes(
        `No page matched "${sentence}". Try words like dashboard, settings, pricing, inbox.`,
      ),
      plan,
    )
    continue
  }
  const heads = [...plan.matchAll(/^## (.+)$/gm)].map((m) => m[1])
  ok(
    `"${sentence}": sections come in the fixed order`,
    heads.join() === "Pages,Data models,Recipes,Build order,After each page",
    heads,
  )
  ok(
    `"${sentence}": one numbered heading per page`,
    pages.every((p, i) => plan.includes(`### ${i + 1}. ${p}\n`)),
  )
}

// The inbox plan, line by line where it matters.
{
  const s = "a team inbox with settings and pricing"
  const plan = renderPlan("my-app", s, describeApp(s, {}), { run: "npm run", x: "npx" })
  ok(
    "header: name, sentence, template and theme",
    plan.startsWith(`# Plan: my-app\n\n> ${s}\n\nTemplate: web · Theme: editorial\n`),
    plan.slice(0, 120),
  )
  ok(
    "the block command is in a bash fence",
    plan.includes("```bash\nnpx @dapplelight/signet-cli add block pricing\n```"),
  )
  ok(
    "components carry their import path",
    /- `tabs`: `@dapplelight\/signet-ui\/components\/tabs`/.test(plan),
  )
  ok("data lines come from plan_page", plan.includes("- plans: name, price per interval"))
  ok("data models name the records", /## Data models\n\n- `items`: /.test(plan), plan)
  ok("recipes link the recipe tool", plan.includes('Call `recipe({ task: "add-plans" })`.'))
  ok(
    "after each page: signet check, then the tests",
    plan.includes("npx @dapplelight/signet-cli check --pages /<page>\nnpm run test"),
  )
}

// Sign-in is built first, whatever order the sentence names it in.
{
  const s = FIXTURES[1]?.[0] as string
  const plan = renderPlan("my-app", s, describeApp(s, {}), runner)
  const order = plan.slice(plan.indexOf("## Build order"))
  ok("auth-page is built first", /1\. auth-page: .*\n2\. analytics-dashboard: /.test(order), order)
}

// An explicit template wins over the picked one; api never gets a theme.
ok("--template full wins", describeApp("a team inbox", { template: "full" }).template === "full")
ok("--theme wins", describeApp("an invoice list", { theme: "cinematic" }).theme === "cinematic")

const agents = renderAgents("my-app", describeApp("a pricing page", {}), runner)
ok("AGENTS.md is under 30 lines", agents.split("\n").length < 30, agents.split("\n").length)
ok(
  "AGENTS.md says follow PLAN.md page by page and run the check",
  agents.includes("PLAN.md") && agents.includes("one page at a time") && agents.includes("check"),
)

// The CLI: files and messages.
const tmp = mkdtempSync(join(tmpdir(), "describe-"))
const cli = (...args: string[]) => $`bun run ${CLI} ${args}`.cwd(tmp).nothrow().quiet()
const text = (r: { stdout: Buffer; stderr: Buffer }) => r.stdout.toString() + r.stderr.toString()
try {
  const s = "a team inbox with settings and pricing"
  const r = await cli("inbox-app", "--describe", s, "--pm", "npm")
  const out = text(r)
  ok("scaffolds and exits 0", r.exitCode === 0, out)
  ok("the web template was picked", existsSync(join(tmp, "inbox-app/src/routes/index.tsx")))
  const plan = readFileSync(join(tmp, "inbox-app/PLAN.md"), "utf8")
  ok(
    "PLAN.md is the rendered plan",
    plan.startsWith("# Plan: inbox-app\n\n> a team inbox"),
    plan.slice(0, 80),
  )
  ok(
    "AGENTS.md is written",
    readFileSync(join(tmp, "inbox-app/AGENTS.md"), "utf8").includes("PLAN.md"),
  )
  ok(
    "console: the template message, then the pages",
    out.includes("Created inbox-app") &&
      out.includes(
        "Planned 3 pages in PLAN.md: list-detail, settings, pricing. Hand AGENTS.md to your coding agent.",
      ),
    out,
  )
  ok("the sentence is not echoed to the console", !out.includes(s), out)

  const full = await cli("full-app", "--describe", "a login and an invoice dashboard", "--mcp")
  ok(
    "a backend word picks full",
    full.exitCode === 0 && existsSync(join(tmp, "full-app/api/app.ts")),
    text(full),
  )

  const none = await cli("none-app", "--describe", "a spaceship to mars")
  ok(
    "no match: still scaffolds, exit 0",
    none.exitCode === 0 &&
      existsSync(join(tmp, "none-app/package.json")) &&
      text(none).includes("No pages matched; PLAN.md lists words to try."),
    text(none),
  )
  ok(
    "no match: PLAN.md lists words to try",
    readFileSync(join(tmp, "none-app/PLAN.md"), "utf8").includes(
      'No page matched "a spaceship to mars".',
    ),
  )

  const many = await cli(
    "many-app",
    "--describe",
    "a login, a dashboard with a chart, a checkout, an onboarding flow, a pricing page, settings, a not found page and an empty page",
  )
  ok(
    "more than five pages: five, then and N more",
    /Planned 8 pages in PLAN\.md: [^.]+, [^.]+, [^.]+, [^.]+, [^.]+ and 3 more\./.test(text(many)),
    text(many),
  )

  const bad = await cli("bad-app", "--describe", "a team inbox", "--template", "cli")
  ok(
    "cli template: error, nothing scaffolded",
    bad.exitCode === 1 &&
      text(bad).includes("--describe applies to --template web, api and full only.") &&
      !existsSync(join(tmp, "bad-app")),
    text(bad),
  )
  const empty = await cli("empty-app", "--describe", " ")
  ok(
    "empty sentence: error",
    empty.exitCode === 1 &&
      text(empty).includes(
        '--describe needs a sentence, e.g. --describe "a team inbox with settings".',
      ),
    text(empty),
  )
  const clash = await cli(
    "clash-app",
    "--describe",
    "an invoice dashboard",
    "--template",
    "web",
    "--target",
    "bun",
  )
  ok(
    "an explicit flag the template cannot take still errors",
    clash.exitCode === 1 && text(clash).includes("--target applies"),
    text(clash),
  )

  // Without --describe nothing new is written.
  await cli("plain-app")
  ok(
    "no --describe: no PLAN.md or AGENTS.md",
    existsSync(join(tmp, "plain-app/package.json")) &&
      !readdirSync(join(tmp, "plain-app")).some((f) => f === "PLAN.md" || f === "AGENTS.md"),
  )
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
