/**
 * Monetisation screens: the remote paywall renders the server's copy, plans,
 * highlight, trial text and per-store prices and buys the matching product;
 * the Customer Center shows the renewal date, offers retention before
 * cancelling, links store subscriptions to the store, and sends refund and
 * support messages; the admin timeline shows each kind and the ledger totals.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { CustomerCenter, CustomerTimeline, RemotePaywall, plansFromOffering } = await import(
  "../src/components/screens/monetisation-screens"
)

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const must = (n: string, c: boolean, d: unknown = "") => {
  if (!c) throw new Error(`${n} ${JSON.stringify(d)}`)
  ok(n, c)
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

const OFFERING = {
  key: "default",
  version: 3,
  products: [
    {
      id: "pro.monthly",
      store: "appstore",
      plan: "pro",
      interval: "month" as const,
      price: { amount: 499, currency: "USD" },
    },
    {
      id: "price_pro_m",
      store: "web",
      plan: "pro",
      interval: "month" as const,
      price: { amount: 49900, currency: "INR" },
    },
    {
      id: "price_pro_y",
      store: "web",
      plan: "pro",
      interval: "year" as const,
      price: { amount: 499000, currency: "INR" },
    },
    {
      id: "price_team_y",
      store: "web",
      plan: "team",
      interval: "year" as const,
      price: { amount: 999900, currency: "INR" },
    },
  ],
  paywall: {
    title: "Unlock everything",
    subtitle: "Cancel any time",
    plans: ["team", "pro"],
    highlight: "pro",
    badge: "Most popular",
    trial: "7 days free, then billed",
    cta: "Start free trial",
  },
}

await t("plansFromOffering", () => {
  const web = plansFromOffering(OFFERING, "web", {
    team: { name: "Team", description: "For groups" },
  })
  ok("web: the paywall's order", web.map((p) => p.key).join() === "team,pro", web)
  ok("web: prices per interval from products", web[1]?.prices?.year?.amount === 499000)
  ok("web: display names kept", web[0]?.name === "Team" && web[0]?.description === "For groups")
  ok("web: highlighted plan carries the badge", web[1]?.badge === "Most popular" && !web[0]?.badge)
  const apple = plansFromOffering(OFFERING, "appstore")
  ok(
    "appstore: only plans sold there, store price",
    apple.length === 1 && apple[0]?.prices?.month?.amount === 499,
  )
})

await t("RemotePaywall: server copy, highlight, trial, buys the product", async () => {
  const bought: string[] = []
  render(
    <RemotePaywall
      offering={OFFERING}
      onPurchase={async (product, plan, interval) => {
        bought.push(`${product.id}:${plan.key}:${interval}`)
      }}
    />,
  )
  await tick()
  ok(
    "title and subtitle from the server",
    !!screen.getByRole("heading", { name: "Unlock everything" }) &&
      !!screen.getByText("Cancel any time"),
  )
  ok("trial text shown", !!screen.getByText("7 days free, then billed"))
  ok(
    "offering and version as data-*",
    !!document.querySelector("[data-slot=remote-paywall][data-offering=default][data-version='3']"),
  )
  const group = screen.getByRole("radiogroup", { name: "Plans" })
  const radios = within(group).getAllByRole("radio")
  must(
    "highlighted plan preselected",
    screen.getByRole("radio", { name: "Pro" }).getAttribute("aria-checked") === "true",
  )
  ok("badge on the highlighted plan", group.textContent?.includes("Most popular") ?? false)
  ok("monthly first: team (yearly only) hidden", radios.length === 1)
  await userEvent.click(screen.getByRole("button", { name: "Start free trial" }))
  await waitFor(() =>
    must("buys the web monthly product", bought[0] === "price_pro_m:pro:month", bought),
  )
  await userEvent.click(
    within(screen.getByRole("radiogroup", { name: "Billing period" })).getByText("Yearly"),
  )
  await userEvent.click(screen.getByRole("radio", { name: "Team" }))
  await userEvent.click(screen.getByRole("button", { name: "Start free trial" }))
  await waitFor(() => must("yearly team product", bought[1] === "price_team_y:team:year", bought))
})

await t("RemotePaywall: store build shows store prices and Restore", async () => {
  let restored = 0
  render(
    <RemotePaywall
      offering={{ ...OFFERING, paywall: null }}
      source="appstore"
      onRestore={() => {
        restored++
        return true
      }}
    />,
  )
  await tick()
  ok("default title when the server sets none", !!screen.getByRole("heading", { name: "Upgrade" }))
  ok(
    "store price",
    screen.getByRole("radiogroup", { name: "Plans" }).textContent?.includes("$4.99") ?? false,
  )
  await userEvent.click(screen.getByRole("button", { name: "Restore purchases" }))
  ok("restore", restored === 1)
})

const WEB = {
  plan: "pro",
  status: "active",
  currentPeriodEnd: "2026-12-15T00:00:00.000Z",
  renews: true,
  source: { gateway: "stripe", subscriptionId: "sub_1" },
  store: false,
  manageUrl: null,
  canCancel: true,
  retention: { kind: "discount" as const, percent: 50, months: 3 },
}

await t("CustomerCenter: renewal date, retention offer before cancel", async () => {
  const calls: string[] = []
  render(
    <CustomerCenter
      overview={WEB}
      onCancel={() => calls.push("cancel")}
      onAcceptRetention={() => calls.push("retention")}
    />,
  )
  ok("renewal date", !!document.querySelector("time[datetime='2026-12-15T00:00:00.000Z']"))
  await userEvent.click(screen.getByRole("button", { name: "Cancel subscription" }))
  ok(
    "cancel first shows the offer, cancels nothing",
    calls.length === 0 && !!screen.getByText("Stay and get 50% off for 3 months."),
  )
  await userEvent.click(screen.getByRole("button", { name: "Accept offer" }))
  await waitFor(() => must("offer accepted", calls.join() === "retention", calls))
  ok(
    "acceptance announced",
    screen.getByText("Offer applied. Thanks for staying.").getAttribute("role") === "status",
  )
  ok("cancel gone after accepting", !screen.queryByRole("button", { name: /cancel/i }))
})

await t("CustomerCenter: decline the offer and cancel; failure is announced", async () => {
  let n = 0
  render(<CustomerCenter overview={WEB} onCancel={() => n++ > 0} onAcceptRetention={() => {}} />)
  await userEvent.click(screen.getByRole("button", { name: "Cancel subscription" }))
  await userEvent.click(screen.getByRole("button", { name: "No thanks, cancel" }))
  await waitFor(() => must("a failed cancel is announced", !!screen.getByText(/Could not cancel/)))
  await userEvent.click(screen.getByRole("button", { name: "No thanks, cancel" }))
  await waitFor(() => must("then cancelled", !!screen.getByText(/Your subscription is cancelled/)))
})

await t("CustomerCenter: store subscription links to the store, no cancel button", () => {
  render(
    <CustomerCenter
      overview={{
        ...WEB,
        source: { gateway: "appstore", subscriptionId: "2000001" },
        store: true,
        canCancel: false,
        retention: null,
        manageUrl: "https://apps.apple.com/account/subscriptions",
      }}
      onCancel={() => true}
    />,
  )
  const link = screen.getByRole("link", { name: "Manage in App Store" })
  ok("manage link", link.getAttribute("href") === "https://apps.apple.com/account/subscriptions")
  ok("no cancel button for a store", !screen.queryByRole("button", { name: "Cancel subscription" }))
})

await t("CustomerCenter: refund request and support message", async () => {
  const sent: string[] = []
  render(
    <CustomerCenter
      overview={{ ...WEB, retention: null }}
      onRequestRefund={(r) => sent.push(`refund:${r}`)}
      onContactSupport={(m) => sent.push(`support:${m}`)}
    />,
  )
  await userEvent.type(screen.getByLabelText("What went wrong?"), "Charged twice")
  await userEvent.click(screen.getByRole("button", { name: "Send request" }))
  await waitFor(() => must("refund sent with the reason", sent[0] === "refund:Charged twice", sent))
  ok(
    "refund field cleared",
    (screen.getByLabelText("What went wrong?") as HTMLTextAreaElement).value === "",
  )
  await userEvent.type(screen.getByLabelText("How can we help?"), "Where is my invoice?")
  await userEvent.click(screen.getByRole("button", { name: "Send message" }))
  await waitFor(() => must("support sent", sent[1] === "support:Where is my invoice?", sent))
  ok("sent announced", !!screen.getByText("Message sent. We will get back to you."))
})

await t("CustomerTimeline: kinds, stores, amounts and ledger totals", () => {
  render(
    <CustomerTimeline
      entries={[
        {
          id: "a|3",
          kind: "refund",
          gateway: "appstore",
          eventType: "REFUND",
          amount: 499,
          currency: "USD",
          approximate: true,
          occurredAt: "2026-12-02T00:00:00Z",
        },
        {
          id: "g|2",
          kind: "grace_period",
          gateway: "googleplay",
          eventType: "subscription.6",
          occurredAt: "2026-11-20T00:00:00Z",
        },
        {
          id: "s|1",
          kind: "purchase",
          gateway: "stripe",
          eventType: "invoice.paid",
          amount: 49900,
          currency: "INR",
          paymentId: "pi_1",
          occurredAt: "2026-11-01T00:00:00Z",
        },
      ]}
      totals={[{ currency: "INR", paid: 49900, refunded: 0, approximate: false }]}
    />,
  )
  const items = document.querySelectorAll("[data-slot=customer-timeline] [data-kind]")
  ok("one item per entry", items.length === 3)
  ok(
    "kind labels",
    !!screen.getByText("Refund") &&
      !!screen.getByText("Grace period") &&
      !!screen.getByText("Purchase"),
  )
  ok("store names", !!screen.getByText("App Store") && !!screen.getByText("Google Play"))
  ok(
    "totals from the ledger",
    document.querySelector("[data-slot=timeline-totals]")?.textContent?.includes("499") ?? false,
  )
  ok(
    "kind as data-*",
    !!document.querySelector("[data-kind=grace_period][data-gateway=googleplay]"),
  )
})

await t("CustomerTimeline: empty and relabelled", () => {
  render(<CustomerTimeline entries={[]} labels={{ noEvents: "Nada" }} />)
  ok("empty state", !!screen.getByText("Nada"))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
