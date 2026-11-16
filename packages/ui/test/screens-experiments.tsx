/**
 * Experiment and status screens: the experiment list marks the selected one
 * and selects on click; the readout shows rates, lift and p-values, offers
 * start / stop / roll out by status and reports a failed action; the status
 * page shows the overall status, maintenance, components and incident updates.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { ExperimentList, ExperimentResults } = await import(
  "../src/components/screens/experiment-screens"
)
const { StatusPage } = await import("../src/components/screens/status-screens")

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

const EXP = {
  key: "onboarding-copy",
  description: "Shorter onboarding",
  status: "running" as const,
  variants: [
    { key: "control", weight: 50 },
    { key: "short", weight: 50, value: { steps: 3 } },
  ],
  goal: "signup",
}
const RESULTS = {
  goal: "signup",
  alpha: 0.05,
  control: "control",
  variants: [
    {
      key: "control",
      exposed: 200,
      converted: 20,
      rate: 0.1,
      lift: null,
      pValue: null,
      significant: false,
    },
    {
      key: "short",
      exposed: 200,
      converted: 60,
      rate: 0.3,
      lift: 2,
      pValue: 0.0000004,
      significant: true,
    },
  ],
}

await t("ExperimentList", async () => {
  const picked: string[] = []
  render(
    <ExperimentList
      experiments={[EXP, { ...EXP, key: "pricing", status: "draft" }]}
      selected="pricing"
      onSelect={(k) => picked.push(k)}
    />,
  )
  ok("statuses shown", !!screen.getByText("Running") && !!screen.getByText("Draft"))
  ok(
    "selected marked aria-current",
    screen.getByRole("button", { name: /pricing/ }).getAttribute("aria-current") === "true",
  )
  await userEvent.click(screen.getByRole("button", { name: /onboarding-copy/ }))
  ok("select calls back", picked[0] === "onboarding-copy", picked)
  cleanup()
  render(<ExperimentList experiments={[]} />)
  ok("empty state", !!screen.getByText("No experiments yet"))
})

await t("ExperimentResults: readout and actions while running", async () => {
  const calls: string[] = []
  render(
    <ExperimentResults
      experiment={EXP}
      results={RESULTS}
      onStart={() => calls.push("start")}
      onStop={() => calls.push("stop")}
      onRollout={(v) => calls.push(`rollout:${v}`)}
    />,
  )
  const row = document.querySelector("[data-variant=short]") as HTMLElement
  ok(
    "rate and lift",
    within(row).getByText("30.0%") !== null && within(row).getByText("+200.0%") !== null,
  )
  ok("tiny p-value shown as <0.001", !!within(row).getByText("<0.001"))
  ok("significant row marked", row.hasAttribute("data-significant"))
  ok(
    "control marked",
    !!within(document.querySelector("[data-variant=control]") as HTMLElement).getByText("Control"),
  )
  ok("no Start while running", !screen.queryByRole("button", { name: "Start" }))
  await userEvent.click(screen.getByRole("button", { name: "Stop" }))
  await userEvent.click(screen.getByRole("button", { name: "Roll out short" }))
  await waitFor(() =>
    ok("stop and rollout call back", calls.join() === "stop,rollout:short", calls),
  )
})

await t("ExperimentResults: draft, rolled out, no results, failure", async () => {
  const { rerender } = render(
    <ExperimentResults
      experiment={{ ...EXP, status: "draft" }}
      results={null}
      onStart={() => false}
      onRollout={() => {}}
    />,
  )
  ok(
    "draft offers Start, no rollout",
    !!screen.getByRole("button", { name: "Start" }) && !screen.queryByText("Roll out"),
  )
  ok("no results note", !!screen.getByText(/pass the analytics events table/))
  await userEvent.click(screen.getByRole("button", { name: "Start" }))
  await waitFor(() =>
    ok("false shows the failure", !!screen.getByText("Could not save. Try again.")),
  )
  rerender(
    <ExperimentResults
      experiment={{ ...EXP, status: "rolled_out", winner: "short" }}
      results={RESULTS}
      onStart={() => {}}
    />,
  )
  ok(
    "winner marked, no Start",
    (document.querySelector("[data-variant=short]") as HTMLElement).hasAttribute("data-winner") &&
      !screen.queryByRole("button", { name: /Start|Resume/ }),
  )
  rerender(<ExperimentResults experiment={{ ...EXP, status: "stopped" }} onStart={() => {}} />)
  ok("stopped offers Resume", !!screen.getByRole("button", { name: "Resume" }))
})

await t("StatusPage", () => {
  render(
    <StatusPage
      summary={{
        status: "partial_outage",
        components: [
          { key: "api", name: "API", status: "partial_outage" },
          { key: "web", name: "Website", description: "Marketing site", status: "operational" },
        ],
        incidents: [
          {
            id: "i1",
            title: "Slow sign-in",
            status: "identified",
            impact: "major",
            components: ["api"],
            updates: [
              { at: "2026-11-01T00:00:00Z", status: "investigating", message: "Looking into it" },
              { at: "2026-11-01T00:10:00Z", status: "identified", message: "Found the cause" },
            ],
            startedAt: "2026-11-01T00:00:00Z",
            resolvedAt: null,
          },
        ],
        maintenance: { on: true, message: "Upgrading the database", until: "2026-11-01T02:00:00Z" },
      }}
    />,
  )
  ok("overall status", !!screen.getByRole("status").textContent?.includes("Partial outage"))
  ok(
    "maintenance notice",
    !!screen.getByText("Upgrading the database") && !!screen.getByText(/Expected back by/),
  )
  ok(
    "components with status",
    document
      .querySelector("[data-slot=status-component][data-status=operational]")
      ?.textContent?.includes("Website") ?? false,
  )
  const inc = document.querySelector("[data-slot=status-incident]") as HTMLElement
  ok("incident component by name", !!within(inc).getByText("API"))
  const items = inc.querySelectorAll("[data-status]")
  ok(
    "updates newest first",
    items[0]?.getAttribute("data-status") === "identified",
    items[0]?.outerHTML,
  )
  cleanup()
  render(
    <StatusPage
      summary={{
        status: "operational",
        components: [],
        incidents: [],
        maintenance: { on: false, message: null, until: null },
      }}
    />,
  )
  ok(
    "all good, no incidents",
    !!screen.getByText("All systems operational") && !!screen.getByText(/No incidents/),
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
