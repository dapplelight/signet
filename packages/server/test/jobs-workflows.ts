import { z } from "zod"
import { createJobs, createTestJobs, defineJob, type JobMessage, jobTools } from "../src/jobs/index"
import type { ToolContext } from "../src/mcp/server"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

console.log("steps: a retry resumes after the last completed step")
{
  const calls: string[] = []
  let failB = true
  const job = defineJob({
    name: "pipeline",
    input: z.object({ id: z.string() }),
    retry: { attempts: 3, backoff: "fixed", baseSeconds: 30 },
    run: async ({ id }, { step }) => {
      const a = await step.run("fetch", () => {
        calls.push("fetch")
        return { id, n: 41 }
      })
      await step.run("charge", () => {
        calls.push("charge")
        if (failB) {
          failB = false
          throw new Error("card network down")
        }
      })
      calls.push(`finish:${a.n + 1}`)
    },
  })
  const jobs = createTestJobs({ jobs: [job] })
  const t0 = jobs.now()
  await job.enqueue({ id: "o1" })
  const results = await jobs.runAll()
  ok("retried then done", results.map((r) => r.status).join() === "retrying,done", results)
  ok("first step ran once", calls.filter((c) => c === "fetch").length === 1, calls)
  ok("failed step ran twice", calls.filter((c) => c === "charge").length === 2)
  ok("memoised result reused", calls.at(-1) === "finish:42")
  ok("clock advanced by the backoff", jobs.now() - t0 === 30_000)
}

console.log("steps: sleep re-enqueues instead of blocking")
{
  const calls: string[] = []
  const job = defineJob({
    name: "drip",
    input: z.object({}),
    run: async (_i, { step }) => {
      await step.run("welcome", () => void calls.push("welcome"))
      await step.sleep("wait-2-days", 2 * 86_400)
      await step.run("follow-up", () => void calls.push("follow-up"))
    },
  })
  const jobs = createTestJobs({ jobs: [job] })
  const t0 = jobs.now()
  await job.enqueue({})
  const first = await jobs.runAll({ advanceTime: false })
  ok("suspended while sleeping", first[0]?.status === "sleeping" && calls.join() === "welcome")
  ok("a timer is queued", jobs.queued.length === 1)
  const rest = await jobs.runAll()
  ok("woke and finished", rest.at(-1)?.status === "done" && calls.join() === "welcome,follow-up")
  ok(
    "long sleep hops in 12h legs",
    rest.length === 4,
    rest.map((r) => r.status),
  )
  ok("slept two days", jobs.now() - t0 === 2 * 86_400_000)
}

console.log("steps: waitFor an event, and its timeout")
{
  const got: unknown[] = []
  const job = defineJob({
    name: "await-payment",
    input: z.object({ orderId: z.string() }),
    run: async ({ orderId }, { step }) => {
      const paid = await step.waitFor<{ amount: number }>("paid", {
        event: `order.paid:${orderId}`,
        timeoutSeconds: 600,
      })
      got.push(paid)
    },
  })
  const jobs = createTestJobs({ jobs: [job] })
  await job.enqueue({ orderId: "a" })
  const r = await jobs.runAll({ advanceTime: false })
  ok("waiting", r[0]?.status === "waiting" && got.length === 0)
  const sent = await jobs.send("order.paid:a", { amount: 9 })
  ok("woke one waiter", sent.woken === 1)
  await jobs.runAll({ advanceTime: false })
  ok("got the payload", (got[0] as { amount: number } | undefined)?.amount === 9, got)
  const later = await jobs.runAll()
  ok("timeout timer skips the finished run", later.length === 1 && later[0]?.status === "skipped")
  ok("event again wakes nobody", (await jobs.emit("order.paid:a", {})).woken === 0)

  await job.enqueue({ orderId: "b" })
  await jobs.runAll()
  ok("timed out returns null", got.length === 2 && got[1] === null, got)
}

