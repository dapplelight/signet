/**
 * Durable workflows on your own database: multi-step jobs that sleep, wait
 * for events and for a person's approval, retry failed steps with backoff,
 * and pick up where they stopped after a crash or a deploy.
 *
 * ```ts
 * const refund = defineWorkflow("refund", async (step, input: { orderId: string }) => {
 *   const order = await step.run("load", () => loadOrder(input.orderId))
 *   const ok = await step.approval({ approvers: [order.managerId], summary: `Refund ${order.id}?`, timeout: 2 * DAY })
 *   if (!ok.approved) return { refunded: false }
 *   await step.run("refund", () => psp.refund(order.paymentId), { attempts: 5 })
 *   await step.sleep("cool-off", HOUR)
 *   const reply = await step.waitForEvent(`survey:${order.id}`, { timeout: 7 * DAY })
 *   return { refunded: true, reply }
 * })
 * const wf = createWorkflows(db, { tables: workflowTables(), workflows: [refund] })
 * const run = await wf.start(refund, { orderId }, { createdBy: userId })
 * await wf.tick()  // from setInterval, wf.poll(), or a Cloudflare cron trigger
 * ```
 *
 * How it runs: `tick()` claims due runs with a lease (a conditional UPDATE,
 * so two runners never hold one run), then calls the workflow function from
 * the top. A step that already finished returns its stored result without
 * running again; the first unfinished one runs, or suspends the run until its
 * sleep ends, its event arrives, its approver answers or its timeout passes.
 * Results are stored as JSON and the first run returns the same JSON form a
 * replay does, so Dates come back as strings either way.
 *
 * Rules for the function: step ids are unique within a run and stable across
 * deploys; anything non-deterministic (time, random, I/O) goes inside
 * `step.run`; await steps one at a time. A step that crashed half way runs
 * again (at least once), so make it safe to repeat or idempotent by key.
 */

import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  type Table,
} from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import { newId } from "./id.js"

export type WorkflowTables = {
  workflowRuns: Table
  workflowSteps: Table
  workflowEvents: Table
}

export type RunStatus =
  | "queued"
  | "running"
  | "sleeping"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"

export type StepKind = "run" | "sleep" | "event" | "approval"
export type StepStatus = "running" | "retrying" | "sleeping" | "waiting" | "completed" | "failed"

export type WorkflowRun = {
  id: string
  workflow: string
  input: unknown
  status: RunStatus
  output: unknown
  error: string | null
  createdBy: string | null
  wakeAt: Date | null
  leaseOwner: string | null
  leaseUntil: Date | null
  /** What a sleeping or waiting run is blocked on. */
  waitingOn: WaitingOn | null
  createdAt: Date
  updatedAt: Date
  finishedAt: Date | null
}

export type WaitingOn = {
  step: string
  kind: "sleep" | "retry" | "event" | "approval"
  until: string
  event?: string
  approvers?: string[]
}

export type WorkflowStep = {
  runId: string
  stepId: string
  seq: number
  kind: StepKind
  status: StepStatus
  output: unknown
  error: string | null
  attempts: number
  wakeAt: Date | null
  event: string | null
  eventId: string | null
  approvers: string[] | null
  summary: string | null
  decidedBy: string | null
  startedAt: Date
  finishedAt: Date | null
}

export type ApprovalDecision = {
  approved: boolean
  by?: string
  reason?: string
  timedOut?: true
}

/** One approval step waiting on a person, for an inbox. */
export type PendingWorkflowApproval = {
  runId: string
  stepId: string
  workflow: string
  summary: string | null
  approvers: string[]
  requestedAt: Date
  expiresAt: Date | null
}

export type StepRunOptions = {
  /** Total tries, the first included. Default the engine's `attempts` (3). */
  attempts?: number
  /** Delay in ms before retry number `attempt` (1-based). Default the engine's `backoff`. */
  backoff?: (attempt: number) => number
}

