"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import {
  MASKED_VALUE,
  MaskToggle,
  PrivacyMaskProvider,
  RatioFill,
  RatioProgress,
  RatioText,
  usePrivacyMask,
} from "@dapplelight/signet-ui/components/privacy-mask"
import { useState } from "react"

function Balance({ amount }: { amount: number }) {
  const { masked } = usePrivacyMask()
  return (
    <span className="tabular-nums">{masked ? MASKED_VALUE : `$${amount.toLocaleString()}`}</span>
  )
}

function Panel() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-muted">Checking balance</span>
        <MaskToggle />
      </div>
      <p className="text-2xl font-semibold">
        <Balance amount={48250} />
      </p>
    </div>
  )
}

export function PrivacyMaskDemo() {
  return (
    <PrivacyMaskProvider storageKey={false}>
      <Panel />
    </PrivacyMaskProvider>
  )
}

export function PrivacyMaskRatiosDemo() {
  return (
    <PrivacyMaskProvider storageKey={false} defaultMasked>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <MaskToggle />
        <p className="text-sm">
          <RatioText>92% of the travel budget used</RatioText>
        </p>
        <RatioProgress value={92} aria-label="Travel budget used" />
        <div className="h-1 w-full rounded-full bg-bg-elevated">
          <RatioFill pct={92} className="h-full rounded-full bg-primary" />
        </div>
      </div>
    </PrivacyMaskProvider>
  )
}

export function PrivacyMaskControlledDemo() {
  const [masked, setMasked] = useState(false)
  return (
    <PrivacyMaskProvider masked={masked} onMaskedChange={setMasked}>
      <div className="flex flex-col items-start gap-3">
        <Button variant="outline" onClick={() => setMasked(!masked)}>
          {masked ? "Show balances" : "Hide balances"}
        </Button>
        <p className="text-lg font-semibold">
          <Balance amount={12400} />
        </p>
      </div>
    </PrivacyMaskProvider>
  )
}

export function MaskToggleLabelsDemo() {
  return (
    <PrivacyMaskProvider storageKey={false}>
      <MaskToggle hideLabel="Hide revenue" showLabel="Show revenue" shortcut="H" />
    </PrivacyMaskProvider>
  )
}
