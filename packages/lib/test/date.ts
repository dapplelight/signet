// Pin a zone with DST before any Date is made, so the DST cases below test
// something whatever zone the machine or CI runs in. Bun honours a runtime TZ.
process.env.TZ = "America/New_York"

import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
} from "../src/format"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

// Local-time constructor; months are 1-based here for readability.
const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  new Date(y, m - 1, d, h, min, s, ms)
const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
const same = (a: Date, b: Date) => a.getTime() === b.getTime()

ok(
  "TZ took effect (DST offsets differ)",
  at(2026, 1, 1).getTimezoneOffset() !== at(2026, 7, 1).getTimezoneOffset(),
)

// --- addDays ---
ok("addDays forward", ymd(addDays(at(2026, 3, 15), 3)) === "2026-3-18")
ok("addDays negative", ymd(addDays(at(2026, 3, 1), -1)) === "2026-2-28")
ok("addDays across year end", ymd(addDays(at(2026, 12, 31), 1)) === "2027-1-1")
ok("addDays into leap day", ymd(addDays(at(2028, 2, 28), 1)) === "2028-2-29")
ok("addDays zero is an equal copy", same(addDays(at(2026, 3, 15, 9), 0), at(2026, 3, 15, 9)))
ok("addDays truncates fractions", ymd(addDays(at(2026, 3, 15), 1.9)) === "2026-3-16")
ok("addDays accepts epoch ms", ymd(addDays(at(2026, 3, 15).getTime(), 1)) === "2026-3-16")
// 2026-03-08 is spring-forward in New York: 23 hours long.
{
  const r = addDays(at(2026, 3, 7, 12), 1)
  ok("addDays keeps local time across DST", ymd(r) === "2026-3-8" && r.getHours() === 12)
}
ok("addDays NaN amount -> invalid", Number.isNaN(addDays(at(2026, 3, 15), Number.NaN).getTime()))
ok("addDays invalid date -> invalid", Number.isNaN(addDays(new Date("junk"), 1).getTime()))

// --- addMonths ---
ok("addMonths forward", ymd(addMonths(at(2026, 3, 15), 2)) === "2026-5-15")
ok("Jan 31 + 1 month = Feb 28", ymd(addMonths(at(2026, 1, 31), 1)) === "2026-2-28")
ok("Jan 31 + 1 month = Feb 29 in a leap year", ymd(addMonths(at(2028, 1, 31), 1)) === "2028-2-29")
ok("Mar 31 - 1 month = Feb 28", ymd(addMonths(at(2026, 3, 31), -1)) === "2026-2-28")
ok("May 31 + 1 month = Jun 30", ymd(addMonths(at(2026, 5, 31), 1)) === "2026-6-30")
ok("Feb 29 + 12 months = Feb 28", ymd(addMonths(at(2028, 2, 29), 12)) === "2029-2-28")
ok("Feb 29 + 48 months = Feb 29", ymd(addMonths(at(2028, 2, 29), 48)) === "2032-2-29")
ok("addMonths across year end", ymd(addMonths(at(2026, 11, 30), 3)) === "2027-2-28")
ok("addMonths negative across year", ymd(addMonths(at(2026, 1, 15), -13)) === "2024-12-15")
{
  const r = addMonths(at(2026, 1, 31, 14, 30), 1)
  ok("addMonths keeps time of day", r.getHours() === 14 && r.getMinutes() === 30)
}
ok("addMonths invalid date -> invalid", Number.isNaN(addMonths(new Date("junk"), 1).getTime()))

// --- start/end ---
ok("startOfDay", same(startOfDay(at(2026, 3, 15, 18, 45, 12, 500)), at(2026, 3, 15)))
ok("startOfDay on a DST day", same(startOfDay(at(2026, 3, 8, 15)), at(2026, 3, 8)))
ok("startOfMonth", same(startOfMonth(at(2026, 3, 15, 18)), at(2026, 3, 1)))
ok("endOfMonth", same(endOfMonth(at(2026, 4, 10)), at(2026, 4, 30, 23, 59, 59, 999)))
ok("endOfMonth Feb", ymd(endOfMonth(at(2026, 2, 3))) === "2026-2-28")
ok("endOfMonth leap Feb", ymd(endOfMonth(at(2028, 2, 3))) === "2028-2-29")
ok("endOfMonth from the 31st", ymd(endOfMonth(at(2026, 1, 31))) === "2026-1-31")
ok("endOfMonth December", ymd(endOfMonth(at(2026, 12, 1))) === "2026-12-31")
ok("century non-leap Feb", ymd(endOfMonth(at(2100, 2, 1))) === "2100-2-28")

// --- differenceInCalendarDays ---
ok(
  "diff same day, different times",
  differenceInCalendarDays(at(2026, 3, 15, 23), at(2026, 3, 15, 1)) === 0,
)
ok(
  "diff across midnight is 1",
  differenceInCalendarDays(at(2026, 3, 16, 0, 1), at(2026, 3, 15, 23, 59)) === 1,
)
ok("diff negative", differenceInCalendarDays(at(2026, 3, 10), at(2026, 3, 15)) === -5)
// ms / 86_400_000 floors this to 0: the day is 23 hours long.
ok("diff across spring-forward", differenceInCalendarDays(at(2026, 3, 9), at(2026, 3, 8)) === 1)
ok("diff across fall-back", differenceInCalendarDays(at(2026, 11, 2), at(2026, 11, 1)) === 1)
ok(
  "diff over a whole year with DST",
  differenceInCalendarDays(at(2027, 1, 1), at(2026, 1, 1)) === 365,
)
ok("diff over a leap year", differenceInCalendarDays(at(2029, 1, 1), at(2028, 1, 1)) === 366)
ok("diff invalid -> NaN", Number.isNaN(differenceInCalendarDays(new Date("junk"), at(2026, 1, 1))))

// --- isSameDay / isSameMonth ---
ok("isSameDay true", isSameDay(at(2026, 3, 15, 0), at(2026, 3, 15, 23, 59)))
ok("isSameDay false", !isSameDay(at(2026, 3, 15, 23, 59), at(2026, 3, 16)))
ok("isSameDay false across years", !isSameDay(at(2026, 3, 15), at(2027, 3, 15)))
ok("isSameDay invalid -> false", !isSameDay(new Date("junk"), new Date("junk")))
ok("isSameMonth true", isSameMonth(at(2026, 3, 1), at(2026, 3, 31, 23)))
ok("isSameMonth false across years", !isSameMonth(at(2026, 3, 1), at(2027, 3, 1)))
ok("isSameMonth false", !isSameMonth(at(2026, 3, 31), at(2026, 4, 1)))

// --- purity: no helper mutates its input ---
{
  const input = at(2026, 1, 31, 10, 20, 30, 400)
  const t = input.getTime()
  addDays(input, 5)
  addMonths(input, 1)
  startOfDay(input)
  startOfMonth(input)
  endOfMonth(input)
  differenceInCalendarDays(input, input)
  isSameDay(input, input)
  isSameMonth(input, input)
  ok("inputs are never mutated", input.getTime() === t)
  ok("results are new objects", addDays(input, 0) !== input && addMonths(input, 0) !== input)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
