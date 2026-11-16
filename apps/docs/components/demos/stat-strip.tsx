"use client"

import { StatStrip } from "@dapplelight/signet-ui/components/stat-strip"

export function StatStripDemo() {
  return (
    <StatStrip
      isDesktop
      items={[
        { label: "Revenue", value: "$48,200", meta: "+12% vs last month", tone: "good" },
        { label: "Orders", value: "1,284", meta: "38 awaiting shipment", tone: "warn" },
        { label: "Refunds", value: "$640", meta: "1.3% of revenue" },
      ]}
    />
  )
}

export function StatStripRowsDemo() {
  return (
    <StatStrip
      isDesktop={false}
      className="max-w-sm"
      items={[
        { label: "Revenue", value: "$48,200", meta: "+12% vs last month", tone: "good" },
        { label: "Orders", value: "1,284", meta: "38 awaiting shipment", tone: "warn" },
        { label: "Refunds", value: "$640" },
      ]}
    />
  )
}

export function StatStripFourDemo() {
  return (
    <StatStrip
      isDesktop
      items={[
        { label: "Active users", value: "9,310" },
        { label: "Trials", value: "212", meta: "+18 this week", tone: "good" },
        { label: "Churn", value: "2.1%", meta: "above target", tone: "warn" },
        { label: "MRR", value: "$31,900" },
      ]}
    />
  )
}
