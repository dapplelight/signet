"use client"
import { TrendChip } from "@dapplelight/signet-ui/domain/trend-chip"

export function TrendChipDemo() {
  return (
    <div className="flex items-center gap-4">
      <TrendChip value={12.4} />
      <TrendChip value={-3.2} />
    </div>
  )
}

export function TrendChipInStatDemo() {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-neutral-500">Monthly recurring revenue</span>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold">₹8.4L</span>
        <TrendChip value="8.7" className="text-sm" />
      </div>
    </div>
  )
}

export function TrendChipFallbackDemo() {
  return (
    <div className="flex items-center gap-4">
      <TrendChip value="n/a" />
      <TrendChip value={0} />
    </div>
  )
}
