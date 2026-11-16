"use client"
import {
  type BillingInvoice,
  type BillingPlan,
  BillingScreen,
  type BillingSubscription,
  type BillingUsage,
  CurrentPlanCard,
  InvoiceList,
  Paywall,
  PlanPicker,
  RestorePurchasesButton,
  UsageMeters,
  WalletCard,
} from "@dapplelight/signet-ui/screens/billing-screens"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const plans: BillingPlan[] = [
  {
    key: "free",
    name: "Free",
    description: "For trying things out",
    features: ["basic_reports"],
    limits: { projects: 3 },
    prices: { month: { amount: 0, currency: "INR" } },
  },
  {
    key: "pro",
    name: "Pro",
    description: "For growing teams",
    badge: "Popular",
    features: ["basic_reports", "priority_support"],
    limits: { projects: 50, seats: 10 },
    prices: {
      month: { amount: 49900, currency: "INR" },
      year: { amount: 499000, currency: "INR" },
    },
  },
  {
    key: "business",
    name: "Business",
    description: "For the whole company",
    features: ["basic_reports", "priority_support", "sso"],
    limits: { projects: null, seats: null },
    prices: {
      month: { amount: 149900, currency: "INR" },
      year: { amount: 1499000, currency: "INR" },
    },
  },
]

const subscription: BillingSubscription = {
  plan: "pro",
  status: "active",
  currentPeriodEnd: new Date(Date.now() + 18 * 86400_000),
  source: { gateway: "web" },
}

const usage: BillingUsage[] = [
  { key: "projects", period: "total", used: 41, limit: 50, remaining: 9 },
  { key: "seats", period: "total", used: 4, limit: 10, remaining: 6 },
  { key: "api_calls", period: "month", used: 9400, limit: 10000, remaining: 600 },
]

const invoices: BillingInvoice[] = [
  {
    id: "i3",
    number: "INV-2026-0003",
    date: new Date(Date.now() - 5 * 86400_000),
    total: 49900,
    currency: "INR",
    status: "paid",
    href: "#",
  },
  {
    id: "i2",
    number: "INV-2026-0002",
    date: new Date(Date.now() - 35 * 86400_000),
    total: 49900,
    currency: "INR",
    status: "paid",
    href: "#",
  },
  {
    id: "i1",
    number: "INV-2026-0001",
    date: new Date(Date.now() - 65 * 86400_000),
    total: 49900,
    currency: "INR",
    status: "refunded",
    href: "#",
  },
]

export function PlanPickerDemo() {
  return (
    <div className="w-full">
      <PlanPicker
        plans={plans}
        defaultValue="pro"
        currentPlan="free"
        onSubscribe={() => wait(800)}
      />
    </div>
  )
}

export function CurrentPlanCardDemo() {
  return (
    <div className="w-full max-w-md">
      <CurrentPlanCard subscription={subscription} plans={plans} onManage={() => undefined} />
    </div>
  )
}

export function UsageMetersDemo() {
  return (
    <div className="w-full max-w-md">
      <UsageMeters usage={usage} />
    </div>
  )
}

export function InvoiceListDemo() {
  return (
    <div className="w-full max-w-lg">
      <InvoiceList invoices={invoices} />
    </div>
  )
}

export function WalletCardDemo() {
  return (
    <div className="w-full max-w-sm">
      <WalletCard balance={250000} currency="INR" onTopUp={() => undefined} />
    </div>
  )
}

export function RestorePurchasesButtonDemo() {
  return <RestorePurchasesButton onRestore={() => wait(800)} />
}

export function PaywallDemo() {
  return (
    <div className="w-full">
      <Paywall
        title="Go further with Pro"
        subtitle="Cancel any time."
        plans={plans.slice(0, 2)}
        defaultValue="pro"
        onSubscribe={() => wait(800)}
      />
    </div>
  )
}

export function BillingScreenDemo() {
  return (
    <div className="w-full">
      <BillingScreen
        plans={plans}
        subscription={subscription}
        usage={usage}
        invoices={invoices}
        wallet={{ balance: 250000, currency: "INR", onTopUp: () => undefined }}
        onSubscribe={() => wait(800)}
        onManage={() => undefined}
      />
    </div>
  )
}
