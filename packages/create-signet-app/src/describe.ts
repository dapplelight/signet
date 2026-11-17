/**
 * `--describe "<sentence>"`: one sentence to a whole-app plan. Picks the
 * template and theme, splits the sentence into pages, asks signet-mcp's
 * `plan_page` about each, and renders PLAN.md and AGENTS.md. No LLM call: the
 * same sentence always gives the same files.
 *
 * The keyword lists below only choose between Signet's own templates and
 * themes. They are not about any product; an app's own vocabulary stays in the app.
 */

import { INDEX } from "@dapplelight/signet-mcp/generated"
import { type PagePlan, planPage } from "@dapplelight/signet-mcp/plan"

export type DescribeTemplate = "web" | "api" | "full"
export type DescribeTheme = "editorial" | "cinematic" | "finance"
export type Page = { name: string; plan: PagePlan }
export type Described = { template: DescribeTemplate; theme: DescribeTheme; pages: Page[] }
/** How the chosen package manager spells running a script and a bin. */
export type Runner = { run: string; x: string }

// ponytail: keyword lists, not a classifier. A sentence that names none gets web and editorial.
const BACKEND =
  /\b(api|backend|server|endpoints?|webhooks?|database|login|sign[- ]?(in|up)|accounts?|billing|payments?|subscriptions?|admin|auth\w*)\b/i
const FINANCE =
  /\b(invoices?|expenses?|budgets?|bank\w*|ledger|accounting|finance|financial|payroll|money|transactions?|payments?)\b/i
const CINEMATIC =
  /\b(videos?|films?|movies?|cinema\w*|stream\w*|gallery|photos?|music|trailers?|showcase|portfolio)\b/i

export const NO_PAGE_WORDS = "dashboard, settings, pricing, inbox"

/** Pieces of the sentence that can each name a page: "an inbox with settings and pricing". */
const segments = (sentence: string) =>
  sentence
    .split(/[,;&\n]|\b(?:and|with|plus|then|also)\b/i)
    .map((s) => s.trim())
    .filter(Boolean)

/** Each distinct page the sentence names, in the order it names them. */
function pagesFor(sentence: string, target: DescribeTemplate): Page[] {
  const pages: Page[] = []
  for (const part of segments(sentence)) {
    const plan = planPage(INDEX, part, target)
    // web and full pages are blocks; an api page is named by the route plan_page files it under.
    const name = plan.blocks[0]?.name ?? /^src\/api\/(.+)\.ts$/.exec(plan.files[0]?.path ?? "")?.[1]
    if (name && !pages.some((p) => p.name === name)) pages.push({ name, plan })
  }
  return pages
}

export function describeApp(
  sentence: string,
  want: { template?: DescribeTemplate; theme?: DescribeTheme },
): Described {
  let template = want.template
  let pages: Page[] | undefined
  if (!template) {
    const web = pagesFor(sentence, "web")
    template = !BACKEND.test(sentence) ? "web" : web.length ? "full" : "api"
    if (template === "web") pages = web
  }
  pages ??= pagesFor(sentence, template)
  const theme =
    want.theme ??
    (template === "api"
      ? "editorial"
      : FINANCE.test(sentence)
        ? "finance"
        : CINEMATIC.test(sentence)
          ? "cinematic"
          : "editorial")
  return { template, theme, pages }
}

/** The order to build in: sign-in first, the catch-all pages last, the rest as named. */
const WEIGHT: Record<string, number> = { "auth-page": -1, "empty-page": 1, "error-page": 1 }
const buildOrder = (pages: Page[]) =>
  [...pages].sort((a, b) => (WEIGHT[a.name] ?? 0) - (WEIGHT[b.name] ?? 0))

/** The plan's `data` lines that describe records, as `name: fields`, not callbacks or flags. */
function models(pages: Page[]) {
  const out = new Map<string, { shape: string; pages: string[] }>()
  for (const p of pages)
    for (const line of p.plan.data) {
      const m = /^(\w+): (.+)$/.exec(line)
      if (!m || /^on[A-Z]/.test(m[1] as string) || /\b(called|calls|callback)\b/.test(line))
        continue
      if (!/\b(each|and)\b/.test(m[2] as string)) continue
      const key = `${m[1]}`
      const have = out.get(key)
      if (have) have.pages.push(p.name)
      else out.set(key, { shape: m[2] as string, pages: [p.name] })
    }
  return out
}

