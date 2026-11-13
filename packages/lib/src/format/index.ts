/**
 * Currency, number and date formatting, plus date arithmetic (./date.ts).
 * Intl only — no date-fns.
 *
 * From app-a, which was the only product with considered formatters. Two
 * generalisations: the Indian lakh/crore scale is now opt-in per locale rather
 * than hardcoded to INR, and date formatting uses Intl instead of pulling in
 * date-fns for what the platform already does.
 */

import { DATE_ONLY, toDate } from "./date.js"

/** A decimal string, a number, or a bigint (exact; use it for minor units). */
export type Amount = number | string | bigint

export type CurrencyOptions = {
  /**
   * `amount` is in the currency's minor unit (cents, paise, fils): 12345 USD is
   * $123.45, 1234 JPY is ¥1,234, 1234 KWD is KD 1.234. Default false.
   */
  minorUnits?: boolean
}

export type DateFormatOptions = {
  /**
   * IANA zone to show the time in, e.g. "Asia/Kolkata". Default: the runtime's
   * zone. A date-only "YYYY-MM-DD" string is a calendar date and is never
   * shifted by it.
   */
  timeZone?: string
}

const toNumber = (v: Amount): number => (typeof v === "string" ? Number.parseFloat(v) : Number(v))

/** The currency's own number of fraction digits: JPY 0, USD 2, KWD and BHD 3. */
const fractionDigits = (currency: string, locale: string): number =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2

/**
 * The amount as something Intl formats exactly. Junk becomes 0. A bigint stays
 * a bigint; bigint minor units become a decimal string, so they never pass
 * through a float.
 */
function toFormattable(v: Amount, digits: number, minor: boolean): number | bigint | string {
  if (typeof v === "bigint") {
    if (!minor || digits === 0) return v
    const neg = v < 0n
    const s = (neg ? -v : v).toString().padStart(digits + 1, "0")
    return `${neg ? "-" : ""}${s.slice(0, -digits)}.${s.slice(-digits)}`
  }
  const n = toNumber(v)
  if (!Number.isFinite(n)) return 0
  return minor ? n / 10 ** digits : n
}

/**
 * Currency formatter. `precise` switches between whole units and the
 * currency's own decimals (2 for USD and INR, 0 for JPY, 3 for KWD and BHD) —
 * dashboards want whole, statements want exact.
 */
export function createCurrencyFormatter(
  currency = "INR",
  locale = "en-IN",
  options: CurrencyOptions = {},
) {
  const digits = fractionDigits(currency, locale)
  const minor = options.minorUnits === true
  const whole = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  const precise = new Intl.NumberFormat(locale, { style: "currency", currency })
  // The cast: format() takes decimal strings at runtime; the ES2022 lib types do not say so.
  return (amount: Amount, exact = false): string =>
    (exact ? precise : whole).format(toFormattable(amount, digits, minor) as number)
}

const trim = (n: number, decimals: number): string => n.toFixed(decimals).replace(/\.?0+$/, "")

/**
 * Compact currency.
 *
 * The Indian numbering system groups by lakh (1e5) and crore (1e7), which
 * `Intl` compact notation does not produce — it gives "12L" as "1.2M". Locales
 * using that system get the lakh/crore scale; everything else uses Intl.
 */
export function createCompactCurrencyFormatter(
  currency = "INR",
  locale = "en-IN",
  decimals = 1,
  options: CurrencyOptions = {},
) {
  const full = createCurrencyFormatter(currency, locale)
  const digits = fractionDigits(currency, locale)
  const minor = options.minorUnits === true
  const toMajor = (amount: Amount): number => Number(toFormattable(amount, digits, minor))
  // Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Assamese.
  const usesLakhCrore = /^(en-IN|hi|bn|ta|te|mr|gu|kn|ml|pa|or|as)\b/.test(locale)

  if (usesLakhCrore) {
    const symbol =
      new Intl.NumberFormat(locale, { style: "currency", currency })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? ""
    return (amount: Amount): string => {
      const n = toMajor(amount)
      const sign = n < 0 ? "-" : ""
      const abs = Math.abs(n)
      if (abs >= 1e7) return `${sign}${symbol}${trim(abs / 1e7, decimals)}Cr`
      if (abs >= 1e5) return `${sign}${symbol}${trim(abs / 1e5, decimals)}L`
      return full(n)
    }
  }

  const fmt = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: decimals,
  })
  return (amount: Amount): string => fmt.format(toMajor(amount))
}

/** Signed percentage. Always carries a sign so deltas read unambiguously. */
export function formatPercent(value: Amount, decimals = 1): string {
  const n = toNumber(value)
  if (!Number.isFinite(n)) return "0%"
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`
}

/*
 * Every formatter below reads a date-only "YYYY-MM-DD" string as local
 * midnight. `new Date("2024-12-25")` is UTC midnight, which shows as 24 Dec
 * anywhere west of UTC. Strings with a time or zone parse as normal.
 */

function dateFormatter(
  locale: string,
  fields: Intl.DateTimeFormatOptions,
  { timeZone }: DateFormatOptions,
) {
  const fmt = new Intl.DateTimeFormat(locale, { ...fields, ...(timeZone ? { timeZone } : {}) })
  // A calendar date has no zone: local midnight shown in another zone could be the day before.
  const local = timeZone ? new Intl.DateTimeFormat(locale, fields) : fmt
  return (date: string | Date | number): string => {
    const d = toDate(date)
    if (Number.isNaN(d.getTime())) return ""
    return (typeof date === "string" && DATE_ONLY.test(date) ? local : fmt).format(d)
  }
}

export function createDateFormatter(locale = "en-IN", options: DateFormatOptions = {}) {
  return dateFormatter(locale, { day: "numeric", month: "short", year: "numeric" }, options)
}

/** Day and month only — for lists where the year is implied. */
export function createDateShortFormatter(locale = "en-IN", options: DateFormatOptions = {}) {
  return dateFormatter(locale, { day: "numeric", month: "short" }, options)
}

export function createDateTimeFormatter(locale = "en-IN", options: DateFormatOptions = {}) {
  return dateFormatter(
    locale,
    { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" },
    options,
  )
}

/** "3 days ago", "in 2 hours". Uses Intl.RelativeTimeFormat, no dependency. */
export function createRelativeTimeFormatter(locale = "en-IN") {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["week", 604_800_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ]
  return (date: string | Date | number, now: Date = new Date()): string => {
    const d = toDate(date)
    if (Number.isNaN(d.getTime())) return ""
    const diff = d.getTime() - now.getTime()
    for (const [unit, ms] of units) {
      if (Math.abs(diff) >= ms || unit === "second") {
        return rtf.format(Math.round(diff / ms), unit)
      }
    }
    return ""
  }
}

export {
  addDays,
  addMonths,
  type DateInput,
  differenceInCalendarDays,
  endOfMonth,
  isSameDay,
  isSameMonth,
  parseDateOnly,
  startOfDay,
  startOfMonth,
  startOfYear,
  toDateOnly,
} from "./date.js"
