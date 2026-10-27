/**
 * Date arithmetic. The handful of date-fns helpers apps actually use, with no
 * dependency.
 *
 * Every function works in local time, as date-fns does by default, takes a
 * Date or epoch milliseconds, and returns a new Date: the input is never
 * mutated. An invalid date gives an invalid Date, NaN or false, never a throw.
 */

export type DateInput = Date | number

const DAY_MS = 86_400_000

const clone = (date: DateInput): Date => new Date(date instanceof Date ? date.getTime() : date)

const invalid = (): Date => new Date(Number.NaN)

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Local midnight for a "YYYY-MM-DD" string. An invalid Date for anything else,
 * including an impossible date like 2025-02-30, which is not rolled over into
 * March.
 *
 * `new Date("2024-12-25")` is UTC midnight, the previous evening west of UTC,
 * so a date-only string must never go through the Date constructor.
 */
export function parseDateOnly(s: string): Date {
  const m = typeof s === "string" ? DATE_ONLY.exec(s) : null
  if (!m) return invalid()
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const day = Number(m[3])
  const d = new Date(0)
  // setFullYear, not new Date(y, m, d): the constructor maps years 0–99 to 1900–1999.
  d.setFullYear(y, mo, day)
  d.setHours(0, 0, 0, 0)
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return invalid()
  return d
}

/**
 * A formatter input as a Date. A date-only "YYYY-MM-DD" string is local
 * midnight (see `parseDateOnly`); any other string, and a number, goes through
 * the Date constructor. A Date is returned as is. Internal to `format`.
 */
export const toDate = (input: string | Date | number): Date => {
  if (input instanceof Date) return input
  if (typeof input === "string" && DATE_ONLY.test(input)) return parseDateOnly(input)
  return new Date(input)
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0")

/**
 * The local calendar date of `d` as "YYYY-MM-DD", the inverse of
 * `parseDateOnly`. An empty string for an invalid date.
 */
export function toDateOnly(d: DateInput): string {
  const x = clone(d)
  if (Number.isNaN(x.getTime())) return ""
  return `${pad(x.getFullYear(), 4)}-${pad(x.getMonth() + 1, 2)}-${pad(x.getDate(), 2)}`
}

/** Days in the month of `d`, in local time. */
const daysInMonth = (d: Date): number => {
  const last = new Date(d.getTime())
  last.setFullYear(d.getFullYear(), d.getMonth() + 1, 0)
  return last.getDate()
}

/**
 * `date` moved by `amount` calendar days, keeping the local time of day across
 * a DST change. Fractions are truncated; a negative amount goes back.
 */
export function addDays(date: DateInput, amount: number): Date {
  const d = clone(date)
  if (Number.isNaN(amount)) return invalid()
  const n = Math.trunc(amount)
  if (n) d.setDate(d.getDate() + n)
  return d
}

/**
 * `date` moved by `amount` calendar months. The day clamps to the end of a
 * shorter month: Jan 31 + 1 month is Feb 28, or Feb 29 in a leap year.
 * Fractions are truncated; a negative amount goes back.
 */
export function addMonths(date: DateInput, amount: number): Date {
  const d = clone(date)
  if (Number.isNaN(amount)) return invalid()
  if (Number.isNaN(d.getTime())) return d
  const n = Math.trunc(amount)
  if (!n) return d
  const day = d.getDate()
  // Move on the 1st, so Jan 31 does not overflow into March first.
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  d.setDate(Math.min(day, daysInMonth(d)))
  return d
}

/** 00:00:00.000 local time on the same day. */
export function startOfDay(date: DateInput): Date {
  const d = clone(date)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 00:00:00.000 local time on the 1st of the month. */
export function startOfMonth(date: DateInput): Date {
  const d = clone(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 00:00:00.000 local time on January 1st. */
export function startOfYear(date: DateInput): Date {
  const d = clone(date)
  d.setFullYear(d.getFullYear(), 0, 1)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 23:59:59.999 local time on the last day of the month. */
export function endOfMonth(date: DateInput): Date {
  const d = clone(date)
  d.setFullYear(d.getFullYear(), d.getMonth() + 1, 0)
  d.setHours(23, 59, 59, 999)
  return d
}

/** The local calendar date of `d` as a whole day count, independent of DST. */
const calendarDay = (d: Date): number => {
  const utc = new Date(0)
  // setUTCFullYear, not Date.UTC: Date.UTC maps years 0–99 to 1900–1999.
  utc.setUTCFullYear(d.getFullYear(), d.getMonth(), d.getDate())
  return utc.getTime() / DAY_MS
}

/**
 * Calendar days from `right` to `left` (positive when `left` is later), ignoring
 * the time of day. Counts calendar dates rather than dividing milliseconds by
 * 86,400,000, so a 23-hour DST day still counts as one. NaN for an invalid date.
 */
export function differenceInCalendarDays(left: DateInput, right: DateInput): number {
  const a = clone(left)
  const b = clone(right)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Number.NaN
  return Math.round(calendarDay(a) - calendarDay(b))
}

/** Same local calendar day. False if either date is invalid. */
export function isSameDay(left: DateInput, right: DateInput): boolean {
  const a = clone(left)
  const b = clone(right)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Same local month of the same year. False if either date is invalid. */
export function isSameMonth(left: DateInput, right: DateInput): boolean {
  const a = clone(left)
  const b = clone(right)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}
