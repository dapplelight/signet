/**
 * Money as integer minor units plus an ISO 4217 currency code. Never floats.
 *
 * A `money("price")` column (from `./columns/sqlite` or `./columns/pg`) stores
 * `price` (minor units, e.g. paise) and `priceCurrency`. `moneyOf(row, "price")`
 * reads the pair back as a `Money`.
 */

import { SignetDbError } from "./errors.js"

export type Money = { amount: number; currency: string }

function check(m: Money): Money {
  if (!Number.isSafeInteger(m.amount)) {
    throw new SignetDbError(
      "BAD_MONEY",
      `Money amounts are integer minor units (paise, cents); got ${m.amount}. Convert with Math.round(major * 10 ** minorDigits(currency)) at the input boundary.`,
    )
  }
  return m
}

function same(a: Money, b: Money): void {
  check(a)
  check(b)
  if (a.currency !== b.currency) {
    throw new SignetDbError(
      "CURRENCY_MISMATCH",
      `Cannot combine ${a.currency} and ${b.currency}. Convert one amount to the other currency first.`,
    )
  }
}

/** Read a `money(name)` column pair off a row. */
export function moneyOf<N extends string>(
  row: { [K in N]: number } & { [K in `${N}Currency`]: string },
  name: N,
): Money {
  const r = row as Record<string, unknown>
  return check({ amount: r[name] as number, currency: r[`${name}Currency`] as string })
}

/** a + b. Throws on different currencies or a result past 2^53. */
export function addMoney(a: Money, b: Money): Money {
  same(a, b)
  return check({ amount: a.amount + b.amount, currency: a.currency })
}

/** a - b. */
export function subtractMoney(a: Money, b: Money): Money {
  same(a, b)
  return check({ amount: a.amount - b.amount, currency: a.currency })
}

/** Sum of a non-empty list, or zero in `currency` for an empty one. */
export function sumMoney(items: readonly Money[], currency?: string): Money {
  const first = items[0]
  const start = { amount: 0, currency: first?.currency ?? currency ?? "" }
  if (!start.currency)
    throw new SignetDbError(
      "BAD_MONEY",
      'sumMoney([]) cannot know the currency. Pass it: sumMoney(items, "INR").',
    )
  return items.reduce(addMoney, start)
}

/** -1, 0 or 1. Throws on different currencies. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  same(a, b)
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0
}

/** Digits after the decimal point for a currency: 2 for INR, 0 for JPY, 3 for BHD. */
export function minorDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  )
}

/**
 * Format for display, e.g. `formatMoney({ amount: 123456, currency: "INR" })`
 * → "₹1,234.56". The minor units are turned into an exact decimal string
 * before Intl sees them, so no float rounding happens on the way.
 */
export function formatMoney(
  m: Money,
  locale = "en-IN",
  options: Omit<Intl.NumberFormatOptions, "style" | "currency"> = {},
): string {
  check(m)
  const digits = minorDigits(m.currency)
  const abs = String(Math.abs(m.amount)).padStart(digits + 1, "0")
  const major = digits ? `${abs.slice(0, -digits)}.${abs.slice(-digits)}` : abs
  const fmt = new Intl.NumberFormat(locale, { ...options, style: "currency", currency: m.currency })
  // Intl accepts decimal strings (Intl.NumberFormat v3); the cast covers older lib typings.
  return fmt.format(`${m.amount < 0 ? "-" : ""}${major}` as unknown as number)
}
