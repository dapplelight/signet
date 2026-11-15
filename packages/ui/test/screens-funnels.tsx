/**
 * Funnel screens: questions (single answers advance, multiple wait for
 * Continue), the paywall with the URL discount priced in, the checkout form
 * sending answers, email and code, step views for analytics, Stripe's
 * Express Checkout mounted from a runtime-loaded Stripe (stubbed here), and
 * the redemption card in each session state.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { WebFunnel, ExpressCheckout, FunnelRedemption, discountedOffering, loadScript } =
  await import("../src/components/screens/funnel-screens")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (e) {
    ok(`${name} (threw: ${(e as Error).message.split("\n")[0]})`, false)
  } finally {
    cleanup()
  }
}
const tick = () => new Promise((r) => setTimeout(r, 20))

const PAGE = {
  funnel: {
    key: "spring",
    title: "Sleep better",
    questions: [
      {
        id: "goal",
        title: "Your goal?",
        options: [
          { value: "focus", label: "Focus" },
          { value: "sleep", label: "Sleep" },
        ],
      },
      {
        id: "topics",
        title: "Pick topics",
        multiple: true,
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ],
      },
    ],
  },
  offering: {
    key: "web",
    version: 1,
    paywall: { title: "Choose a plan", highlight: "pro" },
    products: [
      {
        id: "price_pro_m",
        store: "web",
        plan: "pro",
        interval: "month" as const,
        price: { amount: 1000, currency: "USD" },
      },
    ],
  },
  discounts: {
    price_pro_m: { valid: true as const, code: "TEN", off: 100, amount: 900, currency: "USD" },
  },
}

await t("discountedOffering prices valid discounts in, leaves others", () => {
  const o = discountedOffering(PAGE.offering, PAGE.discounts)
  ok("discounted", o.products[0]?.price?.amount === 900)
  const none = discountedOffering(PAGE.offering, {
    price_pro_m: { valid: false, code: "X", reason: "expired" },
  })
  ok("refused code leaves the price", none.products[0]?.price?.amount === 1000)
})

await t("WebFunnel: questions, discounted paywall, checkout, step views", async () => {
  const steps: string[] = []
  const sent: unknown[] = []
  render(
    <WebFunnel
      page={PAGE}
      code="TEN"
      onStep={(s) => steps.push(s)}
      onCheckout={async (r) => {
        sent.push(r)
        return { clientSecret: "cs_1" }
      }}
      renderCheckout={(r) => <p>checkout {(r as { clientSecret: string }).clientSecret}</p>}
    />,
  )
  ok("title shown", !!screen.getByRole("heading", { name: "Sleep better" }))
  await userEvent.click(screen.getByRole("button", { name: "Sleep" }))
  ok("single choice advances", !!screen.getByText("Pick topics"))
  const cont = screen.getByRole("button", { name: "Continue" })
  ok("multiple waits for a pick", (cont as HTMLButtonElement).disabled)
  await userEvent.click(screen.getByRole("button", { name: "Alpha" }))
  await userEvent.click(screen.getByRole("button", { name: "Beta" }))
  ok(
    "toggles are pressed",
    screen.getByRole("button", { name: "Beta" }).getAttribute("aria-pressed") === "true",
  )
  await userEvent.click(screen.getByRole("button", { name: "Continue" }))
  await tick()
  ok("paywall from the offering", !!screen.getByRole("heading", { name: "Choose a plan" }))
  ok(
    "discounted price shown",
    document.body.textContent?.includes("$9") ?? false,
    document.body.textContent,
  )
  await userEvent.click(screen.getByRole("button", { name: /Continue with/ }))
  ok("discount note in checkout", !!screen.getByText("$1 off"))
  await userEvent.type(screen.getByLabelText("Email for your receipt"), "b@example.test")
  await userEvent.click(screen.getByRole("button", { name: "Go to payment" }))
  await waitFor(() => screen.getByText("checkout cs_1"))
  ok(
    "checkout gets product, answers, email and code",
    JSON.stringify(sent[0]) ===
      JSON.stringify({
        product: PAGE.offering.products[0],
        answers: { goal: "sleep", topics: ["a", "b"] },
        email: "b@example.test",
        code: "TEN",
      }),
    sent[0],
  )
  ok("step views in order", steps.join() === "goal,topics,plans,checkout", steps)
})

await t("WebFunnel: a refused code says why; a failed checkout says so", async () => {
  render(
    <WebFunnel
      page={{
        ...PAGE,
        funnel: { key: "spring" },
        discounts: { price_pro_m: { valid: false, code: "OLD", reason: "expired" } },
      }}
      code="old"
      onCheckout={async () => {
        throw new Error("nope")
      }}
    />,
  )
  await tick()
  await userEvent.click(screen.getByRole("button", { name: /Continue with/ }))
  ok("refusal reason", !!screen.getByText("This code has expired."))
  await userEvent.type(screen.getByLabelText("Email for your receipt"), "b@example.test")
  await userEvent.click(screen.getByRole("button", { name: "Go to payment" }))
  await waitFor(() => screen.getByRole("alert"))
  ok("failure alert", screen.getByRole("alert").textContent === "Something went wrong. Try again.")
})

await t("ExpressCheckout: mounts wallets and card, confirms with the return url", async () => {
  const mounted: string[] = []
  const confirms: unknown[] = []
  let onConfirm: (() => void) | undefined
  const stripe = {
    elements: (o: { clientSecret: string }) => ({
      create: (kind: string) => ({
        mount: () => mounted.push(`${kind}:${o.clientSecret}`),
        on: (_ev: string, fn: () => void) => {
          onConfirm = fn
        },
      }),
      submit: async () => ({}),
    }),
    confirmPayment: async (o: unknown) => {
      confirms.push(o)
      return confirms.length === 1 ? {} : { error: { message: "Card declined" } }
    },
  }
  render(
    <ExpressCheckout
      publishableKey="pk_test_x"
      clientSecret="pi_1_secret"
      returnUrl="https://pay.example.test/f/spring?session=fs_1"
      amount={900}
      currency="USD"
      loadStripe={async () => stripe}
    />,
  )
  await waitFor(() => {
    if (mounted.length < 2) throw new Error("not mounted")
  })
  ok(
    "express checkout and payment element mounted",
    mounted.join() === "expressCheckout:pi_1_secret,payment:pi_1_secret",
    mounted,
  )
  onConfirm?.()
  await tick()
  ok(
    "wallet confirm uses the return url",
    (confirms[0] as { confirmParams: { return_url: string } }).confirmParams.return_url ===
      "https://pay.example.test/f/spring?session=fs_1",
  )
  await userEvent.click(screen.getByRole("button", { name: "Pay $9" }))
  await waitFor(() => screen.getByRole("alert"))
  ok("a decline is shown", screen.getByRole("alert").textContent === "Card declined")
})

await t("loadScript: one tag per src; a failed load can be retried", async () => {
  const src = "https://js.example.test/a.js"
  // Hold appended tags instead of letting happy-dom (which never fetches scripts) settle them.
  const tags: HTMLScriptElement[] = []
  const append = document.head.append
  document.head.append = (...nodes: (Node | string)[]) => {
    tags.push(...(nodes as HTMLScriptElement[]))
  }
  try {
    const a = loadScript(src)
    ok("same promise for the same src", loadScript(src) === a)
    ok("one tag", tags.length === 1 && tags[0]?.src === src)
    tags[0]?.onerror?.(new Event("error"))
    const err = await a.then(
      () => "",
      (e: Error) => e.message,
    )
    ok("rejects with the src", err === `Could not load ${src}`, err)
    const b = loadScript(src)
    ok("a retry starts a new load", b !== a && tags.length === 2)
    tags[1]?.onload?.(new Event("load"))
    await b
    ok("resolves on load, and stays loaded", loadScript(src) === b)
  } finally {
    document.head.append = append
  }
})

await t("FunnelRedemption: waiting, paid with link and code, redeemed, failed", async () => {
  const { rerender } = render(<FunnelRedemption data={null} />)
  ok("waiting", !!screen.getByText("Confirming your payment…"))
  rerender(
    <FunnelRedemption
      data={{
        session: { id: "fs_1", status: "paid" },
        redemption: { link: "example://redeem?token=abc.def", token: "abc.def" },
      }}
    />,
  )
  ok(
    "open app link",
    screen.getByRole("link", { name: "Open the app" }).getAttribute("href") ===
      "example://redeem?token=abc.def",
  )
  ok("code shown", !!screen.getByText("abc.def"))
  rerender(<FunnelRedemption data={{ session: { id: "fs_1", status: "redeemed" } }} />)
  ok("redeemed", !!screen.getByText("This purchase is already unlocked in the app."))
  rerender(<FunnelRedemption data={{ session: { id: "fs_1", status: "failed" } }} />)
  ok("failed", screen.getByRole("alert").textContent === "The payment did not go through.")
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
process.exit(0)
