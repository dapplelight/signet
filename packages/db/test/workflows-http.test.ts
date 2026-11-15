/**
 * signet-server's workflowRoutes over signet-db's real workflow engine on bun:sqlite: start,
 * visibility, approve/reject, cancel, events, the admin list, and an approval
 * decided in the MCP approval inbox (kvApprovals + approvalRoutes).
 */
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { memoryKv } from "../../server/src/adapters/index"
import { errorHandler } from "../../server/src/http/errors"
import { approvalRoutes } from "../../server/src/http/routes"
import { workflowRoutes } from "../../server/src/http/workflows"
import { kvApprovals } from "../../server/src/mcp/approvals"
import { workflowTables } from "../src/columns/sqlite"
import { createDb } from "../src/sqlite"
import { createWorkflows, defineWorkflow } from "../src/workflows"
import { ddl } from "./harness"

test("workflowRoutes end to end", async () => {
  const failed: string[] = []
  const ok = (n: string, c: boolean, d: unknown = "") => {
    if (!c) failed.push(`${n}: ${JSON.stringify(d)}`)
  }

  let clock = new Date("2026-11-01T00:00:00Z")
  const sqlite = new Database(":memory:")
  const tables = workflowTables()
  for (const t of Object.values(tables)) sqlite.run(ddl(t))
  const db = createDb(sqlite)

  const approvals = kvApprovals(memoryKv())
  const notified: string[] = []
  const expense = defineWorkflow("expense", async (step, input: { amount: number }) => {
    const d = await step.approval({
      approvers: ["boss"],
      summary: `Expense ${input.amount}`,
      timeout: 3_600_000,
    })
    if (!d.approved) return { paid: false }
    const receipt = await step.waitForEvent("receipt", { timeout: 3_600_000 })
    return { paid: true, receipt }
  })
  const wf = createWorkflows(db, {
    tables,
    workflows: [expense],
    approvals,
    approvalPollMs: 60_000,
    notify: (to) => notified.push(to),
    now: () => clock,
  })

  const user = (c: { req: { header(k: string): string | undefined } }) =>
    c.req.header("x-user") ?? ""
  const wfApp = workflowRoutes({
    workflows: wf,
    subject: user,
    isAdmin: (c) => user(c) === "admin",
    canStart: (c) => user(c) !== "nobody",
  })
  const inboxApp = approvalRoutes({ approvals, subject: user })
  for (const a of [wfApp, inboxApp]) a.onError(errorHandler({ isProduction: () => true }))

  const call = async (user: string, method: string, path: string, body?: unknown) => {
    const [app, rest] = path.startsWith("/wf")
      ? [wfApp, path.slice(3)]
      : [inboxApp, path.slice("/approvals".length) || "/"]
    const res = await app.request(rest, {
      method,
      headers: { "x-user": user, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status, json: (await res.json()) as any }
  }

  {
    ok(
      "canStart refuses",
      (await call("nobody", "POST", "/wf/runs", { workflow: "expense" })).status === 403,
    )
    ok(
      "unknown workflow 404",
      (await call("ann", "POST", "/wf/runs", { workflow: "nope" })).status === 404,
    )
    ok("bad body 400", (await call("ann", "POST", "/wf/runs", { workflow: 5 })).status === 400)
    const started = await call("ann", "POST", "/wf/runs", {
      workflow: "expense",
      input: { amount: 40 },
    })
    ok("started 201", started.status === 201 && started.json.status === "queued", started)
    const id = started.json.id as string
    await wf.tick()
    ok("approver notified", notified.join() === "boss", notified)
    ok("stranger sees 404", (await call("eve", "GET", `/wf/runs/${id}`)).status === 404)
    const asBoss = await call("boss", "GET", `/wf/runs/${id}`)
    ok(
      "approver sees the run, waiting on them",
      asBoss.status === 200 && asBoss.json.run.waitingOn.approvers[0] === "boss",
      asBoss.json,
    )
    const inbox = await call("boss", "GET", "/wf/approvals")
    ok("inbox lists the step", inbox.json.length === 1 && inbox.json[0].summary === "Expense 40")
    ok(
      "starter cannot approve",
      (await call("ann", "POST", `/wf/runs/${id}/steps/approval/approve`)).status === 403,
    )
    ok(
      "unknown step 404",
      (await call("boss", "POST", `/wf/runs/${id}/steps/nope/approve`)).status === 404,
    )
    const approved = await call("boss", "POST", `/wf/runs/${id}/steps/approval/approve`, {
      reason: "fine",
    })
    ok("approved", approved.json.approved === true && approved.json.reason === "fine", approved)
    ok(
      "second decision 409",
      (await call("boss", "POST", `/wf/runs/${id}/steps/approval/reject`)).status === 409,
    )
    const mcpInbox = await call("boss", "GET", "/approvals")
    ok("approval-inbox record closed too", mcpInbox.json.length === 0, mcpInbox.json)
    await wf.tick()
    ok(
      "events admin only",
      (await call("ann", "POST", "/wf/events", { name: "receipt" })).status === 403,
    )
    const sent = await call("admin", "POST", "/wf/events", {
      name: "receipt",
      payload: { n: 1 },
      runId: id,
    })
    ok("event woke the run", sent.json.woken === 1, sent.json)
    await wf.tick()
    const done = await call("ann", "GET", `/wf/runs/${id}`)
    ok(
      "completed with history",
      done.json.run.status === "completed" &&
        done.json.run.output.receipt.n === 1 &&
        done.json.steps.map((s: { stepId: string }) => s.stepId).join() === "approval,receipt",
      done.json,
    )
    ok("cancel ended run 409", (await call("ann", "POST", `/wf/runs/${id}/cancel`)).status === 409)
  }

  {
    const started = await call("bob", "POST", "/wf/runs", {
      workflow: "expense",
      input: { amount: 9 },
    })
    const id = started.json.id as string
    await wf.tick()
    const pending = await call("boss", "GET", "/approvals")
    ok(
      "record in the approval inbox",
      pending.json.length === 1 && pending.json[0].summary === "Expense 9",
    )
    ok(
      "denied there",
      (await call("boss", "POST", `/approvals/${pending.json[0].id}/deny`)).status === 200,
    )
    clock = new Date(clock.getTime() + 60_000)
    await wf.tick()
    const got = await call("bob", "GET", `/wf/runs/${id}`)
    ok("picked up on the next poll", got.json.run.output?.paid === false, got.json)

    const third = await call("bob", "POST", "/wf/runs", {
      workflow: "expense",
      input: { amount: 1 },
    })
    await wf.tick()
    ok(
      "approver cannot cancel",
      (await call("boss", "POST", `/wf/runs/${third.json.id}/cancel`)).status === 403,
    )
    ok(
      "starter cancels",
      (await call("bob", "POST", `/wf/runs/${third.json.id}/cancel`)).status === 200,
    )
    const own = await call("bob", "GET", "/wf/runs")
    const all = await call("admin", "GET", "/wf/runs?status=cancelled")
    ok("own runs only", own.json.length === 2 && own.json.every((r: any) => r.createdBy === "bob"))
    ok(
      "admin filters every run",
      all.json.length === 1 && all.json[0].id === third.json.id,
      all.json,
    )
  }

  expect(failed).toEqual([])
})