export type Step = {
  /** Run `fn` once per run; a replay returns its stored result. Retries with backoff. */
  run<T>(id: string, fn: () => T | Promise<T>, options?: StepRunOptions): Promise<T>
  /** Suspend the run for `ms`. */
  sleep(id: string, ms: number): Promise<void>
  /** Suspend the run until `at`. */
  sleepUntil(id: string, at: Date | number): Promise<void>
  /**
   * Suspend until `sendEvent(name, payload)`; returns the payload, or null on
   * timeout (ms, default 7 days). An event sent after the run started but
   * before this step was reached is delivered too. `id` defaults to `name`.
   */
  waitForEvent<T = unknown>(
    name: string,
    options?: { timeout?: number; id?: string },
  ): Promise<T | null>
  /**
   * Suspend until one of `approvers` approves or rejects (`approve`/`reject`,
   * or the approval store when one is configured). Times out as not approved
   * (ms, default 7 days). `id` defaults to "approval".
   */
  approval(options: {
    approvers: string[]
    timeout?: number
    summary?: string
    details?: Record<string, unknown>
    id?: string
  }): Promise<ApprovalDecision>
}

export type Workflow<I = unknown, O = unknown> = {
  readonly name: string
  readonly run: (step: Step, input: I, ctx: { runId: string }) => Promise<O>
}

export function defineWorkflow<I = unknown, O = unknown>(
  name: string,
  run: (step: Step, input: I, ctx: { runId: string }) => Promise<O>,
): Workflow<I, O> {
  return { name, run }
}

/** signet-server's `Approvals` (from `kvApprovals`), structurally. */
export type ApprovalStoreLike = {
  request(call: ApprovalCallLike): Promise<{ id: string }>
  find(call: Pick<ApprovalCallLike, "tool" | "principal" | "fp">): Promise<{
    id: string
    status: string
    decidedBy?: string
  } | null>
  approve(id: string, by: string): Promise<unknown>
  deny(id: string, by: string): Promise<unknown>
  use(id: string): Promise<boolean>
}

type ApprovalCallLike = {
  tool: string
  principal: string | null
  summary: string
  details?: string | Record<string, unknown>
  fp: string
}

/** What `notify` gets for each approver when an approval step opens. */
export type ApprovalRequest = {
  runId: string
  stepId: string
  workflow: string
  summary: string
  details?: Record<string, unknown>
  approvers: string[]
  expiresAt: Date
}

export type WorkflowsOptions = {
  tables: WorkflowTables
  // biome-ignore lint/suspicious/noExplicitAny: a registry of workflows with different inputs
  workflows: ReadonlyArray<Workflow<any, any>>
  /** How long a claimed run is held before another runner may take it over. Renewed at every step. Default 5 minutes; keep it above your longest step. */
  leaseMs?: number
  /** Default tries per `step.run`. Default 3. */
  attempts?: number
  /** Default retry delay in ms. Default 2^attempt seconds, capped at an hour. */
  backoff?: (attempt: number) => number
  /**
   * The approval primitive (signet-server's `kvApprovals`): each approver gets
   * a pending record in their approval inbox, and a decision made there is
   * picked up by the next tick after `approvalPollMs`.
   */
  approvals?: ApprovalStoreLike
  /** How often a run waiting on an approval re-checks `approvals`. Default 60 s. */
  approvalPollMs?: number
  /** Tell each approver, e.g. `(to, r) => notifier.notify(to, "workflow.approval", r)`. A throw is ignored. */
  notify?: (approver: string, request: ApprovalRequest) => unknown
  /** Clock, for tests. */
  now?: () => Date
}

const ACTIVE: RunStatus[] = ["queued", "running", "sleeping", "waiting"]
const DONE: RunStatus[] = ["completed", "failed", "cancelled"]
const WEEK = 7 * 86_400_000
const defaultBackoff = (attempt: number) => Math.min(2 ** attempt * 1000, 3_600_000)

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: workflow columns are known by name
type Cols = Record<string, any>

class Suspend {
  constructor(
    readonly status: "sleeping" | "waiting",
    readonly until: number,
    readonly on: Omit<WaitingOn, "until">,
  ) {}
}
/** The run's lease was lost (taken over or cancelled): stop without writing. */
class Lost {}

const message = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 1000)
const json = <T>(v: T): T => (v === undefined ? null : JSON.parse(JSON.stringify(v))) as T

