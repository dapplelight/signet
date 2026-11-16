"use client"
import { PillGroup } from "@dapplelight/signet-ui/components/pill-group"
import { useState } from "react"

const statuses = [
  { value: "", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "overdue", label: "Overdue" },
]

export function PillGroupDemo() {
  const [status, setStatus] = useState("")
  return <PillGroup options={statuses} value={status} onChange={setStatus} />
}

export function PillGroupColoursDemo() {
  const [status, setStatus] = useState("overdue")
  return (
    <PillGroup
      value={status}
      onChange={setStatus}
      options={[
        {
          value: "paid",
          label: "Paid",
          activeClassName: "border-green-500/40 bg-green-500/15 text-text-primary",
        },
        {
          value: "pending",
          label: "Pending",
          activeClassName: "border-amber-500/40 bg-amber-500/15 text-text-primary",
        },
        {
          value: "overdue",
          label: "Overdue",
          activeClassName: "border-red-500/40 bg-red-500/15 text-text-primary",
        },
      ]}
    />
  )
}

export function PillGroupRangeDemo() {
  const [range, setRange] = useState("30d")
  return (
    <div className="flex flex-col items-center gap-3">
      <PillGroup
        value={range}
        onChange={setRange}
        options={[
          { value: "7d", label: "7 days" },
          { value: "30d", label: "30 days" },
          { value: "90d", label: "90 days" },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        Showing revenue for the last {range.replace("d", " days")}.
      </p>
    </div>
  )
}
