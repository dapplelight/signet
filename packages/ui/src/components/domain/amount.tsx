// A money amount: currency symbol, the locale's digit grouping (1,25,000 in
// en-IN), its own decimals (2 for INR, 0 for JPY, 3 for KWD), a sign and a
// credit / debit / transfer colour from the theme's money slots. Compact
// notation uses lakh and crore in Indian locales ("₹12.5L", "₹1.2Cr"), which
// Intl does not do the same way in every engine. Self-contained: the formatting
// mirrors signet-lib/format's currency formatters, so a copied-in file needs
// nothing else.
// Recipe: money-format + tone
import type * as React from "react"
import { cloneElement } from "react"
import { cn } from "../../lib/utils.js"

/** A decimal string, a number, or a bigint (exact; use it for minor units). */
type AmountValue = number | string | bigint

type AmountTone = "credit" | "debit" | "transfer"

type AmountPart = "sign" | "currency" | "integer" | "fraction" | "compact"

interface AmountProps extends Omit<React.ComponentProps<"data">, "children" | "value"> {
  value: AmountValue
  /** ISO 4217 code. Default "INR". */
  currency?: string
  /** Default "en-IN". Indian locales group by lakh and crore. */
  locale?: string
  /** `value` is in the minor unit (paise, cents): 12345 INR is ₹123.45. Default false. */
  minorUnits?: boolean
  /**
   * "standard" shows the currency's own decimals, "whole" none, "compact"
   * shortens (₹12.5L, ₹1.2Cr, $1.3M). Default "standard".
   */
  notation?: "standard" | "whole" | "compact"
  /** Overrides the number of decimals. In compact notation it is the maximum (default 1). */
  decimals?: number
  /**
   * Colour from the theme's money slots: "credit" (green), "debit" (ink),
   * "transfer" (muted). "auto" picks credit or debit from the sign. Default:
   * none, the amount inherits the text colour.
   */
  tone?: AmountTone | "auto"
  /**
   * Intl's `signDisplay`. Default "auto" (minus only), or "exceptZero" with
   * `tone="auto"`, so the sign is never shown by colour alone.
   */
  signDisplay?: Intl.NumberFormatOptions["signDisplay"]
  /** Classes per part of the formatted amount, merged over the defaults. */
  classNames?: Partial<Record<AmountPart, string>>
  /** Replaces the `<data>` element, keeping the props and parts. */
  render?: React.ReactElement<Record<string, unknown>>
}

const TONE_CLASS: Record<AmountTone, string> = {
  credit: "text-[color:var(--money-credit,var(--color-accent-green))]",
  debit: "text-[color:var(--money-debit,var(--color-text-primary))]",
  transfer: "text-[color:var(--money-transfer,var(--color-text-muted))]",
}

const PART_OF: Partial<Record<Intl.NumberFormatPartTypes | "compact", AmountPart>> = {
  minusSign: "sign",
  plusSign: "sign",
  currency: "currency",
  integer: "integer",
  group: "integer",
  decimal: "fraction",
  fraction: "fraction",
  compact: "compact",
}

// Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Assamese.
const LAKH_CRORE = /^(en-IN|hi|bn|ta|te|mr|gu|kn|ml|pa|or|as)\b/

/** The value in major units as something Intl formats exactly; junk becomes 0. */
function toMajor(v: AmountValue, digits: number, minor: boolean): number | string {
  if (typeof v === "bigint") {
    if (!minor || digits === 0) return v.toString()
    const neg = v < 0n
    const s = (neg ? -v : v).toString().padStart(digits + 1, "0")
    return `${neg ? "-" : ""}${s.slice(0, -digits)}.${s.slice(-digits)}`
  }
  // Number(), not parseFloat: "1,234.50" is NaN (shown as 0), not a silent 1.
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return minor ? n / 10 ** digits : n
}

/**
 * The formatted amount as parts (`sign`, `currency`, `integer`, `fraction`,
 * `compact`, or `literal` for spacing), plus the exact major-unit value.
 * Exported so a table cell or chart label can format the same way.
 */
