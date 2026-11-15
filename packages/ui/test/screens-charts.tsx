/**
 * Subscription charts and offers: the charts screen shows the summary, one
 * chart per metric, filters and audiences as callbacks and the CSV link; the
 * remote paywall shows the customer's offer, hands it to checkout and logs one
 * impression per offering version; the promotional grant form sends its grant.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { SubscriptionCharts } = await import("../src/components/screens/subscription-charts")
const { RemotePaywall, PromotionalGrantForm, CustomerTimeline } = await import(
  "../src/components/screens/monetisation-screens"
)

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

const day = (d: string, o: object = {}) => ({
  day: d,
  activeSubscribers: 2,
  activeTrials: 1,
  mrr: { INR: 10000, USD: 499 },
  mrrTotal: 619,
  newRevenue: { USD: 499 },
  renewalRevenue: {},
  refunds: {},
  refundCount: 0,
  newSubscriptions: 1,
  trialsStarted: 0,
  trialConversions: 1,
  churned: 0,
  impressions: 3,
  conversions: 1,
  ...o,
})
const DATA = {
  from: "2026-03-01",
  to: "2026-03-02",
  currencies: ["INR", "USD"],
  base: "USD",
  approximate: true,
  days: [day("2026-03-01"), day("2026-03-02", { churned: 1 })],
  summary: {
    mrr: { INR: 10000, USD: 499 },
    mrrTotal: 619,
    activeSubscribers: 2,
    activeTrials: 1,
    newRevenue: { USD: 998 },
    renewalRevenue: {},
    refunds: {},
    refundCount: 0,
    trialConversion: 0.5,
    churnRate: 0.25,
    impressions: 6,
    conversions: 2,
    paywallConversion: 1 / 3,
  },
}

await t("SubscriptionCharts: summary, charts, filters, audiences, CSV", async () => {
  const changes: unknown[] = []
  const saved: unknown[] = []
  const filter = { from: "2026-03-01", to: "2026-03-02", store: "appstore" }
  render(
    <SubscriptionCharts
      data={DATA}
      filter={filter}
      onFilterChange={(f) => changes.push(f)}
      options={{ stores: ["appstore", "googleplay", "web"], countries: ["IN", "US"] }}
      audiences={[{ id: "a1", name: "India", filter: { country: "IN" } }]}
      onSaveAudience={(name, f) => saved.push({ name, f })}
      csvHref="/api/admin/billing/charts/csv?from=2026-03-01&to=2026-03-02"
    />,
  )
  await tick()
  const text = document.body.textContent ?? ""
  ok("MRR per currency in the summary", text.includes("₹100") && text.includes("$4.99"))
  ok("converted MRR total", text.includes("MRR total (USD)"))
  ok("rates as percentages", text.includes("50%") && text.includes("25%") && text.includes("33%"))
  ok("approximate note", text.includes("Includes App Store prices"))
  for (const slot of [
    "chart-mrr",
    "chart-subscribers",
    "chart-revenue",
    "chart-churn",
    "chart-paywall",
  ])
    ok(`${slot} rendered`, !!document.querySelector(`[data-slot=${slot}] [data-slot=chart]`))
  ok("no select for a filter without options", !document.querySelector("[data-filter=plan]"))
  await userEvent.selectOptions(
    document.querySelector("[data-filter=country]") as HTMLElement,
    "IN",
  )
  ok(
    "a filter change keeps the rest",
    JSON.stringify(changes.at(-1)) === JSON.stringify({ ...filter, country: "IN" }),
    changes.at(-1),
  )
  await userEvent.selectOptions(document.querySelector("[data-filter=store]") as HTMLElement, "")
  ok("All clears a filter", (changes.at(-1) as { store?: string }).store === undefined)
  await userEvent.selectOptions(
    document.querySelector("[data-filter=audience]") as HTMLElement,
    "a1",
  )
  ok("choosing an audience", (changes.at(-1) as { audience?: string }).audience === "a1")
  await userEvent.click(screen.getByRole("button", { name: "Save as audience" }))
  await userEvent.type(screen.getByLabelText("Audience name"), "Apple")
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  ok(
    "save the current filters as an audience",
    JSON.stringify(saved[0]) === JSON.stringify({ name: "Apple", f: { store: "appstore" } }),
    saved,
  )
  const link = document.querySelector("[data-slot=charts-export]") as HTMLAnchorElement
  ok(
    "CSV link",
    link?.getAttribute("href")?.includes("/charts/csv") === true && link.hasAttribute("download"),
  )
})

await t("SubscriptionCharts: empty data", async () => {
  render(
    <SubscriptionCharts
      data={{ ...DATA, days: [] }}
      filter={{ from: "2026-03-01", to: "2026-03-02" }}
      onFilterChange={() => {}}
    />,
  )
  ok("empty message", !!screen.getByText("No data for this range"))
  ok("no save button without onSaveAudience", !screen.queryByText("Save as audience"))
})

const OFFERING = {
  key: "default",
  version: 2,
  products: [
    {
      id: "price_pro_m",
      store: "web" as const,
      plan: "pro",
      interval: "month" as const,
      price: { amount: 49900, currency: "INR" },
      offers: [{ id: "trial7", type: "free_trial" as const, days: 7 }],
    },
  ],
  paywall: { title: "Go pro", trial: "Static trial text" },
}

await t(
  "RemotePaywall: the customer's offer, sent to checkout; one impression per version",
  async () => {
    const seen: string[] = []
    const bought: unknown[] = []
    const onImpression = (o: { key: string; version: number }) => seen.push(`${o.key}@${o.version}`)
    const { rerender } = render(
      <RemotePaywall
        offering={OFFERING}
        onImpression={onImpression}
        onPurchase={(p, _plan, _i, offer) => bought.push([p.id, offer?.id])}
      />,
    )
    await tick()
    const offer = document.querySelector("[data-slot=paywall-offer]")
    ok(
      "offer line replaces the static trial text",
      offer?.getAttribute("data-offer") === "trial7" &&
        offer.textContent === "Try it free for 7 days" &&
        !screen.queryByText("Static trial text"),
    )
    await userEvent.click(screen.getByRole("button", { name: /Continue with/ }))
    await waitFor(() => {
      if (!bought.length) throw new Error("not bought")
    })
    ok(
      "checkout gets the offer",
      JSON.stringify(bought[0]) === JSON.stringify(["price_pro_m", "trial7"]),
    )
    rerender(<RemotePaywall offering={{ ...OFFERING }} onImpression={onImpression} />)
    await tick()
    ok(
      "re-render: still one impression",
      JSON.stringify(seen) === JSON.stringify(["default@2"]),
      seen,
    )
    rerender(<RemotePaywall offering={{ ...OFFERING, version: 3 }} onImpression={onImpression} />)
    await tick()
    ok("a new version is a new impression", seen.length === 2, seen)
    rerender(
      <RemotePaywall
        offering={{ ...OFFERING, products: OFFERING.products.map(({ offers: _o, ...p }) => p) }}
      />,
    )
    ok("no offer: the static trial text", !!screen.getByText("Static trial text"))
  },
)

await t("PromotionalGrantForm and new timeline kinds", async () => {
  const grants: unknown[] = []
  render(<PromotionalGrantForm plans={["pro", "team"]} onGrant={(g) => grants.push(g)} />)
  await userEvent.selectOptions(screen.getByLabelText("Plan"), "team")
  await userEvent.clear(screen.getByLabelText("Days"))
  await userEvent.type(screen.getByLabelText("Days"), "14")
  await userEvent.type(screen.getByLabelText("Note"), "Beta")
  await userEvent.click(screen.getByRole("button", { name: "Grant" }))
  await waitFor(() => {
    if (!grants.length) throw new Error("no grant")
  })
  ok(
    "sends plan, days and note",
    JSON.stringify(grants[0]) === JSON.stringify({ plan: "team", days: 14, note: "Beta" }),
    grants,
  )
  await waitFor(() => {
    if (!screen.queryByText("Granted.")) throw new Error("no message")
  })
  ok("says it worked", true)
  cleanup()
  render(
    <CustomerTimeline
      entries={[
        {
          id: "1",
          kind: "promotional",
          gateway: "promotional",
          eventType: "x",
          occurredAt: "2026-03-01",
        },
        { id: "2", kind: "trial", gateway: "appstore", eventType: "x", occurredAt: "2026-03-01" },
        {
          id: "3",
          kind: "refund_request",
          gateway: "appstore",
          eventType: "x",
          occurredAt: "2026-03-01",
        },
      ]}
    />,
  )
  const t2 = document.body.textContent ?? ""
  ok(
    "timeline names the new kinds",
    t2.includes("Promotional plan") && t2.includes("Free trial") && t2.includes("Refund requested"),
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
