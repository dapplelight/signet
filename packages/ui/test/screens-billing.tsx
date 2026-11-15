/**
 * Billing screens: plan picker (radio keyboard, intervals, store filtering,
 * subscribe), current plan, restore, usage meters, invoices, wallet, labels
 * and classNames.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { useState } = await import("react")
const {
  BillingScreen,
  CurrentPlanCard,
  InvoiceList,
  Paywall,
  PlanPicker,
  UsageMeters,
  WalletCard,
  formatMoney,
  plansFromEntitlements,
} = await import("../src/components/screens/billing-screens")

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

const PLANS = plansFromEntitlements(
  {
    free: { limits: { projects: 3 } },
    pro: { features: ["export"], limits: { projects: 50 } },
    team: { features: ["export", "sso"], limits: { projects: Number.POSITIVE_INFINITY } },
  },
  {
    free: { name: "Free", prices: { month: { amount: 0, currency: "INR" } } },
    pro: {
      name: "Pro",
      badge: "Popular",
      prices: {
        month: { amount: 49900, currency: "INR" },
        year: { amount: 499000, currency: "INR" },
      },
    },
    team: {
      name: "Team",
      sources: ["web"],
      prices: {
        month: { amount: 149900, currency: "INR" },
        year: { amount: 1499000, currency: "INR" },
      },
    },
  },
)

await t("plansFromEntitlements and formatMoney", () => {
  ok("plans keep declaration order", PLANS.map((p) => p.key).join() === "free,pro,team")
  ok(
    "features and limits come from the definition",
    PLANS[1]?.features?.[0] === "export" && PLANS[1]?.limits?.projects === 50,
  )
  ok(
    "formatMoney: minor units, whole amounts drop decimals",
    formatMoney(49900, "INR").includes("499") && !formatMoney(49900, "INR").includes(".00"),
  )
  ok("formatMoney: keeps real decimals", formatMoney(1999, "USD").includes("19.99"))
})

await t("PlanPicker: radio cards, keyboard, subscribe", async () => {
  const subs: string[] = []
  render(
    <PlanPicker
      plans={PLANS}
      currentPlan="free"
      onSubscribe={async (p, i) => {
        subs.push(`${p.key}:${i}`)
      }}
    />,
  )
  await tick()
  const group = screen.getByRole("radiogroup", { name: "Plans" })
  const radios = within(group).getAllByRole("radio")
  ok("PlanPicker: one radio per plan", radios.length === 3)
  ok("PlanPicker: first paid plan preselected", radios[1]?.getAttribute("aria-checked") === "true")
  ok("PlanPicker: one tab stop", radios.filter((r) => r.tabIndex === 0).length === 1)
  ;(radios[1] as HTMLElement).focus()
  await userEvent.keyboard("{ArrowRight}")
  must(
    "PlanPicker: ArrowRight moves and checks",
    radios[2]?.getAttribute("aria-checked") === "true",
  )
  ok("PlanPicker: focus follows", document.activeElement === radios[2])
  ok(
    "PlanPicker: current plan is marked",
    !!document.querySelector("[data-plan=free][data-current]"),
  )
  ok("PlanPicker: price shown per month", group.textContent?.includes("/mo") ?? false)
  const intervals = screen.getByRole("radiogroup", { name: "Billing period" })
  ok("PlanPicker: yearly saving shown", intervals.textContent?.includes("Save 17%") ?? false)
  await userEvent.click(within(intervals).getByText("Yearly"))
  must("PlanPicker: interval switches prices", group.textContent?.includes("/yr") ?? false)
  await userEvent.click(screen.getByRole("button", { name: "Continue with Team" }))
  await waitFor(() =>
    must("PlanPicker: onSubscribe gets plan and interval", subs[0] === "team:year", subs),
  )
})

await t("PlanPicker: store source hides web-only plans, controlled value", async () => {
  function Host() {
    const [v, setV] = useState("pro")
    return (
      <>
        <PlanPicker plans={PLANS} source="appstore" value={v} onValueChange={setV} />
        <output data-testid="v">{v}</output>
      </>
    )
  }
  render(<Host />)
  await tick()
  ok(
    "PlanPicker: web-only plan hidden in a store build",
    !screen.queryByRole("radio", { name: "Team" }),
  )
  await userEvent.click(screen.getByRole("radio", { name: "Free" }))
  ok("PlanPicker: controlled onValueChange", screen.getByTestId("v").textContent === "free")
  ok(
    "PlanPicker: source as data-*",
    !!document.querySelector("[data-slot=plan-picker][data-source=appstore]"),
  )
})

await t("CurrentPlanCard and restore", async () => {
  let restored = 0
  render(
    <CurrentPlanCard
      plans={PLANS}
      subscription={{
        plan: "pro",
        status: "active",
        currentPeriodEnd: "2026-12-15T00:00:00.000Z",
        source: { gateway: "appstore", subscriptionId: "x" },
      }}
      onManage={() => {}}
      onRestore={async () => {
        restored++
        return true
      }}
    />,
  )
  const card = screen.getByRole("region", { name: "Current plan" })
  ok("CurrentPlan: names the plan", card.textContent?.includes("Pro") ?? false)
  ok("CurrentPlan: status as data-*", !!card.querySelector("[data-status=active]"))
  ok("CurrentPlan: renewal date", !!card.querySelector("time[datetime='2026-12-15T00:00:00.000Z']"))
  ok("CurrentPlan: source shown", card.textContent?.includes("App Store") ?? false)
  await userEvent.click(screen.getByRole("button", { name: "Restore purchases" }))
  await waitFor(() =>
    must(
      "Restore: announced in a status region",
      screen.getByRole("status").textContent === "Purchases restored",
    ),
  )
  ok("Restore: called once", restored === 1)
})

await t("CurrentPlanCard: cancelled web plan, no restore", () => {
  render(
    <CurrentPlanCard
      subscription={{
        plan: "team",
        status: "cancelled",
        currentPeriodEnd: "2026-12-01",
        source: { gateway: "razorpay" },
      }}
      onRestore={() => true}
      labels={{ ends: () => "Termina pronto" }}
    />,
  )
  ok("CurrentPlan: cancelled says ends", !!screen.getByText("Termina pronto"))
  ok(
    "CurrentPlan: no restore for a web gateway",
    !screen.queryByRole("button", { name: "Restore purchases" }),
  )
})

await t("UsageMeters", () => {
  render(
    <UsageMeters
      usage={[
        { key: "projects", period: "total", used: 46, limit: 50, remaining: 4 },
        { key: "aiCalls", period: "2026-11", used: 10, limit: 100, remaining: 90 },
        {
          key: "seats",
          period: "total",
          used: 4,
          limit: Number.POSITIVE_INFINITY,
          remaining: Number.POSITIVE_INFINITY,
        },
      ]}
    />,
  )
  const bars = screen.getAllByRole("progressbar")
  ok(
    "Usage: a progressbar per limit, named",
    bars.length === 3 && !!screen.getByRole("progressbar", { name: "Projects" }),
  )
  ok(
    "Usage: value text says used / limit",
    screen.getByRole("progressbar", { name: "Projects" }).getAttribute("aria-valuetext") ===
      "46 / 50",
  )
  ok(
    "Usage: level as data-*",
    !!document.querySelector("[data-level=critical]") &&
      document.querySelectorAll("[data-level=ok]").length === 2,
  )
  ok(
    "Usage: unlimited says so",
    screen.getByRole("region", { name: "Usage" }).textContent?.includes("Unlimited") ?? false,
  )
})

await t("InvoiceList and WalletCard", async () => {
  render(
    <>
      <InvoiceList
        invoices={[
          {
            id: "1",
            number: "INV/26-27/0007",
            date: "2026-11-01",
            total: 58882,
            currency: "INR",
            status: "paid",
            href: "/invoices/1",
          },
        ]}
      />
      <WalletCard balance={125050} currency="INR" onTopUp={() => {}} className="custom-wallet" />
    </>,
  )
  const link = screen.getByRole("link", { name: /^View invoice.*INV\/26-27\/0007/ })
  ok("Invoices: link to the GST HTML invoice", link.getAttribute("href") === "/invoices/1")
  ok(
    "Invoices: opens safely in a new tab",
    link.getAttribute("target") === "_blank" && link.getAttribute("rel") === "noreferrer",
  )
  link.focus()
  ok("Invoices: links are focusable", document.activeElement === link)
  const wallet = screen.getByRole("region", { name: "Wallet" })
  ok("Wallet: balance", wallet.textContent?.includes("1,250.50") ?? false)
  ok(
    "Wallet: className merges",
    wallet.classList.contains("custom-wallet") && wallet.classList.contains("rounded-xl"),
  )
})

await t("Paywall and BillingScreen", async () => {
  render(<Paywall plans={PLANS} source="googleplay" onRestore={() => true} title="Go Pro" />)
  ok("Paywall: heading", !!screen.getByRole("heading", { name: "Go Pro" }))
  ok(
    "Paywall: restore in a store build",
    !!screen.getByRole("button", { name: "Restore purchases" }),
  )
  cleanup()
  render(
    <BillingScreen
      plans={PLANS}
      subscription={{
        plan: "pro",
        status: "trialing",
        currentPeriodEnd: "2026-12-01",
        source: { gateway: "web" },
      }}
      usage={[{ key: "projects", period: "total", used: 3, limit: 50, remaining: 47 }]}
      invoices={[]}
      wallet={{ balance: 0, currency: "INR" }}
      labels={{ invoices: "Facturas", noInvoices: "Aún no hay facturas" }}
      classNames={{ plans: "custom-plans" }}
      render={<main />}
    />,
  )
  ok(
    "BillingScreen: render swaps the root element",
    document.querySelector("[data-slot=billing-screen]")?.tagName === "MAIN",
  )
  ok(
    "BillingScreen: labels reach parts",
    !!screen.getByRole("region", { name: "Facturas" }) && !!screen.getByText("Aún no hay facturas"),
  )
  ok(
    "BillingScreen: classNames reach parts",
    !!document.querySelector("[data-slot=plan-picker].custom-plans"),
  )
  ok(
    "BillingScreen: current plan button disabled",
    (screen.queryByRole("button", { name: "Current plan" }) as HTMLButtonElement | null)
      ?.disabled !== false,
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
