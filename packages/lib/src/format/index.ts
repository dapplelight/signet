/**
 * Currency, number and date formatting, plus date arithmetic (./date.ts).
 * Intl only — no date-fns.
 *
 * From app-a, which was the only product with considered formatters. Two
 * generalisations: the Indian lakh/crore scale is now opt-in per locale rather
 * than hardcoded to INR, and date formatting uses Intl instead of pulling in
 * date-fns for what the platform already does.
 */

import { toDate } from "./date.js"

export type Amount = number | string

const toNumber = (v: Amount): number => (typeof v === "string" ? Number.parseFloat(v) : v)

/**
 * Currency formatter. `precise` switches between whole units and 2 decimals —
 * dashboards want whole, statements want exact.
 */
export function createCurrencyFormatter(currency = "INR", locale = "en-IN") {
  const whole = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  const precise = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return (amount: Amount, exact = false): string => {
    const n = toNumber(amount)
    if (!Number.isFinite(n)) return (exact ? precise : whole).format(0)
    return (exact ? precise : whole).format(n)
  }
}

const trim = (n: number, decimals: number): string => n.toFixed(decimals).replace(/\.?0+$/, "")

/**
 * Compact currency.
 *
 * The Indian numbering system groups by lakh (1e5) and crore (1e7), which
 * `Intl` compact notation does not produce — it gives "12L" as "1.2M". Locales
 * using that system get the lakh/crore scale; everything else uses Intl.
 */
export function createCompactCurrencyFormatter(currency = "INR", locale = "en-IN", decimals = 1) {
  const full = createCurrencyFormatter(currency, locale)
  const usesLakhCrore = /^(en-IN|hi|bn|ta|te|mr|gu|kn|ml|pa)\b/.test(locale)

  if (usesLakhCrore) {
    const symbol =
      new Intl.NumberFormat(locale, { style: "currency", currency })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? ""
    return (amount: Amount): string => {
      const n = toNumber(amount)
      if (!Number.isFinite(n)) return full(0)
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
  return (amount: Amount): string => {
    const n = toNumber(amount)
    return Number.isFinite(n) ? fmt.format(n) : fmt.format(0)
  }
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

export function createDateFormatter(locale = "en-IN") {
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" })
  return (date: string | Date | number): string => {
    const d = toDate(date)
    return Number.isNaN(d.getTime()) ? "" : fmt.format(d)
  }
}

/** Day and month only — for lists where the year is implied. */
export function createDateShortFormatter(locale = "en-IN") {
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" })
  return (date: string | Date | number): string => {
    const d = toDate(date)
    return Number.isNaN(d.getTime()) ? "" : fmt.format(d)
  }
}

export function createDateTimeFormatter(locale = "en-IN") {
  const fmt = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  return (date: string | Date | number): string => {
    const d = toDate(date)
    return Number.isNaN(d.getTime()) ? "" : fmt.format(d)
  }
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
