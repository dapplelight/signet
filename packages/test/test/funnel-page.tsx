/**
 * The hosted funnel page's script, run in happy-dom against a stubbed API:
 * questions post step views, the URL code reaches the config and checkout,
 * a redirect checkout sends the buyer to the gateway, and back from it the
 * page polls the session until it shows the redemption link and code.
 * Run as a script (not under bun test) because it registers DOM globals.
 */

import { funnelPage } from "@dapplelight/signet-server/http/funnels"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register({ url: "https://pay.example.test/f/spring?code=TEN" })

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

const calls: { method: string; path: string; body?: unknown; visitor: string | null }[] = []
let sessionReads = 0
globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
  const url = new URL(input, location.href)
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  const headers = new Headers(init.headers)
  calls.push({
    method: init.method ?? "GET",
    path: url.pathname + url.search,
    body,
    visitor: headers.get("x-signet-anonymous-id"),
  })
  const json = (v: unknown, status = 200) => Response.json(v, { status })
  if (url.pathname === "/f/spring/config")
    return json({
      funnel: {
        key: "spring",
        questions: [
          { id: "goal", title: "Your goal?", options: [{ value: "sleep", label: "Sleep" }] },
        ],
      },
      offering: {
        paywall: { title: "Pick a plan" },
        products: [
          {
            id: "price_pro",
            store: "web",
            plan: "pro",
            interval: "month",
            price: { amount: 2000, currency: "USD" },
          },
        ],
      },
      discounts: {
        price_pro: { valid: true, code: "TEN", off: 200, amount: 1800, currency: "USD" },
      },
    })
  if (url.pathname === "/f/spring/events") return new Response(null, { status: 204 })
  if (url.pathname === "/f/spring/checkout")
    return json(
      {
        session: { id: "fs_1", amount: 1800, currency: "USD" },
        checkout: { gateway: "paddle", gatewayId: "x", url: "https://gateway.example.test/pay/x" },
      },
      201,
    )
  if (url.pathname === "/f/sessions/fs_1") {
    sessionReads++
    return sessionReads < 2
      ? json({ session: { id: "fs_1", status: "open" } })
      : json({
          session: { id: "fs_1", status: "paid" },
          redemption: { link: "example://redeem?token=t.s", token: "t.s" },
        })
  }
  return json({ error: "nope" }, 404)
}) as typeof fetch

const assigned: string[] = []
const realAssign = location.assign.bind(location)
location.assign = (u: string | URL) => {
  assigned.push(String(u))
}

const html = funnelPage({ key: "spring", title: "Spring", nonce: "n" })
const script = /<script nonce="n">([\s\S]*)<\/script><\/body>/.exec(html)?.[1] ?? ""
const cfg = /<script id="cfg" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ""
const run = () => {
  document.body.innerHTML = `<main id="app"></main><script id="cfg" type="application/json">${cfg}</script>`
  new Function(script)()
}
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as
    | HTMLButtonElement
    | undefined

run()
await tick()
ok("config read with the URL code", calls[0]?.path === "/f/spring/config?code=TEN", calls[0])
ok("question shown", document.querySelector("h1")?.textContent === "Your goal?")
button("Sleep")?.click()
await tick()
ok(
  "plan picker with the discounted price",
  (button("pro")?.textContent ?? "").includes("$18.00"),
  button("pro")?.textContent,
)
button("pro")?.click()
await tick()
const email = document.querySelector("input[type=email]") as HTMLInputElement
email.value = "b@example.test"
const coupon = document.querySelectorAll("input")[1] as HTMLInputElement
ok("code prefilled from the URL", coupon.value === "TEN")
;(document.querySelector("form") as HTMLFormElement).requestSubmit()
await tick()
const co = calls.find((c) => c.path === "/f/spring/checkout")
ok(
  "checkout sends product, answers, email and code, never a price",
  JSON.stringify(co?.body) ===
    JSON.stringify({
      productId: "price_pro",
      answers: { goal: "sleep" },
      email: "b@example.test",
      code: "TEN",
    }),
  co?.body,
)
ok(
  "redirect checkout goes to the gateway",
  assigned[0] === "https://gateway.example.test/pay/x",
  assigned,
)
ok(
  "step views posted in order",
  calls
    .filter((c) => c.path === "/f/spring/events")
    .map((c) => (c.body as { step: string }).step)
    .join() === "goal,plans,checkout",
)
const visitors = new Set(calls.map((c) => c.visitor))
ok(
  "one visitor id on every call",
  visitors.size === 1 && /^v_/.test([...visitors][0] ?? ""),
  visitors,
)

// Back from the gateway.
const happy = (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM
happy.setURL("https://pay.example.test/f/spring?session=fs_1")
run()
await tick(2300)
const link = document.querySelector("a") as HTMLAnchorElement | null
ok(
  "polls until paid, then links the app",
  link?.getAttribute("href") === "example://redeem?token=t.s" && sessionReads === 2,
  sessionReads,
)
ok("shows the code to paste", document.querySelector("code")?.textContent === "t.s")

location.assign = realAssign
console.log(`\n${pass} passed, ${fail} failed`)
await GlobalRegistrator.unregister()
process.exit(fail ? 1 : 0)