console.log("steps: waitForApproval, through jobs.approve and the agent tool")
{
  const decisions: unknown[] = []
  const job = defineJob({
    name: "refund",
    input: z.object({ amount: z.number() }),
    run: async ({ amount }, { step }) => {
      decisions.push(await step.waitForApproval("ok", `Refund ${amount}`))
    },
  })
  const jobs = createTestJobs({ jobs: [job] })
  const { id } = await job.enqueue({ amount: 40 })
  await jobs.runAll({ advanceTime: false })
  const pending = await jobs.listApprovals()
  ok("pending approval listed", pending[0]?.summary === "Refund 40" && pending[0]?.id === id)

  const ctx = {
    tool: "decide_job_approval",
    signal: new AbortController().signal,
    mcp: { mcpReq: { inputResponses: undefined } },
    confirmSupport: { getClientCapabilities: () => undefined },
  } as unknown as ToolContext
  const call = (tools: ReturnType<typeof jobTools>, name: string, input: unknown) =>
    (tools.find((t) => t.name === name)!.run as (i: unknown, c: ToolContext) => Promise<unknown>)(
      input,
      ctx,
    )
  const listed = (await call(jobTools(jobs), "list_pending_approvals", {})) as {
    pending: unknown[]
  }
  ok("list_pending_approvals", listed.pending.length === 1)
  const gated = (await call(jobTools(jobs), "decide_job_approval", {
    id,
    step: "ok",
    approved: true,
  })) as { structuredContent?: { code?: string } }
  ok("agent decision needs the person", gated.structuredContent?.code === "APPROVAL_REQUIRED")
  ok("still pending", (await jobs.listApprovals()).length === 1)
  await call(jobTools(jobs, { withoutApproval: true }), "decide_job_approval", {
    id,
    step: "ok",
    approved: true,
  })
  await jobs.runAll({ advanceTime: false })
  ok(
    "resumed approved",
    (decisions[0] as { approved: boolean; by?: string }).approved === true &&
      (decisions[0] as { by?: string }).by === "agent",
    decisions,
  )
  ok("approve twice is false", !(await jobs.approve(id, "ok")))

  const second = await job.enqueue({ amount: 5 })
  await jobs.runAll({ advanceTime: false })
  await jobs.approve(second.id, "ok", { approved: false, by: "ops" })
  await jobs.runAll({ advanceTime: false })
  ok("rejection delivered", (decisions[1] as { approved: boolean }).approved === false)
}

console.log("concurrency and rate limits re-enqueue, never drop")
{
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  let runs = 0
  const job = defineJob({
    name: "sync-account",
    input: z.object({ account: z.string() }),
    concurrency: { key: (i) => i.account, limit: 1 },
    run: async () => {
      runs++
      await gate
    },
  })
  const sent: { message: JobMessage; delaySeconds?: number }[] = []
  const jobs = createJobs({
    jobs: [job],
    throttleDelaySeconds: 7,
    queue: {
      async send(message, opts) {
        sent.push({ message, ...(opts?.delaySeconds ? { delaySeconds: opts.delaySeconds } : {}) })
      },
    },
  })
  await job.enqueue({ account: "x" })
  await job.enqueue({ account: "x" })
  await job.enqueue({ account: "y" })
  const first = jobs.handle(sent[0]!.message)
  await new Promise((r) => setTimeout(r, 5))
  const second = await jobs.handle(sent[1]!.message)
  ok("same key over the limit throttled", second.status === "throttled")
  ok(
    "re-enqueued with delay",
    sent[3]?.delaySeconds === 7 && sent[3]?.message.id === sent[1]?.message.id,
  )
  const other = jobs.handle(sent[2]!.message)
  await new Promise((r) => setTimeout(r, 5))
  ok("other key runs", runs === 2)
  release()
  await Promise.all([first, other])
  ok("slot freed after the run", (await jobs.handle(sent[3]!.message)).status === "done")

  const limited = defineJob({
    name: "call-partner",
    input: z.object({ partner: z.string() }),
    rateLimit: { key: (i) => i.partner, max: 2, windowSeconds: 60 },
    run() {},
  })
  const q: { message: JobMessage; delaySeconds?: number }[] = []
  const j2 = createJobs({
    jobs: [limited],
    queue: {
      async send(message, opts) {
        q.push({ message, ...(opts?.delaySeconds ? { delaySeconds: opts.delaySeconds } : {}) })
      },
    },
  })
  for (let i = 0; i < 3; i++) await limited.enqueue({ partner: "p" })
  const statuses = []
  for (let i = 0; i < 3; i++) statuses.push((await j2.handle(q[i]!.message)).status)
  ok("third over the rate limit", statuses.join() === "done,done,throttled", statuses)
  ok(
    "held for the next window",
    (q[3]?.delaySeconds ?? 0) > 0 && q[3]?.message.id === q[2]?.message.id,
  )
}

console.log("events: on / emit fan-out, triggers, outbox")
{
  const seen: string[] = []
  const welcome = defineJob({
    name: "welcome",
    input: z.object({ userId: z.string() }),
    run: ({ userId }) => void seen.push(`welcome:${userId}`),
  })
  const crm = defineJob({
    name: "crm",
    input: z.object({ userId: z.string() }),
    run: ({ userId }) => void seen.push(`crm:${userId}`),
  })
  const audit = defineJob({
    name: "audit",
    input: z.object({ userId: z.string() }),
    run: ({ userId }) => void seen.push(`audit:${userId}`),
  })
  const jobs = createTestJobs({
    jobs: [welcome, crm, audit],
    triggers: { "user.signup": [welcome] },
  })
  jobs.on("user.signup", [crm])
  jobs.on("user.deleted", [audit])
  const r = await jobs.emit("user.signup", { userId: "u1" })
  ok("fan-out started two", r.started === 2)
  await jobs.runAll()
  ok("both ran", seen.sort().join() === "crm:u1,welcome:u1", seen)
  const row = jobs.outboxEvent("user.deleted", { userId: "u2" })
  ok("outbox event row", row.topic === "event:user.deleted")
  await jobs.outboxQueue.send({ id: "r7", ...row })
  await jobs.outboxQueue.send({ id: "r7", ...row })
  await jobs.runAll()
  ok("outbox event delivered once", seen.filter((s) => s === "audit:u2").length === 1, seen)
  ok(
    "unregistered job in on() throws",
    (() => {
      try {
        jobs.on("x", [defineJob({ name: "stray", input: z.object({}), run() {} })])
        return false
      } catch {
        return true
      }
    })(),
  )
}

