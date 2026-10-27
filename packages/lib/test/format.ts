import {
  createCompactCurrencyFormatter,
  createCurrencyFormatter,
  createDateFormatter,
  createDateShortFormatter,
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

ok("percent signs positive", formatPercent(4.25) === "+4.3%") // rounds
ok("percent signs negative", formatPercent(-2) === "-2.0%")
ok("percent handles junk", formatPercent("abc") === "0%")

const df = createDateFormatter("en-IN")
ok("formats a date", df("2026-03-15").includes("2026"))
ok("invalid date -> empty", df("nonsense") === "")
ok("short format omits year", !createDateShortFormatter("en-IN")("2026-03-15").includes("2026"))

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
