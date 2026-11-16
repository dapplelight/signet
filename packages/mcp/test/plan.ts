// plan_page: ten page descriptions and the block and recipe each must rank first.
import { INDEX } from "../src/generated/index"
import { type PlanTarget, planPage } from "../src/plan"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c
    ? (pass++, console.log("  PASS", n))
    : (fail++, console.log("  FAIL", n, typeof d === "string" ? d : JSON.stringify(d, null, 1)))
}

// [description, top block, top recipe]
const FIXTURES: [string, string, string | null][] = [
  ["a pricing page with monthly and yearly plans", "pricing", "add-plans"],
  [
    "an analytics dashboard with a visitors chart and a date range",
    "analytics-dashboard",
    "add-analytics",
  ],
  ["a sign in page with a password field", "auth-page", "add-auth"],
  ["a login and sign up screen", "auth-page", "add-auth"],
  ["a checkout page that shows the order total", "checkout-summary", "payments"],
  ["a settings page with a workspace name and a danger zone", "settings", null],
  ["a searchable list of records with a detail panel", "list-detail", null],
  ["an onboarding flow with steps and a skip button", "onboarding", "add-growth"],
  ["a 404 not found page", "error-page", null],
  ["an empty page with an icon and a button", "empty-page", null],
]
for (const [description, block, recipe] of FIXTURES) {
  const p = planPage(INDEX, description, "web")
  ok(`"${description}": block ${block}`, p.blocks[0]?.name === block, p.blocks)
  ok(`"${description}": recipe ${recipe}`, p.recipe === recipe, p.recipe)
}

const web = planPage(INDEX, "a pricing page with monthly and yearly plans", "web")
ok(
  "keys come in the documented order",
  Object.keys(web).join() === "target,recipe,blocks,components,modules,data,files,next",
  Object.keys(web),
)
ok(
  "web: the add command, the block's own components, no modules",
  web.blocks[0]?.command === "npx @dapplelight/signet-cli add block pricing" &&
    web.components.some((c) => c.name === "tabs" && c.importPath.endsWith("/components/tabs")) &&
    !web.components.some((c) => c.name === "utils") &&
    web.modules.length === 0,
  web,
)
ok(
  "web: every file has a path and a purpose",
  web.files.length >= 3 && web.files.every((f) => f.path && f.purpose),
  web.files,
)
ok(
  "web: next points at get_component, recipe and check_app",
  web.next.join("|") === 'get_component({ name: "badge" })|recipe({ task: "add-plans" })|check_app',
  web.next,
)

const api = planPage(INDEX, "a pricing page with monthly and yearly plans", "api")
ok(
  "api: blocks and components are empty, modules exist in the index",
  api.blocks.length === 0 &&
    api.components.length === 0 &&
    api.modules.length > 0 &&
    api.modules.every((m) => INDEX.exports.some((e) => e.path === m)),
  api,
)
const full = planPage(INDEX, "a pricing page with monthly and yearly plans", "full")
ok(
  "full: block and modules both",
  full.blocks.length === 1 && full.modules.length > 0 && full.files.length > web.files.length,
  full,
)

for (const t of ["web", "api", "full"] as PlanTarget[]) {
  const none = planPage(INDEX, "zzzz qqqq", t)
  ok(
    `no match (${t}): every key, all empty, with a hint`,
    Object.keys(none).join() === "target,recipe,blocks,components,modules,data,files,next,hint" &&
      none.recipe === null &&
      [none.blocks, none.components, none.modules, none.data, none.files, none.next].every(
        (a) => a.length === 0,
      ) &&
      none.hint === "No block matches. Try compose_component for the parts, or search_docs.",
    none,
  )
}

const once = JSON.stringify(planPage(INDEX, "a settings page", "full"))
const again = JSON.stringify(planPage(INDEX, "a settings page", "full"))
ok("same description, same plan", once === again)
ok(
  "a long description is read whole",
  planPage(INDEX, `${"filler words here ".repeat(500)} pricing plans`, "web").blocks[0]?.name ===
    "pricing",
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
