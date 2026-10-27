// Date-only strings ("YYYY-MM-DD") in a named zone. Run once per zone:
//   bun run test/date-only.ts America/Los_Angeles
//   bun run test/date-only.ts Asia/Kolkata
// The zone is set before any Date is made; imports only define functions.
const ZONES: Record<string, { jan: number; jul: number }> = {
  // getTimezoneOffset() in minutes: positive west of UTC.
  "America/Los_Angeles": { jan: 480, jul: 420 },
  "Asia/Kolkata": { jan: -330, jul: -330 },
}
const zone = process.argv[2] ?? ""
if (!ZONES[zone]) {
  console.log(`usage: bun run test/date-only.ts <${Object.keys(ZONES).join("|")}>`)
  process.exit(1)
}
process.env.TZ = zone

import {
  addDays,
  createDateFormatter,
  createDateShortFormatter,
  createDateTimeFormatter,
  createRelativeTimeFormatter,
  parseDateOnly,
  startOfDay,
  startOfYear,
  toDateOnly,
} from "../src/format"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

console.log(`zone: ${zone}`)
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)
const same = (a: Date, b: Date) => a.getTime() === b.getTime()
const bad = (d: Date) => Number.isNaN(d.getTime())

// Confirm the zone took effect, not just that TZ was assigned.
ok(
  "TZ took effect (offsets match the zone)",
  at(2026, 1, 1).getTimezoneOffset() === ZONES[zone].jan &&
    at(2026, 7, 1).getTimezoneOffset() === ZONES[zone].jul,
  `${at(2026, 1, 1).getTimezoneOffset()}/${at(2026, 7, 1).getTimezoneOffset()}`,
)

// --- the reported bug: date-only strings show the calendar date as written ---
{
  const short = createDateShortFormatter("en-IN")
  const full = createDateFormatter("en-IN")
  const dt = createDateTimeFormatter("en-IN")
  const got = short("2024-12-25")
  ok('formatDateShort("2024-12-25") is "25 Dec"', got === "25 Dec", got)
  ok(
    'formatDate("2024-12-25") is 25 Dec 2024',
    full("2024-12-25") === "25 Dec 2024",
    full("2024-12-25"),
  )
  ok(
    "date-time formatter reads a date-only string as local midnight",
    dt("2024-12-25").startsWith("25 Dec 2024") && /12:00\s*am/i.test(dt("2024-12-25")),
    dt("2024-12-25"),
  )
  {
    const rel = createRelativeTimeFormatter("en-US")
    // Noon local: 12 hours after local midnight. UTC midnight would be 20 hours
    // in Los Angeles, and 6.5 in Kolkata.
    const r = rel("2024-12-25", at(2024, 12, 25, 12))
    ok("relative: date-only string is local midnight", r === "12 hours ago", r)
  }
  // A string carrying a time or a zone parses as before.
  const utcMidnight = "2024-12-25T00:00:00Z"
  const expected = zone === "America/Los_Angeles" ? "24 Dec" : "25 Dec"
  ok(
    "a string with a zone keeps normal parsing",
    short(utcMidnight) === expected,
    short(utcMidnight),
  )
  ok("a local date-time string keeps normal parsing", short("2024-12-25T23:30:00") === "25 Dec")
  // Date and number inputs are unchanged.
  ok("Date input unchanged", short(at(2024, 12, 25, 23, 59)) === "25 Dec")
  ok("number input unchanged", short(at(2024, 12, 25, 0, 1).getTime()) === "25 Dec")
  ok(
    "impossible date-only string -> empty",
    short("2025-02-30") === "" && full("2025-02-30") === "",
  )
  ok("garbage still -> empty", short("nonsense") === "")
}

