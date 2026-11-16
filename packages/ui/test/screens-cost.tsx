/**
 * Cost dashboard: the tiles, the four cards, the money rule, cap colours and
 * "No cap", the range select, and the loading, error and retry states.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { CostDashboard, DEFAULT_COST_LABELS } = await import(
  "../src/components/screens/cost-dashboard"
)

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
const tick = () => new Promise((r) => setTimeout(r, 20))

const HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
const DATA = {
  series: [
    { day: "2026-11-14", units: 1_500_000, calls: 10, cacheSavedUnits: 500_000 },
    { day: "2026-11-15", units: 2_500_000, calls: 14, cacheSavedUnits: 1_500_000 },
  ],
  models: [
    { model: "small-model", units: 1_000_000, calls: 20 },
    { model: "big-model", units: 3_000_000, calls: 4 },
  ],
  top: [{ subject: HASH, units: 2_000_000, calls: 7 }],
  caps: {
    day: { used: 4_000_000, cap: 4_000_000 },
    month: { used: 4_000_000, cap: null },
  },
}

await t("CostDashboard: tiles, cards, money, caps", async () => {
  render(<CostDashboard data={DATA} className="mine" data-x="1" />)
  await tick()
  const root = document.querySelector("[data-slot=cost-dashboard]") as HTMLElement
  ok(
    "className and data-* reach the root",
    root.classList.contains("mine") && root.dataset.x === "1",
  )
  const text = document.body.textContent ?? ""
  ok("spend and calls", text.includes("$4.00") && text.includes("24 calls"), text)
  ok("cache saved and share avoided", text.includes("$2.00") && text.includes("33% avoided"))
  ok("top model is the biggest, not the first row", text.includes("big-model"))
  ok("spend chart rendered", !!document.querySelector("[data-slot=chart-spend] [data-slot=chart]"))
  const models = [...document.querySelectorAll("[data-slot=cost-model]")] as HTMLElement[]
  ok(
    "models biggest first",
    models.map((m) => m.dataset.model).join() === "big-model,small-model",
    models.map((m) => m.dataset.model),
  )
  const bar = models[1]?.querySelector("[aria-hidden] > div") as HTMLElement
  ok("bar is the share of the top model", bar?.style.width.startsWith("33.3"), bar?.style.width)
  const subject = document.querySelector("[data-slot=cost-subject]") as HTMLElement
  ok("hash exactly as given, full in title", subject.dataset.subject === HASH)
  const hashEl = subject.querySelector("span") as HTMLElement
  ok(
    "hash is mono, truncated, with the full title",
    hashEl.title === HASH &&
      hashEl.className.includes("font-mono") &&
      hashEl.className.includes("truncate"),
  )
  ok("no links", !document.querySelector("[data-slot=cost-top] a"))
  ok(
    "bars are hidden from assistive tech, the amount is text",
    !!document.querySelector("[data-slot=cost-model] [aria-hidden=true]") && text.includes("$3.00"),
  )
  const day = document.querySelector("[data-period=day]") as HTMLElement
  ok(
    "a cap at 100% is red and shows its percent",
    day.innerHTML.includes("accent-red") && (day.textContent ?? "").includes("100%"),
    day.outerHTML,
  )
  const month = document.querySelector("[data-period=month]") as HTMLElement
  ok(
    "a null cap says No cap and has no bar",
    (month.textContent ?? "").includes("No cap") && !month.querySelector("[data-slot=progress]"),
  )
  ok(
    "figures are labelled by their caption",
    [...document.querySelectorAll("figure")].every((f) => {
      const id = f.getAttribute("aria-labelledby")
      return !!id && document.getElementById(id)?.tagName === "FIGCAPTION"
    }),
  )
})

await t("CostDashboard: cap colour follows usage", async () => {
  const cap = (used: number) => ({
    ...DATA,
    caps: { day: { used, cap: 100 }, month: { used: 0, cap: null } },
  })
  const tones: string[] = []
  for (const used of [79, 80, 99, 100, 112]) {
    const { unmount } = render(<CostDashboard data={cap(used)} />)
    const row = document.querySelector("[data-period=day]") as HTMLElement
    tones.push(row.querySelector("[data-tone]")?.getAttribute("data-tone") ?? "?")
    if (used === 112)
      ok("over 100% shows the real percent", (row.textContent ?? "").includes("112%"))
    unmount()
  }
  ok("ok, warn, warn, over, over", tones.join() === "ok,warn,warn,over,over", tones)
})

await t("CostDashboard: money under one cent", () => {
  const m = DEFAULT_COST_LABELS.money
  ok("zero is $0.00", m(0) === "$0.00", m(0))
  ok("under a cent", m(1) === "<$0.01" && m(9_999) === "<$0.01")
  ok("a cent", m(10_000) === "$0.01", m(10_000))
})

await t("CostDashboard: labels and empty cards", () => {
  render(
    <CostDashboard
      data={{ series: [], models: [], top: [] }}
      labels={{ title: "Kosten", money: (u) => `${u} u`, empty: "Leer" }}
    />,
  )
  ok("title from labels", !!screen.getByRole("heading", { name: "Kosten" }))
  ok("an empty message per card", screen.getAllByText("Leer").length === 3)
  ok("no caps card without caps", !document.querySelector("[data-slot=cost-caps]"))
})

await t("CostDashboard: range select", async () => {
  const seen: number[] = []
  render(<CostDashboard data={DATA} onDaysChange={(d) => seen.push(d)} />)
  const select = screen.getByLabelText("Range") as HTMLSelectElement
  ok("offers 7, 30 and 90", [...select.options].map((o) => o.value).join() === "7,30,90")
  ok("default is 30", select.value === "30")
  await userEvent.selectOptions(select, "90")
  ok("onDaysChange", seen.join() === "90", seen)
})

await t("CostDashboard: loading and error states", async () => {
  const { rerender } = render(<CostDashboard loading />)
  const section = document.querySelector("[data-slot=cost-dashboard]") as HTMLElement
  ok(
    "aria-busy and a status",
    section.getAttribute("aria-busy") === "true" && !!screen.getByRole("status"),
  )
  let retried = 0
  rerender(<CostDashboard error onRetry={() => retried++} />)
  ok("error alert", !!screen.getByRole("alert") && !!screen.getByText("Couldn't load costs."))
  await userEvent.click(screen.getByRole("button", { name: "Retry" }))
  ok("Retry calls onRetry", retried === 1)
})

await t("CostDashboard: fetcher loads, reloads on a new range, retries", async () => {
  const calls: number[] = []
  let failNext = true
  const fetcher = async (days: number) => {
    calls.push(days)
    if (failNext) {
      failNext = false
      throw new Error("down")
    }
    return DATA
  }
  render(<CostDashboard fetcher={fetcher} />)
  await waitFor(() => screen.getByText("Couldn't load costs."))
  ok("first call is the default range", calls.join() === "30", calls)
  await userEvent.click(screen.getByRole("button", { name: "Retry" }))
  await waitFor(() => screen.getByText("big-model", { selector: "[data-slot=cost-model] span" }))
  ok("Retry calls the fetcher again", calls.join() === "30,30", calls)
  await userEvent.selectOptions(screen.getByLabelText("Range"), "7")
  await waitFor(() => calls.length === 3)
  ok("a new range re-runs the fetcher", calls.join() === "30,30,7", calls)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
