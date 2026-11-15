/**
 * Workflow screens: the run timeline (status, waiting on whom, steps in
 * order, retries, decisions, cancel) and the approval inbox card.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { ApprovalInboxCard, WorkflowRunTimeline, waitingText } = await import(
  "../src/components/screens/workflow-screens"
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

const at = "2026-11-01T10:00:00.000Z"
const run = {
  id: "r1",
  workflow: "expense",
  status: "waiting" as const,
  createdAt: at,
  waitingOn: {
    step: "approval",
    kind: "approval" as const,
    until: at,
    approvers: ["Asha", "Ravi"],
  },
}
const steps = [
  {
    stepId: "load",
    kind: "run" as const,
    status: "completed" as const,
    attempts: 1,
    startedAt: at,
  },
  {
    stepId: "charge",
    kind: "run" as const,
    status: "completed" as const,
    attempts: 3,
    error: "card network down",
    startedAt: at,
  },
  {
    stepId: "approval",
    kind: "approval" as const,
    status: "waiting" as const,
    approvers: ["Asha", "Ravi"],
    summary: "Expense 4,000",
    startedAt: at,
  },
]

await t("WorkflowRunTimeline", async () => {
  let cancelled = 0
  render(<WorkflowRunTimeline run={run} steps={steps} onCancel={() => cancelled++} />)
  const region = screen.getByRole("region", { name: "expense" })
  ok(
    "status badge",
    region.querySelector("[data-slot=workflow-run-status]")?.textContent === "Waiting",
  )
  ok(
    "says who it waits on",
    screen.getAllByRole("status").some((s) => s.textContent === "Waiting on Asha, Ravi"),
  )
  const list = within(region).getByRole("list", { name: "Steps" })
  const items = within(list).getAllByRole("listitem")
  ok("steps in order", items.length === 3 && items[0]?.textContent?.includes("load"), items.length)
  ok("retries shown", !!within(list).getByText("3 attempts"))
  ok("a recovered step hides its old error", !within(list).queryByText("card network down"))
  ok("approval step uses its summary", !!within(list).getByText("Expense 4,000"))
  ok(
    "data-status on the root",
    !!document.querySelector("[data-slot=workflow-run][data-status=waiting]"),
  )
  await userEvent.click(within(region).getByRole("button", { name: "Cancel run" }))
  await waitFor(() => ok("cancel called", cancelled === 1))
})

await t("WorkflowRunTimeline: finished run", async () => {
  render(
    <WorkflowRunTimeline
      run={{ ...run, status: "completed", waitingOn: null }}
      steps={[
        {
          ...steps[2]!,
          status: "completed",
          output: { approved: false, by: "Ravi", reason: "too much" },
        },
        { stepId: "receipt", kind: "event", status: "completed", output: null, startedAt: at },
      ]}
      onCancel={() => {}}
    />,
  )
  ok("decision shown", !!screen.getByText("Rejected by Ravi"))
  ok("event timeout shown", !!screen.getByText("Timed out"))
  ok("no cancel once done", !screen.queryByRole("button", { name: "Cancel run" }))
  ok("no waiting line", waitingText({ ...run, status: "completed" }) === null)
})

await t("ApprovalInboxCard", async () => {
  const calls: string[] = []
  let failNext = true
  render(
    <ApprovalInboxCard
      approvals={[
        {
          runId: "r1",
          stepId: "approval",
          workflow: "expense",
          summary: "Expense 4,000",
          approvers: ["Asha"],
          requestedAt: at,
          expiresAt: at,
        },
        {
          runId: "r2",
          stepId: "approval",
          workflow: "refund",
          summary: "Refund 900",
          approvers: ["Asha"],
          requestedAt: at,
        },
      ]}
      onApprove={async (a, reason) => {
        if (failNext) {
          failNext = false
          throw new Error("offline")
        }
        calls.push(`approve:${a.runId}:${reason ?? ""}`)
      }}
      onReject={(a) => {
        calls.push(`reject:${a.runId}`)
      }}
      href={(a) => `/runs/${a.runId}`}
    />,
  )
  const region = screen.getByRole("region", { name: /Approvals/ })
  const items = within(region).getAllByRole("listitem")
  ok("two items", items.length === 2)
  ok(
    "summary links to the run",
    within(items[0]!).getByRole("link", { name: "Expense 4,000" }).getAttribute("href") ===
      "/runs/r1",
  )
  const first = within(items[0]!)
  await userEvent.type(first.getByLabelText("Reason (optional)"), "ok by policy")
  await userEvent.click(first.getByRole("button", { name: "Approve" }))
  await waitFor(() => ok("failure says retry", !!first.getByText("Couldn't save. Try again.")))
  await userEvent.click(first.getByRole("button", { name: "Approve" }))
  await waitFor(() => ok("approved announced", !!first.getByText("Approved")))
  ok("reason sent", calls[0] === "approve:r1:ok by policy", calls)
  ok("buttons gone once decided", !first.queryByRole("button", { name: "Approve" }))
  await userEvent.click(within(items[1]!).getByRole("button", { name: "Reject" }))
  await waitFor(() => ok("rejected", calls[1] === "reject:r2", calls))
})

await t("ApprovalInboxCard: empty", async () => {
  render(<ApprovalInboxCard approvals={[]} onApprove={() => {}} onReject={() => {}} />)
  ok("empty state", !!screen.getByText("Nothing waiting on you"))
  ok("data-empty", !!document.querySelector("[data-slot=approval-inbox][data-empty]"))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
