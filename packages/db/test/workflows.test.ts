import { afterEach, describe, expect, test } from "bun:test"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { isSignetDbError } from "../src/errors"
import {
  createWorkflows,
  defineWorkflow,
  type Workflow,
  type WorkflowsOptions,
} from "../src/workflows"
import { backends, ddl, type Instance } from "./harness"

const MIN = 60_000
const HOUR = 60 * MIN

for (const backend of backends) {
  describe(`workflows on ${backend.name}`, () => {
    let open: Instance | undefined
    afterEach(async () => {
      await open?.close()
      open = undefined
    })
    let clock = new Date("2026-11-01T00:00:00Z")
    const advance = (ms: number) => {
      clock = new Date(clock.getTime() + ms)
    }

    async function setup() {
      clock = new Date("2026-11-01T00:00:00Z")
      open = await backend.make({})
      const i = open
      const tables =
        i.db.dialect === "pg"
          ? (pgc.workflowTables() as unknown as ReturnType<typeof sqc.workflowTables>)
          : sqc.workflowTables()
      for (const t of Object.values(tables)) await i.exec(ddl(t))
      return (workflows: Workflow<any, any>[], extra: Partial<WorkflowsOptions> = {}) =>
        createWorkflows(i.db, { tables, workflows, now: () => clock, ...extra })
    }

    test("replay never re-runs a finished step, and returns the same JSON form", async () => {
      const make = await setup()
      const calls: string[] = []
      const wf = defineWorkflow("pipeline", async (step, input: { n: number }) => {
        const a = await step.run("a", () => {
          calls.push("a")
          return { n: input.n, at: new Date("2026-01-01T00:00:00Z") }
        })
        await step.sleep("nap", MIN)
        const b = await step.run("b", () => {
          calls.push("b")
          return a.n + 1
        })
        return { a, b }
      })
      const engine = make([wf])
      const run = await engine.start(wf, { n: 41 }, { createdBy: "u1" })
      expect((await engine.tick()).runs).toEqual([{ id: run.id, status: "sleeping" }])
      expect((await engine.tick()).runs).toEqual([]) // not due yet
      advance(MIN)
      const res = await engine.tick()
      expect(res.runs[0]?.status).toBe("completed")
      expect(res.nextWakeAt).toBeNull()
      expect(calls).toEqual(["a", "b"])
      const got = await engine.get(run.id)
      expect(got?.run.output).toEqual({ a: { n: 41, at: "2026-01-01T00:00:00.000Z" }, b: 42 })
      expect(got?.steps.map((s) => [s.stepId, s.kind, s.status])).toEqual([
        ["a", "run", "completed"],
        ["nap", "sleep", "completed"],
        ["b", "run", "completed"],
      ])
    })

    test("a changed step kind is caught as non-deterministic", async () => {
      const make = await setup()
      let v2 = false
      const wf = defineWorkflow("drift", async (step) => {
        if (v2) await step.run("x", () => 1)
        else await step.sleep("x", MIN)
      })
      const engine = make([wf])
      const run = await engine.start(wf, {})
      await engine.tick()
      v2 = true
      advance(MIN)
      await engine.tick()
      const got = await engine.get(run.id)
      expect(got?.run.status).toBe("failed")
      expect(got?.run.error).toMatch(/sleep step in an earlier run/)
    })

    test("retries with backoff, then the step failure reaches the workflow", async () => {
      const make = await setup()
      let tries = 0
      const wf = defineWorkflow("flaky", async (step) => {
        try {
          await step.run(
            "call",
            () => {
              tries++
              throw new Error("down")
            },
            { attempts: 3, backoff: (n) => n * MIN },
          )
        } catch (err) {
          return { gaveUp: isSignetDbError(err, "STEP_FAILED") }
        }
      })
      const engine = make([wf])
      const run = await engine.start(wf, {})
      expect((await engine.tick()).runs[0]?.status).toBe("sleeping")
      expect((await engine.get(run.id))?.run.waitingOn).toMatchObject({
        step: "call",
        kind: "retry",
      })
      advance(MIN - 1)
      expect((await engine.tick()).runs).toEqual([])
      advance(1)
      expect((await engine.tick()).runs[0]?.status).toBe("sleeping") // retry 2 failed, wait 2 min
      advance(2 * MIN)
      expect((await engine.tick()).runs[0]?.status).toBe("completed")
      expect(tries).toBe(3)
      const got = await engine.get(run.id)
      expect(got?.run.output).toEqual({ gaveUp: true })
      expect(got?.steps[0]).toMatchObject({ status: "failed", attempts: 3, error: "down" })
    })

    test("crash mid-step: another runner resumes after the lease, the stale runner writes nothing", async () => {
      const make = await setup()
      const calls: number[] = []
      let release: () => void = () => {}
      const hung = new Promise<void>((r) => {
        release = r
      })
      const wf = defineWorkflow("crashy", async (step) => {
        await step.run("first", () => "ok")
        const n = await step.run("slow", async () => {
          calls.push(calls.length + 1)
          if (calls.length === 1) await hung // runner A "dies" here
          return calls.length
        })
        return n
      })
      const a = make([wf], { leaseMs: MIN })
      const b = make([wf], { leaseMs: MIN })
      const run = await a.start(wf, {})
      const tickA = a.tick()
      await new Promise((r) => setTimeout(r, 20))
      expect((await b.tick()).runs).toEqual([]) // A holds the lease
      advance(MIN + 1)
      expect((await b.tick()).runs[0]?.status).toBe("completed")
      release()
      expect((await tickA).runs[0]?.status).toBe("lost")
      const got = await b.get(run.id)
      expect(got?.run.output).toBe(2)
      expect(got?.steps.find((s) => s.stepId === "first")?.attempts).toBe(1)
      expect(got?.steps.find((s) => s.stepId === "slow")).toMatchObject({ attempts: 2, output: 2 })
    })

    test("runs resume from the database in a fresh engine (process restart)", async () => {
      const make = await setup()
      const calls: string[] = []
      const wf = defineWorkflow("restart", async (step) => {
        await step.run("one", () => calls.push("one"))
        await step.sleep("wait", HOUR)
        await step.run("two", () => calls.push("two"))
      })
      const run = await make([wf]).start(wf, {})
      await make([wf]).tick()
      advance(HOUR)
      expect((await make([wf]).tick()).runs).toEqual([{ id: run.id, status: "completed" }])
      expect(calls).toEqual(["one", "two"])
    })

    test("concurrent tick runners never run the same step twice", async () => {
      const make = await setup()
      let calls = 0
      const wf = defineWorkflow("once", async (step) => {
        await step.run("only", async () => {
          calls++
          await new Promise((r) => setTimeout(r, 5))
        })
      })
      const runners = Array.from({ length: 5 }, () => make([wf]))
      const ids = await Promise.all(Array.from({ length: 4 }, () => runners[0]?.start(wf, {})))
      const results = await Promise.all(runners.map((r) => r.tick()))
      const done = results.flatMap((x) => x.runs).filter((x) => x.status === "completed")
      expect(done.map((x) => x.id).sort()).toEqual(ids.map((r) => r?.id as string).sort())
      expect(calls).toBe(4)
    })

    test("events: delivered whether sent before or after the wait; timeout gives null", async () => {
      const make = await setup()
      const wf = defineWorkflow("ev", async (step, input: { key: string }) => {
        await step.sleep("pause", MIN)
        const first = await step.waitForEvent<{ v: number }>(`paid:${input.key}`, { timeout: HOUR })
        const second = await step.waitForEvent<{ v: number }>(`paid:${input.key}`, {
          id: "again",
          timeout: HOUR,
        })
        return { first, second }
      })
      const engine = make([wf])
      const early = await engine.start(wf, { key: "a" })
      const late = await engine.start(wf, { key: "b" })
      await engine.tick()
      // Sent before the run reaches its wait.
      await engine.sendEvent("paid:a", { v: 1 }, { runId: early.id })
      advance(MIN)
      await engine.tick()
      let got = await engine.get(early.id)
      expect(got?.steps.find((s) => s.stepId === "paid:a")?.output).toEqual({ v: 1 })
      expect(got?.run.status).toBe("waiting") // the second wait does not reuse event 1
      // Sent after: wakes the waiting run straight away.
      expect((await engine.sendEvent("paid:a", { v: 2 })).woken).toBe(1)
      await engine.tick()
      got = await engine.get(early.id)
      expect(got?.run.output).toEqual({ first: { v: 1 }, second: { v: 2 } })
      // The other run never got an event: both waits time out.
      advance(HOUR)
      await engine.tick()
      advance(HOUR)
      await engine.tick()
      expect((await engine.get(late.id))?.run.output).toEqual({ first: null, second: null })
    })

    test("an event or decision that lands while the run is still running is not lost", async () => {
      const make = await setup()
      let engine: ReturnType<typeof make> | undefined
      let runId = ""
      // The webhook fires on the next clock read after the runner's event lookup
      // came back empty, while the run is still 'running'.
      let fire: (() => void) | undefined
      let sent: Promise<unknown> | undefined
      const now = () => {
        const f = fire
        fire = undefined
        f?.()
        return clock
      }
      const ev = defineWorkflow("race-ev", async (step) => {
        await step.run("charge", () => 1)
        fire = () => {
          sent = engine?.sendEvent("pay:x", { ok: true }, { runId })
        }
        return step.waitForEvent("pay:x", { timeout: 7 * 24 * HOUR })
      })
      const ap = defineWorkflow("race-ap", async (step) => {
        const d = await step.approval({ approvers: ["boss"], timeout: 7 * 24 * HOUR })
        return d
      })
      let apId = ""
      // The approver decides while the request and notify calls are still going out.
      engine = make([ev, ap], { now, notify: () => engine?.approve(apId, "approval", "boss") })
      runId = (await engine.start(ev, {})).id
      apId = (await engine.start(ap, {})).id
      await engine.tick()
      await sent
      // Woken at once, not left to sleep until the 7-day timeout.
      for (const id of [runId, apId])
        expect((await engine.get(id))?.run.wakeAt?.getTime()).toBe(clock.getTime())
      await engine.tick()
      expect((await engine.get(runId))?.run).toMatchObject({
        status: "completed",
        output: { ok: true },
      })
      expect((await engine.get(apId))?.run).toMatchObject({
        status: "completed",
        output: { approved: true, by: "boss" },
      })
    })

    test("approval: approve route, wrong approver, double decision, notify", async () => {
      const make = await setup()
      const notified: string[] = []
      const wf = defineWorkflow("refund", async (step) => {
        const d = await step.approval({
          approvers: ["boss", "deputy"],
          summary: "Refund 500?",
          timeout: HOUR,
        })
        return d
      })
      const engine = make([wf], { notify: (to, r) => notified.push(`${to}:${r.summary}`) })
      const run = await engine.start(wf, {})
      expect((await engine.tick()).runs[0]?.status).toBe("waiting")
      expect(notified).toEqual(["boss:Refund 500?", "deputy:Refund 500?"])
      const inbox = await engine.pendingApprovals("deputy")
      expect(inbox).toMatchObject([
        { runId: run.id, stepId: "approval", workflow: "refund", summary: "Refund 500?" },
      ])
      expect(await engine.pendingApprovals("intern")).toEqual([])
      await expect(engine.approve(run.id, "approval", "intern")).rejects.toThrow(/not an approver/)
      expect(await engine.reject(run.id, "approval", "deputy", "too much")).toEqual({
        approved: false,
        by: "deputy",
        reason: "too much",
      })
      expect(await engine.approve(run.id, "approval", "boss")).toBeNull()
      await engine.tick()
      expect((await engine.get(run.id))?.run).toMatchObject({
        status: "completed",
        output: { approved: false, by: "deputy", reason: "too much" },
      })
    })

    test("approval timeout: not approved, and a late decision is refused", async () => {
      const make = await setup()
      const wf = defineWorkflow("t", async (step) =>
        step.approval({ approvers: ["boss"], timeout: HOUR }),
      )
      const engine = make([wf])
      const run = await engine.start(wf, {})
      await engine.tick()
      advance(HOUR)
      await engine.tick()
      expect((await engine.get(run.id))?.run.output).toEqual({ approved: false, timedOut: true })
      expect(await engine.approve(run.id, "approval", "boss")).toBeNull()
      expect(await engine.pendingApprovals("boss")).toEqual([])
    })

    test("approval through the approval store is picked up by the next poll", async () => {
      const make = await setup()
      const records = new Map<
        string,
        { id: string; status: string; principal: string | null; decidedBy?: string }
      >()
      const key = (c: { tool: string; principal: string | null; fp: string }) =>
        `${c.tool}|${c.principal}|${c.fp}`
      const approvals = {
        async request(c: { tool: string; principal: string | null; fp: string }) {
          const rec = { id: key(c), status: "pending", principal: c.principal }
          records.set(rec.id, rec)
          return rec
        },
        find: async (c: { tool: string; principal: string | null; fp: string }) =>
          records.get(key(c)) ?? null,
        async approve(id: string, by: string) {
          Object.assign(records.get(id) ?? {}, { status: "approved", decidedBy: by })
        },
        async deny(id: string, by: string) {
          Object.assign(records.get(id) ?? {}, { status: "denied", decidedBy: by })
        },
        async use(id: string) {
          Object.assign(records.get(id) ?? {}, { status: "used" })
          return true
        },
      }
      const wf = defineWorkflow("p", async (step) =>
        step.approval({ approvers: ["boss"], timeout: HOUR }),
      )
      const engine = make([wf], { approvals, approvalPollMs: MIN })
      const run = await engine.start(wf, {})
      await engine.tick()
      expect(records.size).toBe(1)
      const [rec] = records.values()
      await approvals.approve(rec?.id as string, "boss") // decided in the approval inbox
      expect((await engine.tick()).runs).toEqual([])
      advance(MIN)
      await engine.tick()
      expect((await engine.get(run.id))?.run.output).toEqual({ approved: true, by: "boss" })
      expect(rec?.status).toBe("used")
    })

    test("cancel: stops a waiting run and a run mid-step", async () => {
      const make = await setup()
      let release: () => void = () => {}
      const hung = new Promise<void>((r) => {
        release = r
      })
      const after: string[] = []
      const wf = defineWorkflow("c", async (step, input: { hang: boolean }) => {
        if (input.hang) await step.run("hang", () => hung)
        else await step.sleep("s", HOUR)
        await step.run("after", () => after.push("ran"))
      })
      const engine = make([wf])
      const sleeper = await engine.start(wf, { hang: false })
      await engine.tick()
      expect(await engine.cancel(sleeper.id, { by: "admin" })).toBe(true)
      expect(await engine.cancel(sleeper.id)).toBe(false)
      const busy = await engine.start(wf, { hang: true })
      const t = engine.tick()
      await new Promise((r) => setTimeout(r, 20))
      expect(await engine.cancel(busy.id)).toBe(true)
      release()
      expect((await t).runs[0]?.status).toBe("lost")
      advance(HOUR)
      expect((await engine.tick()).runs).toEqual([])
      expect(after).toEqual([])
      expect((await engine.get(busy.id))?.run.status).toBe("cancelled")
      expect((await engine.list({ status: "cancelled" })).length).toBe(2)
    })

    test("list, unknown workflow, prune", async () => {
      const make = await setup()
      const wf = defineWorkflow("noop", async () => "done")
      const engine = make([wf])
      await expect(engine.start("nope", {})).rejects.toThrow(/No workflow named/)
      const a = await engine.start(wf, {}, { createdBy: "u1" })
      advance(1)
      const b = await engine.start(wf, {}, { createdBy: "u2" })
      await engine.tick()
      expect((await engine.list()).map((r) => r.id)).toEqual([b.id, a.id])
      expect((await engine.list({ createdBy: "u1" })).map((r) => r.id)).toEqual([a.id])
      expect((await engine.list({ before: b.id })).map((r) => r.id)).toEqual([a.id])
      advance(31 * 86_400_000)
      expect(await engine.prune()).toBe(2)
      expect(await engine.get(a.id)).toBeNull()
    })
  })
}
