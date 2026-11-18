import { expect, test } from "bun:test"
import { createAppWorkflows } from "../api/workflows.ts"
import { app, db, post, signIn } from "./helpers.ts"

// server.ts runs the runner; the tests tick it by hand.
const runner = createAppWorkflows(db)
const get = (path: string, cookie: string) => app.request(path, { headers: { cookie } })
const userId = async (cookie: string) =>
  ((await (await get("/api/account/me", cookie)).json()) as { user: { id: string } }).user.id

test("an approval request: started, waiting on its approver, decided, finished", async () => {
  const asker = await signIn("+919000000061")
  const approver = await signIn("+919000000062")
  const other = await signIn("+919000000063")
  const input = { summary: "Approve this request", approvers: [await userId(approver)] }
  const started = await post("/api/workflows/runs", { workflow: "approval-request", input }, asker)
  expect(started.status).toBe(201)
  const run = (await started.json()) as { id: string }
  await runner.tick()

  expect(await (await get("/api/workflows/approvals", approver)).json()).toMatchObject([
    { runId: run.id, stepId: "approval", summary: "Approve this request" },
  ])
  // Someone else's run reads as missing; only a listed approver decides.
  expect((await get(`/api/workflows/runs/${run.id}`, other)).status).toBe(404)
  const approve = `/api/workflows/runs/${run.id}/steps/approval/approve`
  expect((await post(approve, {}, asker)).status).toBe(403)
  expect((await post(approve, { reason: "Looks right" }, approver)).status).toBe(200)
  await runner.tick()

  const done = (await (await get(`/api/workflows/runs/${run.id}`, asker)).json()) as {
    run: { status: string; output: unknown }
  }
  expect(done.run).toMatchObject({
    status: "completed",
    output: { approved: true, reason: "Looks right" },
  })
})

test("over HTTP, people start the example workflow and nothing else", async () => {
  const cookie = await signIn("+919000000064")
  const res = await post("/api/workflows/runs", { workflow: "something-else", input: {} }, cookie)
  expect(res.status).toBe(403)
})
