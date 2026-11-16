/**
 * `plan_page`: a page described in words to a file plan. Deterministic word-stem
 * ranking over the generated index (blocks, components, recipes, server exports);
 * no LLM call, so the same description always gives the same plan.
 */

import type { SignetIndex } from "./types.js"

export type PlanTarget = "web" | "api" | "full"

export type PagePlan = {
  target: PlanTarget
  recipe: string | null
  blocks: { name: string; why: string; command: string }[]
  components: { name: string; importPath: string }[]
  modules: string[]
  data: string[]
  files: { path: string; purpose: string }[]
  next: string[]
  hint?: string
}

const SERVER = "@dapplelight/signet-server"

/** Words that say what the page is for, which the block's name and description lack. */
const HINTS: Record<string, string> = {
  "analytics-dashboard":
    "metrics overview stats statistics graph report reporting traffic insights",
  "auth-page": "login signin signup register password account otp verify oauth",
  "checkout-summary": "cart order payment pay purchase invoice receipt basket buy",
  "empty-page": "nothing blank placeholder zero",
  "error-page": "not found missing crash broken failure",
  "list-detail": "table inbox search filter browse items records catalog directory master",
  onboarding: "welcome wizard setup steps tour getting started",
  pricing: "plans tiers subscription billing monthly yearly annual upgrade",
  settings: "preferences profile configuration options notifications danger workspace",
}

/** What the page needs to be given, one line per field, as the block's props take it. */
const DATA: Record<string, string[]> = {
  "analytics-dashboard": [
    "stats: label, value, meta and tone for each metric",
    "series: label and value for each point of the chart",
    "rows: id, name, status and date for the recent-activity table",
    "range: the selected period, and a callback when it changes",
  ],
  "auth-page": [
    "mode: sign-in or sign-up",
    "providers: the sign-in providers to show, if any",
    "onRequestCode and onVerify: calls that send and check a one-time code",
  ],
  "checkout-summary": [
    "items: name, amount in minor units and quantity for each line",
    "discount and tax: amounts in minor units",
    "currency: an ISO code such as USD",
    "onPay: called with the total",
  ],
  "empty-page": ["title, description and one action for the empty state"],
  "error-page": ["code: 404 or 500", "title and description for the error"],
  "list-detail": [
    "items: id, title, status and the fields the detail pane shows",
    "filters: value and label for each status pill",
    "onSelect: called with the chosen item",
  ],
  onboarding: [
    "steps: title and content for each step",
    "onNext, onFinish and onSkip: called as the user moves through",
  ],
  pricing: [
    "plans: name, price per interval, features and call to action for each plan",
    "currency: an ISO code such as USD",
    "onSelect: called with the plan and the interval",
  ],
  settings: [
    "general: the workspace name and description",
    "notifications: one on or off value per kind of message",
    "onSaveGeneral, onSaveNotifications and onDelete: calls that store the change",
  ],
}

/** Server modules that back the page's data. */
const MODULES: Record<string, string[]> = {
  "analytics-dashboard": [`${SERVER}/analytics/ingest`, `${SERVER}/http`],
  "auth-page": [`${SERVER}/auth/hono`, `${SERVER}/auth/otp`],
  "checkout-summary": [`${SERVER}/http`],
  "list-detail": [`${SERVER}/http/validate`],
  onboarding: [`${SERVER}/http`],
  pricing: [`${SERVER}/http`],
  settings: [`${SERVER}/http/validate`],
}

const STOP = new Set(
  "page pages screen view the and for with from that this each into about our your app site show shows need needs want like new add make build create".split(
    " ",
  ),
)
const stem = (w: string) => {
  const s = w.replace(/(?:ing|(?<=[sxz]|ch|sh)es|s)$/, "")
  return s.length >= 3 ? s : w
}
const tokens = (text: string) => text.toLowerCase().match(/[a-z]{3,}/g) ?? []
const stems = (text: string) => [
  ...new Set(
    tokens(text)
      .filter((w) => !STOP.has(w))
      .map(stem),
  ),
]
/** `weight` for each word of the description whose stem is a stem of a word in `text`. */
const hits = (words: string[], text: string, weight: number) => {
  const have = new Set(stems(text))
  return words.filter((w) => have.has(w)).length * weight
}
const rank = <T>(items: { item: T; name: string; score: number }[], limit: number) =>
  items
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)

