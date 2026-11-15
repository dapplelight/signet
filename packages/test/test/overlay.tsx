/**
 * The dev overlay in happy-dom, demo mode's routes feeding it, and proof that
 * a production bundle drops it. Own process: happy-dom is registered globally.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react")
await import("react")
await import("@dapplelight/signet-ui/components/theme-provider")
// Load the overlay the way an unbundled browser would: no `process` global.
const savedProcess = globalThis.process
delete (globalThis as { process?: unknown }).process
let unbundledError: unknown = null
const { DevOverlay } = await import("../src/overlay").catch((e) => {
  unbundledError = e
  return { DevOverlay: () => null }
})
globalThis.process = savedProcess
const { createDemo } = await import("../src/demo")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
ok(
  "overlay: loads with no process global (unbundled browser)",
  unbundledError === null,
  unbundledError,
)

// --- demo mode -------------------------------------------------------------
const demo = await createDemo({
  seed: { invoices: [{ id: "inv_1" }] },
  user: { id: "user_1", name: "Test User" },
  plan: "pro",
  entitlements: ["export", "ai"],
  flags: { newDashboard: true },
  start: "2026-11-01T10:00:00Z",
  ai: "demo answer",
})
await demo.senders.email.send(
  "user@example.test",
  { subject: "Your receipt", html: "", text: "", headers: {} },
  { idempotencyKey: "e1" },
)
const dev = await (await demo.handle(new Request("http://app.test/__signet/dev")))?.json()
ok(
  "demo: /__signet/dev has user, plan, flags and outbox",
  dev.user.id === "user_1" &&
    dev.plan === "pro" &&
    dev.flags.newDashboard &&
    dev.outbox[0].rendered.subject === "Your receipt",
  dev,
)

demo.data.invoices.push({ id: "inv_2" })
await demo.handle(new Request("http://app.test/__signet/reset", { method: "POST" }))
ok(
  "demo: reset restores the seed and empties the outbox",
  demo.data.invoices.length === 1 && demo.outbox.messages.length === 0,
)

await demo.handle(
  new Request("http://app.test/__signet/seed", {
    method: "POST",
    body: JSON.stringify({ invoices: [] }),
  }),
)
ok("demo: seed replaces the data", demo.data.invoices.length === 0)

const c = await demo.payments.checkout({
  amount: 49900,
  currency: "INR",
  idempotencyKey: "k1",
  userId: "user_1",
})
const paid = await demo.handle(
  new Request("http://app.test/__signet/pay", {
    method: "POST",
    body: JSON.stringify({ gateway: "razorpay", checkoutId: c.gatewayId }),
  }),
)
const pid = [...demo.gateways.razorpay.state.payments.keys()][0] as string
ok(
  "demo: /__signet/pay completes a checkout through the signed webhook",
  paid?.status === 200 && demo.payments.gateways.length === 3 && pid.startsWith("pay_"),
)
ok(
  "demo: other paths fall through",
  (await demo.handle(new Request("http://app.test/api/x"))) === null,
)
ok("demo: the fake model is wired", demo.model?.modelId === "fake-1")
ok(
  "demo: clock starts where asked",
  new Date(demo.clock.now()).toISOString() === "2026-11-01T10:00:00.000Z",
)

// A full reset: gateways, payments store, notify store and clock start over.
demo.clock.advance(3_600_000)
await demo.notifyStore.addInbox("user_1", {
  id: "i1",
  event: "e",
  category: "c",
  title: "t",
  body: "b",
  createdAt: "",
})
await demo.handle(new Request("http://app.test/__signet/reset", { method: "POST" }))
ok(
  "demo: reset empties gateways, payments, notify store and rewinds the clock",
  demo.gateways.razorpay.state.payments.size === 0 &&
    (await demo.paymentsStore.balance("revenue", "INR")) === 0 &&
    demo.notifyStore.inboxes.size === 0 &&
    new Date(demo.clock.now()).toISOString() === "2026-11-01T10:00:00.000Z",
)
const again = await demo.payments.checkout({
  amount: 49900,
  currency: "INR",
  idempotencyKey: "k1",
  userId: "user_1",
})
ok("demo: the same idempotency key is fresh after reset", again.gatewayId !== c.gatewayId)

let refused = false
try {
  await createDemo({ appEnv: "production" })
} catch {
  refused = true
}
ok("demo: refuses production without allowProduction", refused)

// --- overlay ---------------------------------------------------------------
globalThis.fetch = (async (url: string) => {
  const r = await demo.handle(new Request(new URL(url, "http://app.test")))
  return r ?? new Response("", { status: 404 })
}) as typeof fetch
await demo.senders.sms.send("+15550100", { text: "Code 123456" }, { idempotencyKey: "s1" })

render(<DevOverlay />)
ok("overlay: starts collapsed", !!screen.getByRole("button", { name: "Open Signet dev overlay" }))
await act(async () => {
  fireEvent.click(screen.getByRole("button", { name: "Open Signet dev overlay" }))
  await new Promise((r) => setTimeout(r, 10))
})
const text = document.body.textContent ?? ""
ok(
  "overlay: shows user, plan, entitlements and flags from /__signet/dev",
  ["Test User", "pro", "export, ai", "newDashboard"].every((t) => text.includes(t)),
  text,
)
ok("overlay: shows the outbox", text.includes("Outbox (1)") && text.includes("Code 123456"), text)
ok("overlay: demo badge", text.includes("demo"))

fireEvent.click(screen.getByRole("button", { name: "Light" }))
ok(
  "overlay: light/dark toggles the .dark class",
  document.documentElement.classList.contains("dark"),
)
cleanup()

const picked: string[] = []
render(
  <DevOverlay
    defaultOpen
    state={{ user: null, flags: {} }}
    themes={["editorial", "cinematic", "finance"]}
    theme="editorial"
    onThemeChange={(t) => picked.push(t)}
  />,
)
fireEvent.click(screen.getByRole("button", { name: "cinematic" }))
ok("overlay: theme buttons call onThemeChange", picked[0] === "cinematic")
ok(
  "overlay: given state, signed out, nothing sent",
  (document.body.textContent ?? "").includes("Signed out") &&
    (document.body.textContent ?? "").includes("Nothing sent"),
)
ok(
  "overlay: active theme is pressed",
  screen.getByRole("button", { name: "editorial" }).getAttribute("aria-pressed") === "true",
)
cleanup()

// --- enabled + production strip ------------------------------------------
render(<DevOverlay enabled={false} defaultOpen state={{ plan: "pro" }} />)
ok(
  "overlay: enabled={false} renders nothing",
  document.querySelector("[data-signet-dev-overlay]") === null,
)
cleanup()

// The package by name, through its exports map (dist/, built by build:all).
const entry = `${import.meta.dir}/fixtures/uses-overlay.tsx`
const bundle = async (conditions: string[], define?: Record<string, string>) => {
  const out = await Bun.build({
    entrypoints: [entry],
    conditions,
    define,
    minify: true,
    target: "browser",
    external: ["react", "react/jsx-runtime", "@dapplelight/signet-ui/*"],
  })
  if (!out.success) throw new AggregateError(out.logs)
  return (await out.outputs[0]?.text()) ?? ""
}
const prod = await bundle(["production"])
const devBundle = await bundle(["development"])
ok("production strip: a development build has the panel", devBundle.includes("Signet dev overlay"))
ok(
  "production strip: a production build has none of it",
  !prod.includes("Signet dev overlay") &&
    !prod.includes("__signet/dev") &&
    !prod.includes("signet-ui"),
  prod,
)
// A bundler without the export condition but with a NODE_ENV define (the
// old webpack/rollup replace setup): in a browser with no `process`, the
// overlay still renders nothing.
const defined = await bundle(["development"], { "process.env.NODE_ENV": '"production"' })
const definedFile = `${import.meta.dir}/fixtures/.defined-${Date.now()}.js`
await Bun.write(definedFile, defined)
const keepProcess = globalThis.process
delete (globalThis as { process?: unknown }).process
let definedResult: unknown = "not run"
try {
  const m = await import(definedFile)
  definedResult = (m as { DevOverlay: (p: object) => unknown }).DevOverlay({})
} finally {
  globalThis.process = keepProcess
  await Bun.file(definedFile).delete()
}
ok(
  "production strip: a NODE_ENV define alone renders nothing in a browser",
  definedResult === null,
  definedResult,
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
