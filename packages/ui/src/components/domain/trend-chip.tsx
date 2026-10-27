import { cn } from "../../lib/utils.js"

interface TrendChipProps {
  value: number | string
  className?: string
}

function TrendChip({ value, className }: TrendChipProps) {
  const num = typeof value === "string" ? parseFloat(value) : value
  // Guard against NaN (e.g. parseFloat of a non-numeric string) so we never
  // render "NaN%" (#73 LOW).
  if (Number.isNaN(num)) {
    return <span className={cn("text-[11px] text-text-muted", className)}>—</span>
  }

  const isPositive = num >= 0
  const sign = isPositive ? "+" : ""
  const formatted = `${sign}${num.toFixed(1)}%`

  return (
    <span
      className={cn("text-[11px]", isPositive ? "text-accent-green" : "text-accent-red", className)}
    >
      {formatted} {isPositive ? "↑" : "↓"}
    </span>
  )
}

export { TrendChip }