export function renderPlan(
  appName: string,
  sentence: string,
  d: Described,
  { run, x }: Runner,
): string {
  const head = `# Plan: ${appName}\n\n`
  if (!d.pages.length)
    return `${head}Template: ${d.template} · Theme: ${d.theme}\n\n## Pages\n\nNo page matched "${sentence}". Try words like ${NO_PAGE_WORDS}.\n`

  const check = `${x} @dapplelight/signet-cli check`
  const cmd = (c: string) => c.replace(/^npx /, `${x} `)
  const quote = sentence
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")
  const lines: string[] = [
    `${head}${quote}\n\nTemplate: ${d.template} · Theme: ${d.theme}\n`,
    "## Pages\n",
  ]

  d.pages.forEach((p, i) => {
    const { plan } = p
    lines.push(`### ${i + 1}. ${p.name}\n`)
    lines.push("**Blocks**\n")
    if (plan.blocks.length) {
      for (const b of plan.blocks) lines.push(`- \`${b.name}\`: ${b.why}`)
      lines.push("", "```bash", ...plan.blocks.map((b) => cmd(b.command)), "```\n")
    } else lines.push("- None: this page is API only.\n")
    lines.push("**Components**\n")
    lines.push(
      ...(plan.components.length
        ? plan.components.map((c) => `- \`${c.name}\`: \`${c.importPath}\``)
        : ["- None."]),
      "",
    )
    lines.push("**Modules**\n")
    lines.push(...(plan.modules.length ? plan.modules.map((m) => `- \`${m}\``) : ["- None."]), "")
    lines.push("**Data**\n")
    lines.push(...(plan.data.length ? plan.data.map((l) => `- ${l}`) : ["- None."]), "")
  })

  lines.push("## Data models\n")
  const ms = models(d.pages)
  lines.push(
    ...(ms.size
      ? [...ms].map(([k, v]) => `- \`${k}\`: ${v.shape} (${v.pages.join(", ")})`)
      : ["- None: the pages take props only."]),
    "",
  )

  lines.push("## Recipes\n")
  const recipes = [...new Set(d.pages.map((p) => p.plan.recipe).filter((r): r is string => !!r))]
  lines.push(
    ...(recipes.length
      ? recipes.map((id) => {
          const title = INDEX.recipes.find((r) => r.id === id)?.title ?? id
          return `- \`${id}\`: ${title}. Call \`recipe({ task: "${id}" })\`.`
        })
      : ["- None matched."]),
    "",
  )

  lines.push("## Build order\n")
  buildOrder(d.pages).forEach((p, i) => {
    lines.push(
      p.plan.blocks.length
        ? `${i + 1}. ${p.name}: run its block command, wire its data, then \`${check} --pages /${p.name}\`.`
        : `${i + 1}. ${p.name}: add \`src/api/${p.name}.ts\`${p.plan.recipe ? `, following the \`${p.plan.recipe}\` recipe` : ""}, then \`${check}\`.`,
    )
  })
  lines.push("")

  lines.push(
    "## After each page\n",
    "Fix every finding before you start the next page.\n",
    "```bash",
    `${check} --pages /<page>`,
    `${run} test`,
    "```\n",
    `\`check\` typechecks, runs Biome, checks Signet's conventions and, with \`--pages\`, screenshots the page at 390 and 1280 px with axe. Start the dev server first (\`${run} dev\`). Or call \`check_app({ path: "." })\` on the Signet MCP server.`,
  )
  return `${lines.join("\n")}\n`
}

export function renderAgents(appName: string, d: Described, { run }: Runner): string {
  return `${[
    `# ${appName}: notes for coding agents`,
    "",
    "This app is built from PLAN.md, one page at a time.",
    "",
    "1. Read PLAN.md. Build the pages in its Build order and never skip ahead.",
    "2. For each page: run its block command, wire the data it lists, then run the check from After each page.",
    "3. Fix every finding before you move on. Never edit a page before the previous one passes.",
    "4. Use `@dapplelight/signet-ui` components and `@dapplelight/signet-tokens` themes only.",
    d.template === "api"
      ? "5. No hand-rolled validation or error shapes: use `@dapplelight/signet-server`."
      : "5. No hand-rolled buttons, inputs or fetch wrappers: use the typed client in `src/lib/api.ts`.",
    "6. To look up a component, theme or convention, add the Signet MCP server:",
    "   `claude mcp add signet -- bunx @dapplelight/signet-mcp`",
    `7. Run \`${run} lint\`, \`${run} typecheck\` and \`${run} test\` before you finish.`,
    "",
    "If PLAN.md lists no pages, ask for a description of the first page before you build anything.",
  ].join("\n")}\n`
}
