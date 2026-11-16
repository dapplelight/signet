"use client"
import { Amount } from "@dapplelight/signet-ui/domain/amount"

export function AmountDemo() {
  return (
    <div className="flex flex-col gap-2 text-center">
      <Amount value={1250000} notation="compact" className="text-3xl font-semibold" />
      <span className="text-sm text-neutral-500">Revenue this month</span>
    </div>
  )
}

export function AmountLocaleDemo() {
  return (
    <div className="flex flex-col gap-1 text-lg">
      <Amount value={12500000} />
      <Amount value={12500000} locale="en-US" currency="USD" />
      <Amount value={12500000} locale="ja-JP" currency="JPY" />
    </div>
  )
}

export function AmountToneDemo() {
  return (
    <div className="flex flex-col gap-1 text-lg">
      <Amount value={4999} tone="credit" />
      <Amount value={-1299} tone="debit" />
      <Amount value={2500} tone="transfer" />
      <Amount value={-18250} tone="auto" />
    </div>
  )
}

export function AmountMinorUnitsDemo() {
  return (
    <div className="flex flex-col gap-1 text-lg">
      <Amount value={1234567} minorUnits />
      <Amount value={123456789n} minorUnits notation="whole" />
    </div>
  )
}

export function AmountCompactDemo() {
  return (
    <div className="flex flex-col gap-1 text-lg">
      <Amount value={125000} notation="compact" />
      <Amount value={12500000} notation="compact" />
      <Amount value={1250000} notation="compact" locale="en-US" currency="USD" />
    </div>
  )
}

export function AmountPartsDemo() {
  return (
    <Amount
      value={48250.75}
      className="text-2xl font-semibold"
      classNames={{ currency: "text-neutral-400", fraction: "text-base text-neutral-500" }}
    />
  )
}