// --- parseDateOnly ---
ok("parseDateOnly is local midnight", same(parseDateOnly("2024-12-25"), at(2024, 12, 25)))
ok("parseDateOnly leap day", same(parseDateOnly("2028-02-29"), at(2028, 2, 29)))
ok("parseDateOnly year 0050 is not 1950", parseDateOnly("0050-06-01").getFullYear() === 50)
for (const s of [
  "2025-02-30",
  "2025-02-29",
  "2026-04-31",
  "2026-13-01",
  "2026-00-10",
  "2026-01-00",
  "2026-1-5",
  "2026-01-05T00:00",
  "2026-01-05Z",
  " 2026-01-05",
  "2026/01/05",
  "",
  "junk",
]) {
  ok(`parseDateOnly(${JSON.stringify(s)}) -> invalid`, bad(parseDateOnly(s)))
}
ok("parseDateOnly non-string -> invalid", bad(parseDateOnly(undefined as unknown as string)))

// --- toDateOnly ---
ok("toDateOnly pads", toDateOnly(at(2026, 3, 5, 23, 59)) === "2026-03-05")
ok("toDateOnly accepts epoch ms", toDateOnly(at(2026, 12, 31, 18).getTime()) === "2026-12-31")
ok("toDateOnly invalid -> empty", toDateOnly(new Date("junk")) === "")
{
  const d = new Date(0)
  d.setFullYear(50, 0, 1)
  ok("toDateOnly pads a short year", toDateOnly(d) === "0050-01-01")
}

// --- round-trips over every day of 2024–2026, which crosses both DST changes
// each year in Los Angeles (none in Kolkata) and a leap day ---
{
  let broken = ""
  let days = 0
  for (let d = at(2024, 1, 1); d.getFullYear() < 2027; d = addDays(d, 1)) {
    days++
    const s = toDateOnly(d)
    const back = parseDateOnly(s)
    if (!same(back, startOfDay(d)) || toDateOnly(back) === "" || toDateOnly(back) !== s) {
      broken ||= s
    }
    // Noon and 23:30 on the same day give the same date string.
    if (toDateOnly(at(d.getFullYear(), d.getMonth() + 1, d.getDate(), 23, 30)) !== s)
      broken ||= `${s} 23:30`
  }
  ok(`round-trip every day 2024–2026 (${days} days)`, !broken && days === 1096, broken)
}
// The DST days themselves, explicitly.
for (const s of ["2026-03-08", "2026-11-01", "2024-03-10", "2024-11-03"]) {
  const d = parseDateOnly(s)
  ok(
    `DST day ${s} round-trips at 00:00`,
    toDateOnly(d) === s && d.getHours() === 0 && d.getMinutes() === 0,
  )
}

// --- startOfYear ---
ok("startOfYear", same(startOfYear(at(2026, 7, 15, 13, 45)), at(2026, 1, 1)))
ok("startOfYear on Jan 1st", same(startOfYear(at(2026, 1, 1)), at(2026, 1, 1)))
ok("startOfYear on Dec 31st late", same(startOfYear(at(2026, 12, 31, 23, 59)), at(2026, 1, 1)))
ok("startOfYear accepts epoch ms", same(startOfYear(at(2026, 5, 5).getTime()), at(2026, 1, 1)))
ok("startOfYear invalid -> invalid", bad(startOfYear(new Date("junk"))))
ok(
  "startOfYear of a parsed date",
  toDateOnly(startOfYear(parseDateOnly("2026-11-01"))) === "2026-01-01",
)

// --- purity: inputs are never changed ---
{
  const input = at(2026, 11, 1, 10, 20)
  const t = input.getTime()
  toDateOnly(input)
  startOfYear(input)
  ok("toDateOnly/startOfYear never mutate", input.getTime() === t)
  ok("startOfYear returns a new object", startOfYear(input) !== input)
  const s = "2026-11-01"
  parseDateOnly(s)
  ok("parseDateOnly leaves the string as is", s === "2026-11-01")
  const first = parseDateOnly(s)
  const second = parseDateOnly(s)
  first.setFullYear(1999)
  ok(
    "parseDateOnly returns a fresh Date each call",
    first !== second && second.getFullYear() === 2026,
  )
  const fmtIn = at(2026, 11, 1)
  const ft = fmtIn.getTime()
  createDateFormatter("en-IN")(fmtIn)
  createDateShortFormatter("en-IN")(fmtIn)
  ok("formatters never mutate a Date input", fmtIn.getTime() === ft)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