const slug = (s: string) => s.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

export function planPage(index: SignetIndex, description: string, target: PlanTarget): PagePlan {
  const words = stems(description)
  const wantWeb = target !== "api"
  const wantApi = target !== "web"

  const block = rank(
    index.blocks.map((b) => ({
      item: b,
      name: b.name,
      score:
        hits(words, b.name, 5) +
        hits(words, HINTS[b.name] ?? "", 4) +
        hits(words, b.description, 1),
    })),
    1,
  )[0]?.item
  const recipe = rank(
    index.recipes.map((r, i) => ({
      item: r,
      // A tie goes to the recipe listed first: they run from general to specific.
      name: String(i).padStart(3, "0"),
      // A word counts 3 as a keyword, else 1 in the id or title; never both.
      score: (() => {
        const kw = stems(r.keywords.join(" "))
        const head = stems(`${r.id} ${r.title}`)
        return words.reduce((n, w) => n + (kw.includes(w) ? 3 : head.includes(w) ? 1 : 0), 0)
      })(),
    })),
    1,
  ).filter((x) => x.score >= 3)[0]?.item

  const modules: string[] = []
  if (wantApi) {
    const scored = rank(
      index.exports
        .filter((e) => e.package === SERVER && !e.stylesheet)
        .map((e) => ({
          item: e.path,
          name: e.path,
          score: hits(words, e.path.slice(SERVER.length), 5) + hits(words, e.summary, 1),
        })),
      3,
    ).map((x) => x.item)
    const known = new Set(index.exports.map((e) => e.path))
    const fromBlock = (block ? (MODULES[block.name] ?? []) : []).filter((p) => known.has(p))
    modules.push(...[...new Set([...fromBlock, ...scored])].slice(0, 4))
    if (!modules.length && (block || recipe)) modules.push(`${SERVER}/http`)
  }

  const matched = wantWeb ? !!block : modules.length > 0 || !!recipe
  const base: PagePlan = {
    target,
    recipe: null,
    blocks: [],
    components: [],
    modules: [],
    data: [],
    files: [],
    next: [],
  }
  if (!matched)
    return {
      ...base,
      hint: "No block matches. Try compose_component for the parts, or search_docs.",
    }

  const name = block?.name ?? recipe?.id ?? "page"
  const route = slug(name)
  const files: PagePlan["files"] = []
  if (wantWeb && block) {
    files.push({
      path: `src/routes/${route}.tsx`,
      purpose: "Page route that renders the block with sample data",
    })
    for (const f of block.files)
      files.push({
        path: `src/components/signet/blocks/${block.name}/${f}`,
        purpose: f.startsWith("sample")
          ? "Sample data to replace with your own"
          : "The block, copied by the add command for you to edit",
      })
  }
  if (wantApi)
    files.push({
      path: `src/api/${route}.ts`,
      purpose: "API route that returns the page data as JSON",
    })

  const comps = block
    ? block.deps.flatMap((d) => index.components.filter((c) => c.name === d && !c.domain))
    : []
  const next = [
    ...(wantWeb && comps[0] ? [`get_component({ name: "${comps[0].name}" })`] : []),
    ...(recipe ? [`recipe({ task: "${recipe.id}" })`] : []),
    "check_app",
  ]
  return {
    target,
    recipe: recipe?.id ?? null,
    blocks:
      wantWeb && block
        ? [
            {
              name: block.name,
              why: block.description,
              command: `npx @dapplelight/signet-cli add block ${block.name}`,
            },
          ]
        : [],
    components: wantWeb ? comps.map((c) => ({ name: c.name, importPath: c.importPath })) : [],
    modules,
    data: block ? (DATA[block.name] ?? []) : [],
    files,
    next,
  }
}
