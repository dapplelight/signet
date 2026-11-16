"use client"
import {
  type ChartDayView,
  type ChartFilterView,
  type ChartResultView,
  SubscriptionCharts,
} from "@dapplelight/signet-ui/screens/subscription-charts"
import { useState } from "react"
import { ClientOnly } from "./client-only"

// 30 days of fake subscription metrics, amounts in cents.
const days: ChartDayView[] = Array.from({ length: 30 }, (_, i) => {
  const subs = 820 + i * 6
  return {
    day: new Date(Date.UTC(2026, 9, 18 + i)).toISOString().slice(0, 10),
    activeSubscribers: subs,
    activeTrials: 90 + (i % 7) * 4,
    mrr: { USD: subs * 1900 },
    mrrTotal: null,
    newRevenue: { USD: (8 + (i % 5)) * 1900 },
    renewalRevenue: { USD: (20 + (i % 9)) * 1900 },
    refunds: { USD: i % 6 === 0 ? 1900 : 0 },
    refundCount: i % 6 === 0 ? 1 : 0,
    newSubscriptions: 8 + (i % 5),
    trialsStarted: 14 + (i % 6),
    trialConversions: 5 + (i % 4),
    churned: 3 + (i % 3),
    impressions: 1200 + i * 10,
    conversions: 60 + (i % 8),
  }
})

const data: ChartResultView = {
  from: days[0].day,
  to: days[29].day,
  currencies: ["USD"],
  base: null,
  approximate: false,
  days,
  summary: {
    mrr: { USD: 996 * 1900 },
    mrrTotal: null,
    activeSubscribers: 996,
    activeTrials: 108,
    newRevenue: { USD: 300 * 1900 },
    renewalRevenue: { USD: 660 * 1900 },
    refunds: { USD: 5 * 1900 },
    refundCount: 5,
    trialConversion: 0.34,
    churnRate: 0.041,
    impressions: 37000,
    conversions: 1950,
    paywallConversion: 0.053,
  },
}

function SubscriptionChartsDemoInner() {
  const [filter, setFilter] = useState<ChartFilterView>({ from: data.from, to: data.to })
  return (
    <SubscriptionCharts
      className="w-full"
      data={data}
      filter={filter}
      onFilterChange={setFilter}
      options={{
        stores: ["web", "appstore", "googleplay"],
        plans: ["starter", "pro"],
        countries: ["US", "IN", "DE"],
      }}
      csvHref="/api/charts/csv"
    />
  )
}

function SubscriptionChartsEmptyDemoInner() {
  return (
    <SubscriptionCharts
      className="w-full"
      data={null}
      filter={{ from: "2026-10-18", to: "2026-11-16" }}
      onFilterChange={() => undefined}
    />
  )
}

export const SubscriptionChartsDemo = () => (
  <ClientOnly>
    <SubscriptionChartsDemoInner />
  </ClientOnly>
)

export const SubscriptionChartsEmptyDemo = () => (
  <ClientOnly>
    <SubscriptionChartsEmptyDemoInner />
  </ClientOnly>
)