export function createWorkflows(db: SignetDb<unknown>, options: WorkflowsOptions) {
  const { workflowRuns: R, workflowSteps: S, workflowEvents: E } = options.tables
  const r = R as unknown as Cols
  const s = S as unknown as Cols
  const e = E as unknown as Cols
  const o = db.orm as AnyOrm
  const now = options.now ?? (() => new Date())
  const leaseMs = options.leaseMs ?? 300_000
  const pollMs = options.approvalPollMs ?? 60_000
  const byName = new Map(options.workflows.map((w) => [w.name, w]))
  if (byName.size !== options.workflows.length)
    throw new SignetDbError("BAD_CONFIG", "Two workflows share a name.")

  const approvalCall = (run: WorkflowRun, stepId: string, principal: string, summary = "") => ({
    tool: `workflow:${run.workflow}`,
    principal,
    summary,
    fp: `${run.id}:${stepId}`,
  })

  async function execute(run: WorkflowRun, owner: string): Promise<RunStatus | "lost"> {
    const mine = and(eq(r.id, run.id), eq(r.leaseOwner, owner), inArray(r.status, ACTIVE))
    // Renew the lease before every step; a runner that lost it stops writing.
    const hold = async () => {
      const t = now()
      const held = await o
        .update(R)
        .set({ leaseUntil: new Date(t.getTime() + leaseMs), updatedAt: t })
        .where(mine)
        .returning({ id: r.id })
      if (!held.length) throw new Lost()
    }
    const finish = (fields: Cols) =>
      o
        .update(R)
        .set({ leaseOwner: null, leaseUntil: null, updatedAt: now(), ...fields })
        .where(mine)
        .returning({ id: r.id })

    const wf = byName.get(run.workflow)
    if (!wf) {
      await finish({
        status: "failed",
        error: `No workflow named "${run.workflow}" is registered.`,
        wakeAt: null,
        finishedAt: now(),
      })
      return "failed"
    }
    await o.update(R).set({ status: "running", waitingOn: null }).where(mine)

    const steps = new Map<string, WorkflowStep>(
      ((await o.select().from(S).where(eq(s.runId, run.id))) as WorkflowStep[]).map((x) => [
        x.stepId,
        x,
      ]),
    )
    const seen = new Set<string>()
    let seq = steps.size

    const enter = (id: string, kind: StepKind) => {
      if (seen.has(id))
        throw new SignetDbError(
          "BAD_INPUT",
          `Step id "${id}" is used twice in workflow "${wf.name}".`,
        )
      seen.add(id)
      const prev = steps.get(id)
      if (prev && prev.kind !== kind)
        throw new SignetDbError(
          "NONDETERMINISTIC",
          `Step "${id}" was a ${prev.kind} step in an earlier run of "${wf.name}" and is a ${kind} step now. Step ids must be stable.`,
        )
      return prev
    }
    const save = async (id: string, kind: StepKind, fields: Partial<WorkflowStep>) => {
      const prev = steps.get(id)
      if (prev) {
        await o
          .update(S)
          .set(fields)
          .where(and(eq(s.runId, run.id), eq(s.stepId, id)))
        steps.set(id, { ...prev, ...fields })
      } else {
        const row = {
          runId: run.id,
          stepId: id,
          seq: seq++,
          kind,
          startedAt: now(),
          attempts: 0,
          ...fields,
        }
        await o.insert(S).values(row)
        steps.set(id, row as WorkflowStep)
      }
    }
    /** Complete a waiting step only if nobody else decided it first; returns the winning output. */
    const settle = async (id: string, output: unknown, decidedBy?: string) => {
      const done = await o
        .update(S)
        .set({
          status: "completed",
          output,
          finishedAt: now(),
          ...(decidedBy ? { decidedBy } : {}),
        })
        .where(and(eq(s.runId, run.id), eq(s.stepId, id), eq(s.status, "waiting")))
        .returning({ id: s.stepId })
      if (done.length) return output
      const [row] = await o
        .select()
        .from(S)
        .where(and(eq(s.runId, run.id), eq(s.stepId, id)))
      return row.output
    }
    const t = () => now().getTime()

    /** The next event this run has not consumed yet under `name`. */
    const findEvent = async (name: string) => {
      // Events this run already consumed under the same name are skipped.
      let after = ""
      for (const x of steps.values())
        if (x.kind === "event" && x.event === name && x.eventId && x.eventId > after)
          after = x.eventId
      const [found] = await o
        .select()
        .from(E)
        .where(
          and(
            eq(e.name, name),
            or(eq(e.runId, run.id), isNull(e.runId)),
            gte(e.createdAt, run.createdAt),
            ...(after ? [gt(e.id, after)] : []),
          ),
        )
        .orderBy(asc(e.id))
        .limit(1)
      return found
    }

    /**
     * An event or decision can land while this run is still 'running', where
     * sendEvent and decide cannot wake it, and finish() then sets the full
     * timeout. Look again once the waiting state is written.
     */
    const answered = async (on: Suspend["on"]) => {
      if (on.kind === "event") return !!(await findEvent(on.event as string))
      if (on.kind !== "approval") return false
      const [row] = await o
        .select({ status: s.status })
        .from(S)
        .where(and(eq(s.runId, run.id), eq(s.stepId, on.step as string)))
      return row?.status === "completed"
    }

    const sleepUntil = async (id: string, at: () => number) => {
      const prev = enter(id, "sleep")
      if (prev?.status === "completed") return
      const until = prev?.wakeAt ? prev.wakeAt.getTime() : at()
      if (t() >= until) {
        await hold()
        await save(id, "sleep", { status: "completed", wakeAt: new Date(until), finishedAt: now() })
        return
      }
      if (!prev) {
        await hold()
        await save(id, "sleep", { status: "sleeping", wakeAt: new Date(until) })
      }
      throw new Suspend("sleeping", until, { step: id, kind: "sleep" })
    }

    const step: Step = {
      async run(id, fn, opts = {}) {
        const prev = enter(id, "run")
        if (prev?.status === "completed") return prev.output as never
        if (prev?.status === "failed")
          throw new SignetDbError("STEP_FAILED", `Step "${id}" failed: ${prev.error}`)
        if (prev?.status === "retrying" && prev.wakeAt && prev.wakeAt.getTime() > t())
          throw new Suspend("sleeping", prev.wakeAt.getTime(), { step: id, kind: "retry" })
        await hold()
        const attempts = (prev?.attempts ?? 0) + 1
        await save(id, "run", { status: "running", attempts, wakeAt: null })
        let value: unknown
        try {
          value = json(await fn())
        } catch (err) {
          await hold()
          const max = opts.attempts ?? options.attempts ?? 3
          if (attempts >= max) {
            await save(id, "run", { status: "failed", error: message(err), finishedAt: now() })
            throw new SignetDbError("STEP_FAILED", `Step "${id}" failed: ${message(err)}`)
          }
          const until = t() + (opts.backoff ?? options.backoff ?? defaultBackoff)(attempts)
          await save(id, "run", {
            status: "retrying",
            error: message(err),
            wakeAt: new Date(until),
          })
          throw new Suspend("sleeping", until, { step: id, kind: "retry" })
        }
        await hold()
        await save(id, "run", {
          status: "completed",
          output: value,
          error: null,
          finishedAt: now(),
        })
        return value as never
      },

      sleep: (id, ms) => sleepUntil(id, () => t() + ms),
      sleepUntil: (id, at) => sleepUntil(id, () => new Date(at).getTime()),

      async waitForEvent<T>(name: string, opts: { timeout?: number; id?: string } = {}) {
        const id = opts.id ?? name
        const prev = enter(id, "event")
        if (prev?.status === "completed") return prev.output as T | null
        const found = await findEvent(name)
        await hold()
        if (found) {
          await save(id, "event", {
            status: "completed",
            event: name,
            eventId: found.id,
            output: found.payload,
            finishedAt: now(),
          })
          return found.payload as T
        }
        const until = prev?.wakeAt ? prev.wakeAt.getTime() : t() + (opts.timeout ?? WEEK)
        if (t() >= until) {
          await save(id, "event", {
            status: "completed",
            event: name,
            output: null,
            finishedAt: now(),
          })
          return null
        }
        if (!prev)
          await save(id, "event", { status: "waiting", event: name, wakeAt: new Date(until) })
        throw new Suspend("waiting", until, { step: id, kind: "event", event: name })
      },

      async approval({ approvers, timeout = WEEK, summary, details, id = "approval" }) {
        if (!approvers.length)
          throw new SignetDbError("BAD_INPUT", `Approval step "${id}" needs at least one approver.`)
        const prev = enter(id, "approval")
        if (prev?.status === "completed") return prev.output as ApprovalDecision
        const text = summary ?? `Approve "${wf.name}"?`
        if (!prev) {
          await hold()
          const until = t() + timeout
          await save(id, "approval", {
            status: "waiting",
            approvers,
            summary: text,
            wakeAt: new Date(until),
          })
          // ponytail: requests and notifications go out once, after the step is
          // saved; a crash between the two loses them (the timeout still ends it).
          const request: ApprovalRequest = {
            runId: run.id,
            stepId: id,
            workflow: wf.name,
            summary: text,
            ...(details ? { details } : {}),
            approvers,
            expiresAt: new Date(until),
          }
          for (const p of approvers) {
            try {
              await options.approvals?.request({
                ...approvalCall(run, id, p, text),
                ...(details ? { details } : {}),
              })
            } catch {}
            try {
              await options.notify?.(p, request)
            } catch {}
          }
          throw waitApproval(id, approvers, until)
        }
        const until = prev.wakeAt?.getTime() ?? 0
        if (options.approvals) {
          for (const p of prev.approvers ?? []) {
            const rec = await options.approvals.find(approvalCall(run, id, p))
            if (rec?.status !== "approved" && rec?.status !== "denied") continue
            await hold()
            const decision: ApprovalDecision = {
              approved: rec.status === "approved",
              by: rec.decidedBy ?? p,
            }
            const out = (await settle(id, decision, decision.by)) as ApprovalDecision
            if (rec.status === "approved") await options.approvals.use(rec.id)
            return out
          }
        }
        if (t() >= until) {
          await hold()
          return (await settle(id, { approved: false, timedOut: true })) as ApprovalDecision
        }
        throw waitApproval(id, prev.approvers ?? [], until)
      },
    }

    const waitApproval = (id: string, approvers: string[], until: number) =>
      new Suspend("waiting", options.approvals ? Math.min(until, t() + pollMs) : until, {
        step: id,
        kind: "approval",
        approvers,
      })

    // A suspend or lost lease sticks even if the workflow's own try/catch
    // swallows it, and every later step call throws it again.
    let halted: Suspend | Lost | undefined
    const guarded = Object.fromEntries(
      Object.entries(step).map(([k, fn]) => [
        k,
        async (...args: unknown[]) => {
          if (halted) throw halted
          try {
            return await (fn as (...a: unknown[]) => unknown)(...args)
          } catch (err) {
            if (err instanceof Suspend || err instanceof Lost) halted = err
            throw err
          }
        },
      ]),
    ) as Step

    try {
      const output = json(await wf.run(guarded, run.input as never, { runId: run.id }))
      if (halted) throw halted
      await hold()
      await finish({ status: "completed", output, error: null, wakeAt: null, finishedAt: now() })
      return "completed"
    } catch (thrown) {
      const err = halted ?? thrown
      if (err instanceof Lost) return "lost"
      if (err instanceof Suspend) {
        const held = await finish({
          status: err.status,
          wakeAt: new Date(err.until),
          waitingOn: { ...err.on, until: new Date(err.until).toISOString() },
        })
        if (held.length && err.status === "waiting" && (await answered(err.on)))
          await o
            .update(R)
            .set({ wakeAt: now() })
            .where(and(eq(r.id, run.id), eq(r.status, "waiting")))
        return held.length ? err.status : "lost"
      }
      const held = await finish({
        status: "failed",
        error: message(err),
        wakeAt: null,
        finishedAt: now(),
      })
      return held.length ? "failed" : "lost"
    }
  }

  const getRun = async (id: string): Promise<WorkflowRun | null> =>
    ((await o.select().from(R).where(eq(r.id, id)))[0] as WorkflowRun | undefined) ?? null

  return {
    /** Queue a run; the next `tick` starts it. */
    async start<I>(
      workflow: Workflow<I, unknown> | string,
      input: I,
      opts: { createdBy?: string } = {},
    ): Promise<WorkflowRun> {
      const name = typeof workflow === "string" ? workflow : workflow.name
      if (!byName.has(name))
        throw new SignetDbError("NOT_FOUND", `No workflow named "${name}" is registered.`)
      const t = now()
      const [row] = await o
        .insert(R)
        .values({
          id: newId(t.getTime()),
          workflow: name,
          input: json(input),
          status: "queued",
          createdBy: opts.createdBy ?? null,
          wakeAt: t,
          createdAt: t,
          updatedAt: t,
        })
        .returning()
      return row
    },

    /**
     * Claim up to `limit` due runs and drive each until it finishes or
     * suspends. Safe to call from many runners at once. `nextWakeAt` is when
     * the next run is due, for a Durable Object alarm or an adaptive poll.
     */
    async tick(opts: { limit?: number } = {}) {
      const owner = newId()
      const t = now()
      const due = and(
        inArray(r.status, ACTIVE),
        lte(r.wakeAt, t),
        or(isNull(r.leaseUntil), lt(r.leaseUntil, t)),
      )
      const ids: string[] = (
        await o
          .select({ id: r.id })
          .from(R)
          .where(due)
          .orderBy(asc(r.wakeAt))
          .limit(opts.limit ?? 10)
      ).map((x: { id: string }) => x.id)
      const claimed: WorkflowRun[] = ids.length
        ? await o
            .update(R)
            .set({ leaseOwner: owner, leaseUntil: new Date(t.getTime() + leaseMs) })
            .where(and(inArray(r.id, ids), due))
            .returning()
        : []
      const runs: { id: string; status: RunStatus | "lost" }[] = []
      for (const run of claimed.sort((a, b) => (a.id < b.id ? -1 : 1)))
        runs.push({ id: run.id, status: await execute(run, owner) })
      const [next] = await o
        .select({ wakeAt: r.wakeAt })
        .from(R)
        .where(inArray(r.status, ACTIVE))
        .orderBy(asc(r.wakeAt))
        .limit(1)
      return { runs, nextWakeAt: (next?.wakeAt as Date | null | undefined) ?? null }
    },

    /** Tick every `intervalMs` until `signal` aborts. For Bun and Node; Workers use a cron trigger. */
    async poll(opts: { intervalMs?: number; signal?: AbortSignal; limit?: number } = {}) {
      const { intervalMs = 1000, signal } = opts
      while (!signal?.aborted) {
        try {
          await this.tick({ limit: opts.limit })
        } catch (err) {
          console.error("signet-db workflows: tick failed:", err)
        }
        await new Promise<void>((done) => {
          const timer = setTimeout(done, intervalMs)
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer)
              done()
            },
            { once: true },
          )
        })
      }
    },

    /** A run and its steps in the order they were reached. */
    async get(id: string): Promise<{ run: WorkflowRun; steps: WorkflowStep[] } | null> {
      const run = await getRun(id)
      if (!run) return null
      const steps = await o.select().from(S).where(eq(s.runId, id)).orderBy(asc(s.seq))
      return { run, steps }
    },

    /** Runs, newest first. `before` is the last id of the previous page. */
    async list(
      opts: {
        status?: RunStatus
        workflow?: string
        createdBy?: string
        limit?: number
        before?: string
      } = {},
    ): Promise<WorkflowRun[]> {
      const where = [
        opts.status && eq(r.status, opts.status),
        opts.workflow && eq(r.workflow, opts.workflow),
        opts.createdBy && eq(r.createdBy, opts.createdBy),
        opts.before && lt(r.id, opts.before),
      ].filter((x): x is SQL => !!x)
      return o
        .select()
        .from(R)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(r.id))
        .limit(Math.min(opts.limit ?? 50, 200))
    },

    /**
     * Record an event and wake the runs waiting on it. With `runId` only that
     * run sees it; without, every run waiting on `name` (or reaching a wait on
     * it later) does.
     */
    async sendEvent(name: string, payload?: unknown, opts: { runId?: string } = {}) {
      const t = now()
      const id = newId(t.getTime())
      await o
        .insert(E)
        .values({ id, name, runId: opts.runId ?? null, payload: json(payload), createdAt: t })
      const waiting = and(
        eq(s.kind, "event"),
        eq(s.status, "waiting"),
        eq(s.event, name),
        ...(opts.runId ? [eq(s.runId, opts.runId)] : []),
      )
      const runIds = (await o.select({ id: s.runId }).from(S).where(waiting)).map(
        (x: { id: string }) => x.id,
      )
      if (runIds.length)
        await o
          .update(R)
          .set({ wakeAt: t })
          .where(and(inArray(r.id, runIds), eq(r.status, "waiting")))
      return { id, woken: runIds.length }
    },

    /**
     * Decide an approval step. `by` must be one of its approvers. Null when it
     * was already decided or timed out (answer 409).
     */
    async decide(
      runId: string,
      stepId: string,
      d: { by: string; approved: boolean; reason?: string },
    ): Promise<ApprovalDecision | null> {
      const [row] = (await o
        .select()
        .from(S)
        .where(and(eq(s.runId, runId), eq(s.stepId, stepId)))) as WorkflowStep[]
      if (row?.kind !== "approval")
        throw new SignetDbError("NOT_FOUND", `No approval step "${stepId}" in run ${runId}.`)
      if (!row.approvers?.includes(d.by))
        throw new SignetDbError("FORBIDDEN", `${d.by} is not an approver of step "${stepId}".`)
      const decision: ApprovalDecision = {
        approved: d.approved,
        by: d.by,
        ...(d.reason ? { reason: d.reason } : {}),
      }
      const t = now()
      const done = await o
        .update(S)
        .set({ status: "completed", output: decision, decidedBy: d.by, finishedAt: t })
        .where(and(eq(s.runId, runId), eq(s.stepId, stepId), eq(s.status, "waiting")))
        .returning({ id: s.stepId })
      if (!done.length) return null
      await o
        .update(R)
        .set({ wakeAt: t })
        .where(and(eq(r.id, runId), eq(r.status, "waiting")))
      // Close the decider's record in the approval inbox too.
      const run = await getRun(runId)
      if (run && options.approvals) {
        try {
          const rec = await options.approvals.find(approvalCall(run, stepId, d.by))
          if (rec?.status === "pending") {
            await options.approvals[d.approved ? "approve" : "deny"](rec.id, d.by)
            if (d.approved) await options.approvals.use(rec.id)
          }
        } catch {}
      }
      return decision
    },

    approve(runId: string, stepId: string, by: string, reason?: string) {
      return this.decide(runId, stepId, { by, approved: true, reason })
    },
    reject(runId: string, stepId: string, by: string, reason?: string) {
      return this.decide(runId, stepId, { by, approved: false, reason })
    },

    /** Approval steps waiting on `approver`, oldest first. */
    async pendingApprovals(approver: string): Promise<PendingWorkflowApproval[]> {
      // ponytail: filters approvers in JS (JSON containment differs per
      // dialect); fine for hundreds of open approvals, index a join table past that.
      const rows = (await o
        .select({ step: S, workflow: r.workflow })
        .from(S)
        .innerJoin(R, eq(r.id, s.runId))
        .where(and(eq(s.kind, "approval"), eq(s.status, "waiting"), eq(r.status, "waiting")))
        .orderBy(asc(s.startedAt))) as { step: WorkflowStep; workflow: string }[]
      return rows
        .filter((x) => x.step.approvers?.includes(approver))
        .map(({ step, workflow }) => ({
          runId: step.runId,
          stepId: step.stepId,
          workflow,
          summary: step.summary,
          approvers: step.approvers ?? [],
          requestedAt: step.startedAt,
          expiresAt: step.wakeAt,
        }))
    },

    /** Stop a run. A runner mid-step finishes that step but writes nothing after it. False if it had already ended. */
    async cancel(runId: string, opts: { by?: string } = {}): Promise<boolean> {
      const t = now()
      const done = await o
        .update(R)
        .set({
          status: "cancelled",
          error: opts.by ? `Cancelled by ${opts.by}` : "Cancelled",
          wakeAt: null,
          leaseOwner: null,
          leaseUntil: null,
          waitingOn: null,
          updatedAt: t,
          finishedAt: t,
        })
        .where(and(eq(r.id, runId), inArray(r.status, ACTIVE)))
        .returning({ id: r.id })
      return done.length > 0
    },

    /** Delete finished runs (and their steps) and events older than `olderThanMs` (default 30 days). */
    async prune(olderThanMs = 30 * 86_400_000) {
      const cutoff = new Date(now().getTime() - olderThanMs)
      const old = (
        await o
          .select({ id: r.id })
          .from(R)
          .where(and(inArray(r.status, DONE), lt(r.finishedAt, cutoff)))
      ).map((x: { id: string }) => x.id)
      if (old.length) {
        await o.delete(S).where(inArray(s.runId, old))
        await o.delete(R).where(inArray(r.id, old))
      }
      await o.delete(E).where(lt(e.createdAt, cutoff))
      return old.length
    },
  }
}

export type Workflows = ReturnType<typeof createWorkflows>