function formatAmount(
  value: AmountValue,
  {
    currency = "INR",
    locale = "en-IN",
    minorUnits = false,
    notation = "standard",
    decimals,
    signDisplay = "auto",
  }: Pick<
    AmountProps,
    "currency" | "locale" | "minorUnits" | "notation" | "decimals" | "signDisplay"
  > = {},
): { parts: { type: AmountPart | "literal"; value: string }[]; major: string; sign: number } {
  const digits =
    new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  const major = toMajor(value, digits, minorUnits)
  const n = Number(major)
  const base = { style: "currency", currency, signDisplay } as const
  let raw: { type: string; value: string }[]
  if (notation === "compact" && LAKH_CRORE.test(locale) && Math.abs(n) >= 1e5) {
    const [scale, suffix] = Math.abs(n) >= 1e7 ? [1e7, "Cr"] : [1e5, "L"]
    raw = [
      ...new Intl.NumberFormat(locale, {
        ...base,
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals ?? 1,
      }).formatToParts(n / scale),
      { type: "compact", value: suffix },
    ]
  } else if (notation === "compact" && !LAKH_CRORE.test(locale)) {
    raw = new Intl.NumberFormat(locale, {
      ...base,
      notation: "compact",
      maximumFractionDigits: decimals ?? 1,
    }).formatToParts(n)
  } else {
    // Below a lakh, Indian compact is the whole amount, as in signet-lib.
    const d = notation === "standard" ? (decimals ?? digits) : 0
    // The cast: format takes decimal strings at runtime; the ES2022 lib types do not say so.
    raw = new Intl.NumberFormat(locale, {
      ...base,
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).formatToParts(major as number)
  }
  const parts: { type: AmountPart | "literal"; value: string }[] = []
  for (const p of raw) {
    const type = PART_OF[p.type as keyof typeof PART_OF] ?? "literal"
    const last = parts[parts.length - 1]
    if (last && last.type === type && type !== "literal") last.value += p.value
    else parts.push({ type, value: p.value })
  }
  return { parts, major: String(major), sign: Math.sign(n) || 0 }
}

/**
 * A money amount. Each part is a span with `data-part` ("sign", "currency",
 * "integer", "fraction", "compact"); the element carries `data-tone` and
 * `data-sign` ("positive" | "negative" | "zero") for styling, and its `value`
 * attribute is the exact amount in major units.
 */
function Amount({
  value,
  currency,
  locale,
  minorUnits,
  notation = "standard",
  decimals,
  tone,
  signDisplay,
  classNames = {},
  render,
  className,
  title,
  ...props
}: AmountProps) {
  const { parts, major, sign } = formatAmount(value, {
    currency,
    locale,
    minorUnits,
    notation,
    decimals,
    signDisplay: signDisplay ?? (tone === "auto" ? "exceptZero" : "auto"),
  })
  const resolved: AmountTone | undefined =
    tone === "auto" ? (sign > 0 ? "credit" : sign < 0 ? "debit" : undefined) : tone
  const children = parts.map((p, i) =>
    p.type === "literal" ? (
      p.value
    ) : (
      <span key={i} data-part={p.type} className={classNames[p.type]}>
        {p.value}
      </span>
    ),
  )
  const merged = {
    "data-slot": "amount",
    "data-tone": resolved,
    "data-sign": sign > 0 ? "positive" : sign < 0 ? "negative" : "zero",
    value: major,
    // Compact drops precision; the full amount shows on hover.
    title:
      title ??
      (notation === "compact"
        ? formatAmount(value, { currency, locale, minorUnits })
            .parts.map((p) => p.value)
            .join("")
        : undefined),
    className: cn("whitespace-nowrap tabular-nums", resolved && TONE_CLASS[resolved], className),
    ...props,
  }
  if (render) {
    return cloneElement(
      render,
      { ...merged, className: cn(merged.className, render.props.className as string) },
      children,
    )
  }
  return <data {...merged}>{children}</data>
}

export {
  Amount,
  type AmountPart,
  type AmountProps,
  type AmountTone,
  type AmountValue,
  formatAmount,
}
