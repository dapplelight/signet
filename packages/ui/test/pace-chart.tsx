/**
 * PaceChart: the model (even pace, projection, limit point), the five
 * screen-reader sentences, hiding and overriding parts, and the four states.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register({
  settings: { disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
})
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  constructor(private cb: (e: unknown[]) => void) {}
  observe() {
    this.cb([{ contentRect: { width: 600, height: 240 } }])
  }
  unobserve() {}
  disconnect() {}
}

const { cleanup, render, screen } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { PaceChart, paceModel } = await import("../src/components/ui/chart")

let pass = 0
let fail = 0
function ok(name: string, cond: boolean) {
  if (cond) pass++
  else {
    fail++
    console.error(`FAIL: ${name}`)
  }
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const WEEK = DAYS.map((label, i) => ({
  label,
  name: FULL[i],
  used: i < 4 ? [60, 130, 220, 320][i] : null,
}))

// 320 used by Thursday (index 3) is 80 a period: 500 is reached at index 5.25.
const m = paceModel(WEEK, 500)
ok("Now is the last period with use", m.nowIndex === 3 && m.used === 320)
ok("projection ends at the limit", m.projection?.endValue === 500 && m.projection.reachesLimit)
ok("the limit point is where the projection crosses", m.limitX === 5.25)
ok(
  "a row is added at the crossing",
  m.rows.some((r) => r.x === 5.25 && r.projected === 500),
)
ok("even pace ends at the limit", m.rows.find((r) => r.x === 6)?.pace === 500)
ok("projection starts at Now with the used value", m.rows.find((r) => r.x === 3)?.projected === 320)

ok(
  "no limit, no projection, no pace",
  (() => {
    const n = paceModel(WEEK, undefined)
    return n.projection === null && n.rows.every((r) => r.pace === null)
  })(),
)
ok(
  "over the limit: no projection, the limit point sits at the end",
  (() => {
    const n = paceModel(WEEK, 300)
    return n.projection === null && n.limitX === 6
  })(),
)
ok(
  "slow use never reaches the limit: projection runs to the end",
  (() => {
    const n = paceModel(WEEK, 5000)
    return n.projection?.reachesLimit === false && n.projection.endX === 6 && n.limitX === 6
  })(),
)
ok(
  "nothing used: no Now, no projection",
  (() => {
    const n = paceModel(
      DAYS.map((label) => ({ label })),
      500,
    )
    return n.nowIndex === -1 && n.projection === null
  })(),
)
ok("an explicit now wins", paceModel(WEEK, 500, "Tue").nowIndex === 1)

function sentences() {
  return [...document.querySelectorAll('[data-slot="pace-descriptions"] li')].map(
    (li) => li.textContent,
  )
}

render(<PaceChart title="Usage" data={WEEK} limit={500} />)
ok(
  "the five default sentences",
  sentences().join("|") ===
    [
      "On pace: even use reaches 500 by Sunday.",
      "Used so far: 320 by Thursday.",
      "Projected: reaches 500 on Saturday.",
      "Now: Thursday.",
      "Limit: 500.",
    ].join("|"),
)
const img = screen.getByRole("img")
ok("the chart has a summary label", (img.getAttribute("aria-label") ?? "").includes("Limit: 500."))
ok(
  "lines are drawn straight and solid or dashed",
  (() => {
    const paths = [...document.querySelectorAll("path.recharts-line-curve")]
    return (
      paths.length === 3 && paths.filter((p) => p.getAttribute("stroke-dasharray")).length === 2
    )
  })(),
)
ok(
  "Now and limit labels render",
  document.body.textContent?.includes("500 limit") === true &&
    document.body.textContent?.includes("Now") === true,
)
cleanup()

render(
  <PaceChart
    data={WEEK}
    limit={500}
    hide={{ pace: true, now: true }}
    labels={{ used: "Spent" }}
    descriptions={{ used: "Spent a lot." }}
    colors={{ used: "red" }}
    classNames={{ used: "my-used" }}
  />,
)
ok(
  "hidden parts have no sentence",
  !sentences().some((s) => s?.startsWith("On pace") || s?.startsWith("Now")),
)
ok("a description is overridden", sentences().includes("Spent a lot."))
ok("a className lands on the line", !!document.querySelector(".my-used"))
ok(
  "a colour reaches the chart style",
  document.querySelector("style")?.textContent?.includes("--color-used: red;") === true,
)
cleanup()

render(<PaceChart data={WEEK} />)
ok("no limit: only used and Now are described", sentences().length === 2)
cleanup()

render(<PaceChart data={WEEK} limit={300} />)
ok(
  "over the limit: no projection sentence, limit stays",
  (() => {
    const s = sentences()
    return !s.some((x) => x?.startsWith("Projected")) && s.includes("Limit: 300.")
  })(),
)
cleanup()

render(<PaceChart title="Usage" data={[]} slot={<button type="button">Week</button>} />)
ok(
  "empty state",
  !!screen.queryByText("No usage yet") &&
    !!screen.queryByText("Usage appears here once it starts."),
)
ok("the slot stays", !!screen.queryByText("Week"))
cleanup()

render(
  <PaceChart
    title="Usage"
    data={WEEK}
    state="loading"
    slot={<button type="button">Week</button>}
  />,
)
ok(
  "loading keeps the header and slot",
  !!screen.queryByText("Usage") && !!screen.queryByText("Week"),
)
ok("loading shows no chart", !screen.queryByRole("img"))
cleanup()

let retries = 0
render(<PaceChart data={WEEK} state="error" onRetry={() => retries++} />)
ok("error message", !!screen.queryByText("Couldn't load usage"))
await userEvent.click(screen.getByRole("button"))
ok("retry calls onRetry", retries === 1)
cleanup()

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) throw new Error(`${fail} failed`)
