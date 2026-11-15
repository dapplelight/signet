/**
 * Domain components and hooks from the ui-domain batch: amount, kanban, and
 * the use-debounce / use-local-storage / use-copy / use-intersection hooks.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen } = await import("@testing-library/react")
const { Amount, formatAmount } = await import("../src/components/domain/amount")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (e) {
    ok(`${name} (threw: ${(e as Error).message.split("\n")[0]})`, false)
  } finally {
    cleanup()
  }
}
const text = (v: Parameters<typeof formatAmount>[0], o?: Parameters<typeof formatAmount>[1]) =>
  formatAmount(v, o)
    .parts.map((p) => p.value)
    .join("")

await t("formatAmount", () => {
  ok("INR groups by lakh", text(1250000) === "₹12,50,000.00", text(1250000))
  ok("negative", text(-1234.5) === "-₹1,234.50", text(-1234.5))
  ok("whole drops decimals", text(1234.56, { notation: "whole" }) === "₹1,235")
  ok("compact lakh", text(1250000, { notation: "compact" }) === "₹12.5L")
  ok("compact crore", text(-12500000, { notation: "compact" }) === "-₹1.3Cr")
  ok("compact below a lakh is the full amount", text(99999, { notation: "compact" }) === "₹99,999")
  ok(
    "USD compact uses Intl",
    text(1300000, { currency: "USD", locale: "en-US", notation: "compact" }) === "$1.3M",
    text(1300000, { currency: "USD", locale: "en-US", notation: "compact" }),
  )
  ok("minor units", text(12345, { minorUnits: true }) === "₹123.45")
  ok("JPY has no decimals", text(1234, { currency: "JPY", locale: "ja-JP" }).endsWith("1,234"))
  ok(
    "bigint minor units stay exact",
    text(123456789012345678n, { minorUnits: true }) === "₹1,23,45,67,89,01,23,456.78",
    text(123456789012345678n, { minorUnits: true }),
  )
  ok("junk is zero", text("abc") === "₹0.00")
  ok("exceptZero signs credits", text(5, { signDisplay: "exceptZero" }) === "+₹5.00")
})

await t("Amount", () => {
  render(
    <>
      <Amount data-testid="a" value={-1500} tone="auto" classNames={{ currency: "cur" }} />
      <Amount data-testid="b" value={2500} tone="auto" />
      <Amount data-testid="c" value={0} tone="auto" />
      <Amount data-testid="d" value={1250000} notation="compact" />
      <Amount data-testid="e" value={10} tone="transfer" render={<span className="x" />} />
    </>,
  )
  const a = screen.getByTestId("a")
  ok(
    "renders a <data> with the exact value",
    a.tagName === "DATA" && a.getAttribute("value") === "-1500",
  )
  ok("auto tone: negative is debit", a.dataset.tone === "debit" && a.dataset.sign === "negative")
  ok("debit reads the money slot", a.className.includes("--money-debit"))
  ok(
    "parts carry data-part and classNames",
    a.querySelector('[data-part="currency"]')?.className === "cur",
  )
  const b = screen.getByTestId("b")
  ok(
    "auto tone: positive is credit and signed",
    b.dataset.tone === "credit" && b.textContent === "+₹2,500.00",
  )
  ok("credit falls back to accent-green", b.className.includes("var(--color-accent-green)"))
  const c = screen.getByTestId("c")
  ok("zero has no tone", c.dataset.tone === undefined && c.dataset.sign === "zero")
  const d = screen.getByTestId("d")
  ok(
    "compact shows the full amount on hover",
    d.title === "₹12,50,000.00" && d.textContent === "₹12.5L",
  )
  const e = screen.getByTestId("e")
  ok(
    "render swaps the element",
    e.tagName === "SPAN" && e.className.includes("x") && e.dataset.tone === "transfer",
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
