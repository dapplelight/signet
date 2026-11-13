import {
  createCompactCurrencyFormatter,
  createCurrencyFormatter,
  createDateFormatter,
  createDateShortFormatter,
  createDateTimeFormatter,
  createRelativeTimeFormatter,
  formatPercent,
} from "../src/format"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const inr = createCurrencyFormatter("INR", "en-IN")
ok("INR whole units", inr(1234).replace(/ /g, " ").includes("1,234"))
ok("INR precise has decimals", inr(1234.5, true).includes(".50"))
ok("accepts string amounts", inr("1234") === inr(1234))
ok("non-finite falls back to zero", inr(Number.NaN).includes("0"))

const usd = createCurrencyFormatter("USD", "en-US")
ok("USD formats with $", usd(1234).includes("$"))
ok("currency actually switches", usd(1) !== inr(1))

// Indian lakh/crore — Intl compact gives "1.2M" for 12 lakh, which is wrong here
const cInr = createCompactCurrencyFormatter("INR", "en-IN")
ok("12 lakh -> L", cInr(1_200_000).includes("12L"), cInr(1_200_000))
ok("3.5 crore -> Cr", cInr(35_000_000).includes("3.5Cr"), cInr(35_000_000))
ok("negative keeps sign", cInr(-1_200_000).startsWith("-"), cInr(-1_200_000))
ok("below a lakh is not compacted", !cInr(5000).includes("L"), cInr(5000))
ok("trims trailing zeros", cInr(10_000_000) === "₹1Cr", cInr(10_000_000))

const cUsd = createCompactCurrencyFormatter("USD", "en-US")
ok("non-Indian locale uses Intl compact", /K|M/.test(cUsd(1_200_000)), cUsd(1_200_000))
ok("USD does NOT get lakh/crore", !cUsd(1_200_000).includes("L"), cUsd(1_200_000))

// Odia and Assamese use lakh/crore too
for (const loc of ["or-IN", "as-IN", "hi-IN", "bn-IN"]) {
  const c = createCompactCurrencyFormatter("INR", loc)(1_200_000)
  ok(`${loc} gets lakh/crore`, c.endsWith("12L"), c)
}
ok(
  "a locale that merely starts with the letters is not lakh/crore",
  !createCompactCurrencyFormatter("EUR", "ast")(1_200_000).endsWith("L"),
)

// Each currency's own fraction digits
ok(
  "JPY precise has 0 decimals",
  createCurrencyFormatter("JPY", "en-US")(1234.5, true) === "¥1,235",
  createCurrencyFormatter("JPY", "en-US")(1234.5, true),
)
ok(
  "KWD precise has 3 decimals",
  createCurrencyFormatter("KWD", "en-US")(1.2345, true).endsWith("1.235"),
  createCurrencyFormatter("KWD", "en-US")(1.2345, true),
)
ok(
  "BHD precise has 3 decimals",
  createCurrencyFormatter("BHD", "en-US")(2, true).endsWith("2.000"),
  createCurrencyFormatter("BHD", "en-US")(2, true),
)
ok("USD precise still has 2 decimals", usd(1.5, true).endsWith("1.50"), usd(1.5, true))

// Minor units and bigint
const usdMinor = createCurrencyFormatter("USD", "en-US", { minorUnits: true })
ok("minor units: 12345 cents", usdMinor(12345, true) === "$123.45", usdMinor(12345, true))
ok("minor units: string input", usdMinor("12345", true) === "$123.45")
ok("minor units: negative", usdMinor(-5, true) === "-$0.05", usdMinor(-5, true))
ok(
  "minor units: JPY has no minor unit",
  createCurrencyFormatter("JPY", "en-US", { minorUnits: true })(1234) === "¥1,234",
)
ok(
  "minor units: KWD 1234 fils",
  createCurrencyFormatter("KWD", "en-US", { minorUnits: true })(1234, true).endsWith("1.234"),
)
ok("bigint major units", usd(12n, true) === "$12.00", usd(12n, true))
ok(
  "bigint minor units beyond 2^53 stay exact",
  usdMinor(900719925474099312345n, true) === "$9,007,199,254,740,993,123.45",
  usdMinor(900719925474099312345n, true),
)
ok("bigint minor negative", usdMinor(-5n, true) === "-$0.05", usdMinor(-5n, true))
ok(
  "compact takes minor units",
  createCompactCurrencyFormatter("INR", "en-IN", 1, { minorUnits: true })(120_000_000n) === "₹12L",
)
ok("compact takes bigint", cInr(35_000_000n) === "₹3.5Cr", cInr(35_000_000n))
ok("percent takes bigint", formatPercent(5n) === "+5.0%")

ok("percent signs positive", formatPercent(4.25) === "+4.3%") // rounds
ok("percent signs negative", formatPercent(-2) === "-2.0%")
ok("percent handles junk", formatPercent("abc") === "0%")

const df = createDateFormatter("en-IN")
ok("formats a date", df("2026-03-15").includes("2026"))
ok("invalid date -> empty", df("nonsense") === "")
ok("short format omits year", !createDateShortFormatter("en-IN")("2026-03-15").includes("2026"))

// timeZone: the same instant, shown in the zone asked for
const instant = "2026-03-15T20:00:00Z" // 01:30 on 16 Mar in Kolkata, 16:00 on 15 Mar in New York
ok(
  "timeZone shifts the day (Kolkata)",
  createDateFormatter("en-US", { timeZone: "Asia/Kolkata" })(instant) === "Mar 16, 2026",
  createDateFormatter("en-US", { timeZone: "Asia/Kolkata" })(instant),
)
ok(
  "timeZone shifts the day (New York)",
  createDateFormatter("en-US", { timeZone: "America/New_York" })(instant) === "Mar 15, 2026",
)
ok(
  "timeZone on the short formatter",
  createDateShortFormatter("en-US", { timeZone: "Asia/Kolkata" })(instant) === "Mar 16",
)
const dtKolkata = createDateTimeFormatter("en-US", { timeZone: "Asia/Kolkata" })(instant)
ok("timeZone on the date-time formatter", /1:30\sAM/.test(dtKolkata), dtKolkata)
ok(
  "date-only string is not shifted by timeZone",
  ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"].every(
    (timeZone) => createDateFormatter("en-US", { timeZone })("2026-03-15") === "Mar 15, 2026",
  ),
)
ok(
  "timeZone with an invalid date -> empty",
  createDateFormatter("en-US", { timeZone: "Asia/Kolkata" })("nonsense") === "",
)

const rel = createRelativeTimeFormatter("en-US")
const now = new Date("2026-03-15T12:00:00Z")
ok(
  "past day",
  rel("2026-03-12T12:00:00Z", now).includes("3 days ago"),
  rel("2026-03-12T12:00:00Z", now),
)
ok(
  "future hours",
  rel("2026-03-15T15:00:00Z", now).includes("3 hours"),
  rel("2026-03-15T15:00:00Z", now),
)
ok("relative invalid -> empty", rel("junk", now) === "")

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
