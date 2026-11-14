/**
 * Domain components outside the barrel: JobRuns (and Upload, below).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { JobRuns } = await import("../src/components/domain/job-runs")
type JobRun = import("../src/components/domain/job-runs").JobRun

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

await t("JobRuns", async () => {
  const runs: JobRun[] = [
    {
      id: "r1",
      job: "send-receipt",
      state: "dead",
      attempt: 3,
      error: { code: "UPSTREAM", message: "mail down" },
    },
    {
      id: "r2",
      job: "import",
      state: "running",
      attempt: 1,
      progress: { done: 2, total: 5, note: "row 2" },
    },
    { id: "r3", job: "import", state: "done", attempt: 1 },
  ]
  const retried: string[] = []
  const cancelled: string[] = []
  render(
    <JobRuns
      runs={runs}
      onRetry={(r) => retried.push(r.id)}
      onCancel={(r) => cancelled.push(r.id)}
    />,
  )
  ok("status badges", screen.getByText("dead").getAttribute("data-slot") === "badge")
  ok("error shown", !!screen.getByText(/UPSTREAM: mail down/))
  ok("progress shown", !!screen.getByText("2/5 · row 2"))
  ok("retry only on dead", screen.getAllByRole("button", { name: /^Retry/ }).length === 1)
  ok("cancel only on unfinished", screen.getAllByRole("button", { name: /^Cancel/ }).length === 1)
  await userEvent.click(screen.getByRole("button", { name: "Retry send-receipt r1" }))
  await userEvent.click(screen.getByRole("button", { name: "Cancel import r2" }))
  ok("callbacks get the run", retried.join() === "r1" && cancelled.join() === "r2")
  cleanup()
  render(<JobRuns runs={[]} />)
  ok("empty message", !!screen.getByText("No job runs"))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
