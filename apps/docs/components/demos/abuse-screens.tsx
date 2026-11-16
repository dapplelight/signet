"use client"
import {
  AiSpendAdmin,
  type AiSpendCap,
  type AiSpendOverview,
  CaptchaWidget,
  UNITS_PER_USD,
} from "@dapplelight/signet-ui/screens/abuse-screens"
import { useState } from "react"

const usd = (n: number) => Math.round(n * UNITS_PER_USD)

const overview: AiSpendOverview = {
  global: {
    scope: "global",
    subject: "*",
    day: { used: usd(18.42), cap: usd(50), remaining: usd(31.58) },
    month: { used: usd(412.6), cap: usd(1000), remaining: usd(587.4) },
  },
  top: {
    users: [
      { subject: "usr_9a3f", used: usd(64.2), cap: usd(100) },
      { subject: "usr_41cc", used: usd(41.75), cap: null },
    ],
    orgs: [{ subject: "org_northwind", used: usd(188.1), cap: usd(300) }],
  },
}

const initialCaps: AiSpendCap[] = [
  { id: "c1", scope: "global", subject: "*", period: "month", units: usd(1000) },
  { id: "c2", scope: "user", subject: "usr_9a3f", period: "day", units: usd(10) },
]

export function CaptchaWidgetDemo() {
  const [token, setToken] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-center gap-2">
      <CaptchaWidget provider="test" onToken={setToken} />
      <code className="text-xs text-neutral-500">{token ?? "no token yet"}</code>
    </div>
  )
}

export function AiSpendAdminDemo() {
  const [caps, setCaps] = useState(initialCaps)
  return (
    <div className="w-full">
      <AiSpendAdmin
        overview={overview}
        caps={caps}
        onSetCap={(input) => {
          setCaps((cs) => [
            ...cs.filter(
              (c) =>
                !(
                  c.scope === input.scope &&
                  c.subject === input.subject &&
                  c.period === input.period
                ),
            ),
            { id: `${input.scope}-${input.subject}-${input.period}`, ...input },
          ])
        }}
        onRemoveCap={(cap) => setCaps((cs) => cs.filter((c) => c.id !== cap.id))}
      />
    </div>
  )
}

export function AiSpendAdminReadOnlyDemo() {
  return (
    <div className="w-full">
      <AiSpendAdmin overview={overview} caps={initialCaps} />
    </div>
  )
}