console.log("runAll guards a job that never stops")
{
  const loop = defineJob({
    name: "loop",
    input: z.object({}),
    run: async (_i, { step }) => {
      await step.sleep(`s-${Math.random()}`, 1)
    },
  })
  const jobs = createTestJobs({ jobs: [loop] })
  await loop.enqueue({})
  let threw = false
  try {
    await jobs.runAll({ maxRuns: 20 })
  } catch {
    threw = true
  }
  ok("maxRuns stops it", threw)
}

console.log("progress, status and cancel")
{
  const job = defineJob({
    name: "import",
    input: z.object({ rows: z.number() }),
    run: async ({ rows }, ctx) => {
      await ctx.step.run("read", () => rows)
      await ctx.progress(1, rows, "row 1")
      await ctx.step.sleep("pause", 60)
      await ctx.step.run("write", () => ctx.progress(rows, rows))
    },
  })
  const jobs = createTestJobs({ jobs: [job] })
  const { id } = await job.enqueue({ rows: 3 })
  ok("queued status", (await jobs.status(id))?.state === "queued")
  await jobs.runAll({ advanceTime: false })
  const mid = await jobs.status(id)
  ok(
    "progress stored",
    mid?.state === "sleeping" && mid.progress?.done === 1 && mid.progress?.note === "row 1",
    mid,
  )
  await jobs.runAll()
  const end = await jobs.status(id)
  ok("done with final progress", end?.state === "done" && end.progress?.done === 3, end)
  ok("unknown id is null", (await jobs.status("nope")) === null)

  // Cancel between steps: the sleeping run stops at its next step.
  const second = await job.enqueue({ rows: 2 })
  await jobs.runAll({ advanceTime: false })
  await jobs.cancel(second.id)
  ok("status cancelled", (await jobs.status(second.id))?.state === "cancelled")
  const after = await jobs.runAll()
  ok(
    "woken run does not continue",
    after.every((r) => r.status === "cancelled"),
    after,
  )
  ok("not dead-lettered", (await jobs.listDead()).length === 0)

  // Cancel a run in this process: ctx.signal aborts mid-run.
  let aborted = false
  const long = defineJob({
    name: "long",
    input: z.object({}),
    run: (_i, ctx) =>
      new Promise<void>((resolve) => {
        ctx.signal.addEventListener("abort", () => {
          aborted = true
          resolve()
        })
      }),
  })
  const j2 = createTestJobs({ jobs: [long] })
  const l = await long.enqueue({})
  const msg = j2.queued[0]!.message
  const pending = j2.handle(msg)
  await new Promise((r) => setTimeout(r, 5))
  await j2.cancel(l.id)
  const res = await pending
  ok("running job aborted and cancelled", aborted && res.status === "cancelled", res)
  ok("not started again", (await j2.handle(msg)).status === "cancelled")
}

console.log("budget per key")
{
  const spends = new Map<string, number>()
  const budgetStore = {
    spent: (key: string) => spends.get(key) ?? 0,
    record: (key: string, usd: number) => void spends.set(key, (spends.get(key) ?? 0) + usd),
  }
  const events: { costUsd?: number; code?: string }[] = []
  const summarise = defineJob({
    name: "summarise",
    input: z.object({ userId: z.string() }),
    budget: { key: (i) => i.userId, limitUsd: 0.05, windowSeconds: 86_400 },
    run: async (_i, ctx) => {
      await ctx.recordCost(0.03)
    },
  })
  const jobs = createTestJobs({
    jobs: [summarise],
    budgetStore,
    onJobRun: (e) => void events.push(e),
  })
  await summarise.enqueue({ userId: "u" })
  await summarise.enqueue({ userId: "u" })
  await summarise.enqueue({ userId: "u" })
  await summarise.enqueue({ userId: "v" })
  const r = await jobs.runAll()
  ok("third run stopped by budget", r.map((x) => x.status).join() === "done,done,dead,done", r)
  ok("BUDGET_EXCEEDED, not retried", r[2]?.code === "BUDGET_EXCEEDED" && r.length === 4)
  ok("cost reported to onJobRun", events[0]?.costUsd === 0.03)
  ok(
    "spend recorded per key",
    Math.abs((spends.get("u") ?? 0) - 0.06) < 1e-9 && spends.get("v") === 0.03,
  )
  ok("dead entry explains", (await jobs.listDead())[0]?.error.code === "BUDGET_EXCEEDED")
  let threw = false
  try {
    createTestJobs({ jobs: [summarise] })
  } catch (e) {
    threw = (e as { code?: string }).code === "NO_BUDGET_STORE"
  }
  ok("budget without a store is refused", threw)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
