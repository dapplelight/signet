/**
 * Background jobs over any `Queue`: typed input, retries with backoff, timeouts, a dead-letter list, pause/resume and idempotent keys.
 *
 * ```ts
 * const sendReceipt = defineJob({ name: "send-receipt", input: z.object({ orderId: z.string() }),
 *   run: async ({ orderId }, ctx) => mailer.receipt(orderId, { signal: ctx.signal }) })
 * const jobs = createJobs({ jobs: [sendReceipt], queue: env.JOBS, store: cloudflareKv(env.KV) })
 * await sendReceipt.enqueue({ orderId }, { key: orderId })   // runs once per key
 * // consumer side: await jobs.handle(message)
 * ```
 *
 * Delivery is at least once: a job can run again after a crash, so make `run`
 * safe to repeat or give it a `key` and an `idempotency` hook.
 */

import type { z } from "zod"
import { type KeyValue, kvRateLimitStore, memoryKv, type Queue } from "../adapters/index.js"
import type { RateLimitStore } from "../middleware/rate-limit.js"
import { runDueSchedules, type Schedule } from "./cron.js"
import {
  approvalEvent,
  makeSteps,
  type PendingApproval,
  type Steps,
  Suspend,
  stepStore,
} from "./steps.js"

/** Who caused a run. Same shape as signet-db's audit actor, so `ctx.actor` can go straight to `audited()`. */
export type JobActor = { type: "user" | "agent" | "system"; id: string }

export type RetryPolicy = {
  /** Total runs, the first included. Default 3. */
  attempts: number
  backoff: "exponential" | "fixed"
  /** Delay before the first retry; exponential doubles it each time. Default 10. */
  baseSeconds: number
}

/** What travels on the queue. Plain JSON. */
export type JobMessage = {
  id: string
  job: string
  input: unknown
  /** 1 for the first run. */
  attempt: number
  key?: string
  actor?: JobActor
  /** Set on a step's own timer message (sleep, wait timeout). */
  wake?: string
}

export type JobContext = {
  id: string
  name: string
  attempt: number
  key?: string
  actor: JobActor
  /** Aborted when `timeoutSeconds` passes. Hand it to fetch and other cancellable work. */
  signal: AbortSignal
  /** Durable steps: `run`, `sleep`, `waitFor`, `waitForApproval`. */
  step: Steps
  /** Store progress for `jobs.status(id)`. */
  progress(done: number, total?: number, note?: string): Promise<void>
  /** Report AI spend for this run: counted against `budget` and sent to `onJobRun` as `costUsd`. */
  recordCost(usd: number): Promise<void>
}

/** signet-ai's `BudgetStore`, structurally. */
export type BudgetStoreLike = {
  spent(key: string, windowSeconds: number, now: number): number | Promise<number>
  record(key: string, usd: number, windowSeconds: number, now: number): void | Promise<void>
}

/** What `jobs.status(id)` returns. */
export type JobStatus = {
  id: string
  job: string
  state: "queued" | "running" | "cancelled" | HandleResult["status"]
  attempt: number
  progress?: { done: number; total?: number; note?: string }
  error?: { code: string; message?: string }
  updatedAt: string
}

type Schema = z.ZodType

export type JobDefinition<S extends Schema> = {
  name: string
  /** Checked at enqueue and again before each run. */
  input: S
  retry?: Partial<RetryPolicy>
  timeoutSeconds?: number
  /** At most `limit` runs at once per key. Over the limit: re-enqueued with a delay, never dropped. */
  concurrency?: { key: (input: z.output<S>) => string; limit: number }
  /** At most `max` runs per key per window (counted in `rateLimitStore`). Over: re-enqueued for the next window. */
  rateLimit?: { key: (input: z.output<S>) => string; max: number; windowSeconds: number }
  /**
   * Stop before running (and between steps) once `key`'s spend in the window
   * reaches `limitUsd`: the run is dead-lettered as `BUDGET_EXCEEDED`, not
   * retried. Spend comes from `ctx.recordCost`. Needs `budgetStore`.
   */
  budget?: { key: (input: z.output<S>) => string; limitUsd: number; windowSeconds: number }
  run(input: z.output<S>, ctx: JobContext): unknown
}

export type EnqueueOptions = {
  delaySeconds?: number
  /** Run once per key: a second enqueue with the same key is skipped. */
  key?: string
  actor?: JobActor
}

export type EnqueueResult = { id: string; enqueued: boolean }

const RUNTIME = Symbol.for("signet.jobs.runtime")

export type Job<S extends Schema = Schema> = JobDefinition<S> & {
  /** Validate and send. Needs a `createJobs({ jobs: [this] })` first. */
  enqueue(input: z.input<S>, opts?: EnqueueOptions): Promise<EnqueueResult>
  [RUNTIME]?: Jobs
}

// biome-ignore lint/suspicious/noExplicitAny: jobs with different schemas share one array
type AnyJob = Job<any>

export class JobError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = "JobError"
  }
}

export function defineJob<S extends Schema>(def: JobDefinition<S>): Job<S> {
  const job: Job<S> = {
    ...def,
    enqueue(input, opts) {
      const runtime = job[RUNTIME]
      if (!runtime)
        throw new JobError(
          "JOBS_NOT_CREATED",
          `Job "${def.name}" is not registered. Call createJobs({ jobs: [${def.name}], queue }) before enqueueing.`,
        )
      return runtime.enqueue(job, input, opts)
    },
  }
  return job
}

/** A message that ran out of attempts, with what it was given and why it failed. */
export type DeadJob = {
  id: string
  job: string
  input: unknown
  attempt: number
  key?: string
  actor?: JobActor
  error: { code: string; message: string }
  failedAt: string
}

/** Where dead jobs go. Default: the jobs' `KeyValue` store (`kvDeadLetter`). */
export type DeadLetterSink = {
  put(entry: DeadJob): Promise<void>
  get(id: string): Promise<DeadJob | null>
  list(): Promise<DeadJob[]>
  delete(id: string): Promise<void>
}

/**
 * Dead jobs in a `KeyValue`: one entry per job plus an index of ids.
 * ponytail: the index is read-modify-write, so two jobs dying at the same
 * instant can drop one id from the index (the entry itself survives). Use a
 * table-backed sink if that matters.
 */
export function kvDeadLetter(store: KeyValue, prefix = "signet-job:dead"): DeadLetterSink {
  const index = async (): Promise<string[]> => JSON.parse((await store.get(prefix)) ?? "[]")
  const get = async (id: string) => {
    const raw = await store.get(`${prefix}:${id}`)
    return raw ? (JSON.parse(raw) as DeadJob) : null
  }
  return {
    async put(entry) {
      await store.set(`${prefix}:${entry.id}`, JSON.stringify(entry))
      const ids = await index()
      if (!ids.includes(entry.id)) await store.set(prefix, JSON.stringify([...ids, entry.id]))
    },
    get,
    async list() {
      const entries = await Promise.all((await index()).map(get))
      return entries.filter((e): e is DeadJob => e !== null)
    },
    async delete(id) {
      await store.delete(`${prefix}:${id}`)
      await store.set(prefix, JSON.stringify((await index()).filter((x) => x !== id)))
    },
  }
}

/** One finished run, for `onJobRun`. */
export type JobRunEvent = {
  name: string
  id: string
  attempt: number
  durationMs: number
  ok: boolean
  /** `TIMEOUT`, `BAD_INPUT`, a `JobError`/app error `code`, or `JOB_FAILED`. */
  code?: string
  error?: unknown
  actor: JobActor
  /** Sum of `ctx.recordCost` in this run, when any. */
  costUsd?: number
}

export type HandleResult = {
  status:
    | "done"
    | "retrying"
    | "dead"
    | "paused"
    | "skipped"
    | "sleeping"
    | "waiting"
    | "throttled"
    | "cancelled"
  code?: string
}

export type CreateJobsOptions = {
  // biome-ignore lint/suspicious/noExplicitAny: see AnyJob
  jobs: readonly Job<any>[]
  queue: Queue<JobMessage>
  /**
   * Keys, pause flags and (by default) dead jobs. Default `memoryKv()`: one
   * process, lost on restart — pass a real store in production.
   */
  store?: KeyValue
  /** Replaces the store-backed dead-letter list. */
  deadLetter?: DeadLetterSink
  /**
   * Run keyed jobs inside this, e.g. signet-db's
   * `(key, scope, fn) => withIdempotency(db, key, scope, fn)`. `scope` is the job name.
   */
  idempotency?: (key: string, scope: string, fn: () => Promise<unknown>) => Promise<unknown>
  /** How long an enqueue key blocks a repeat. Default 24 h. */
  keyTtlSeconds?: number
  /** A paused job's messages come back after this long. Default 60. */
  pausedDelaySeconds?: number
  /** Jobs started by `jobs.emit(event)`, as `{ "order.paid": [sendReceipt] }`. `jobs.on` adds more. */
  // biome-ignore lint/suspicious/noExplicitAny: see AnyJob
  triggers?: Record<string, readonly Job<any>[]>
  /** Counts for jobs' `rateLimit`. Default `kvRateLimitStore(store)`. */
  rateLimitStore?: RateLimitStore
  /** How long a throttled run waits before trying again (concurrency). Default 5. */
  throttleDelaySeconds?: number
  /** How long step results and waits are kept. Default 30 days. */
  stepTtlSeconds?: number
  /** Spend for jobs with a `budget`, e.g. signet-ai's `kvBudgetStore(kv)` or `durableObjectBudgetStore`. */
  budgetStore?: BudgetStoreLike
  /** Keep `jobs.status(id)` records (one KeyValue write per state change). Default true. */
  trackStatus?: boolean
  /** The clock for steps and tests. Default `Date.now`. */
  now?: () => number
  /** `defineSchedule(...)`s for `jobs.runDueSchedules(now)`. */
  schedules?: readonly Schedule[]
  onJobRun?: (event: JobRunEvent) => unknown
  /** Errors from `onJobRun`. Default console.error. */
  onError?: (err: unknown) => void
}

export type Jobs = {
  readonly jobs: ReadonlyMap<string, AnyJob>
  readonly queue: Queue<JobMessage>
  readonly store: KeyValue
  enqueue<S extends Schema>(
    job: Job<S>,
    input: z.input<S>,
    opts?: EnqueueOptions,
  ): Promise<EnqueueResult>
  /** Enqueue by name with unchecked input (it is still validated). For outbox rows and schedules. */
  enqueueByName(name: string, input: unknown, opts?: EnqueueOptions): Promise<EnqueueResult>
  /** Run one message. The queue-consumer entry point. Never throws for a failing job. */
  handle(message: JobMessage): Promise<HandleResult>
  listDead(): Promise<DeadJob[]>
  /** Send a dead job again from attempt 1. False when the id is unknown. */
  retryDead(id: string): Promise<boolean>
  pause(name: string): Promise<void>
  resume(name: string): Promise<void>
  isPaused(name: string): Promise<boolean>
  /** Start the jobs listed for `event` (keyed per job when `key` is given) and wake runs waiting on it. */
  emit(
    event: string,
    payload: unknown,
    opts?: { key?: string; actor?: JobActor },
  ): Promise<{ started: number; woken: number }>
  /** Same as `emit`. */
  send(
    event: string,
    payload: unknown,
    opts?: { key?: string; actor?: JobActor },
  ): Promise<{ started: number; woken: number }>
  // biome-ignore lint/suspicious/noExplicitAny: see AnyJob
  on(event: string, jobs: readonly Job<any>[]): void
  /** The last known state of a run, with its progress. Null when unknown or expired. */
  status(id: string): Promise<JobStatus | null>
  /**
   * Cancel a run: it will not start, stops at its next step, and a run in
   * this process sees `ctx.signal` abort. Not retried or dead-lettered.
   */
  cancel(id: string): Promise<void>
  /** Steps waiting on `waitForApproval`. */
  listApprovals(): Promise<PendingApproval[]>
  /** Answer a `waitForApproval`. False when nothing is waiting there. */
  approve(
    id: string,
    step: string,
    decision?: { approved?: boolean; by?: string },
  ): Promise<boolean>
  /** The outbox row for an event: `enqueue(db, m.topic, m.payload)`; `outboxQueue` emits it. */
  outboxEvent(event: string, payload: unknown): { topic: string; payload: unknown }
  /** Enqueue the schedules due at `now`'s UTC minute (default: now). Returns their names. */
  runDueSchedules(now?: Date): Promise<string[]>
  /** The row for signet-db's outbox: `enqueue(db, m.topic, m.payload)`. Validates now. */
  outboxMessage<S extends Schema>(
    job: Job<S>,
    input: z.input<S>,
  ): { topic: string; payload: unknown }
  /** Give this to signet-db's `drainOutbox(db, jobs.outboxQueue)`. Dedupes on the outbox row id. */
  readonly outboxQueue: {
    send(message: { id: string; topic: string; payload: unknown }): Promise<void>
  }
}

const MAX_DELAY = 43_200 // Cloudflare Queues' ceiling, 12 h

export function retryDelay(policy: RetryPolicy, attempt: number): number {
  const s =
    policy.backoff === "fixed" ? policy.baseSeconds : policy.baseSeconds * 2 ** (attempt - 1)
  return Math.min(Math.max(0, s), MAX_DELAY)
}

function policyOf(job: AnyJob): RetryPolicy {
  return { attempts: 3, backoff: "exponential", baseSeconds: 10, ...job.retry }
}

function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === "string" && code ? code : "JOB_FAILED"
}

function messageOf(err: unknown): string {
  return String(err instanceof Error ? err.message : err).slice(0, 1000)
}

function validate(job: AnyJob, input: unknown): unknown {
  const r = job.input.safeParse(input)
  if (!r.success)
    throw new JobError("BAD_INPUT", `Invalid input for job "${job.name}".`, r.error.issues)
  return r.data
}

/** Run `work`, settling early when `ac` aborts (cancel) or `seconds` pass (abort + TIMEOUT). */
async function withTimeout<T>(
  seconds: number | undefined,
  ac: AbortController,
  work: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = new Promise<never>((_, reject) => {
    ac.signal.addEventListener("abort", () => reject(ac.signal.reason), { once: true })
    if (seconds)
      timer = setTimeout(
        () => ac.abort(new JobError("TIMEOUT", `Timed out after ${seconds}s.`)),
        seconds * 1000,
      )
  })
  stop.catch(() => {}) // settled by the race below, or never read when work wins
  try {
    return await Promise.race([work(), stop])
  } finally {
    clearTimeout(timer)
  }
}

const FINAL = new Set(["CANCELLED", "BUDGET_EXCEEDED"])

export function createJobs(options: CreateJobsOptions): Jobs {
  const {
    queue,
    store = memoryKv(),
    keyTtlSeconds = 86_400,
    pausedDelaySeconds = 60,
    throttleDelaySeconds = 5,
    stepTtlSeconds = 2_592_000,
    now = Date.now,
    trackStatus = true,
    onError = console.error,
  } = options
  const budgets = options.budgetStore
  for (const job of options.jobs)
    if (job.budget && !budgets)
      throw new JobError(
        "NO_BUDGET_STORE",
        `Job "${job.name}" has a budget: pass createJobs({ budgetStore }).`,
      )
  const running = new Map<string, AbortController>()
  const statusKey = (id: string) => `signet-job:status:${id}`
  const cancelKey = (id: string) => `signet-job:cancel:${id}`
  const readStatus = async (id: string): Promise<JobStatus | null> => {
    const raw = await store.get(statusKey(id))
    return raw ? (JSON.parse(raw) as JobStatus) : null
  }
  const setStatus = async (
    m: Pick<JobMessage, "id" | "job" | "attempt">,
    patch: Partial<JobStatus> & { state: JobStatus["state"] },
  ) => {
    if (!trackStatus) return
    const prev = await readStatus(m.id)
    const next: JobStatus = {
      ...prev,
      id: m.id,
      job: m.job,
      attempt: m.attempt,
      ...patch,
      updatedAt: new Date(now()).toISOString(),
    }
    if (patch.state !== "retrying" && patch.state !== "dead" && !patch.error) delete next.error
    await store.set(statusKey(m.id), JSON.stringify(next), { ttlSeconds: stepTtlSeconds })
  }
  const limits = options.rateLimitStore ?? kvRateLimitStore(store, "signet-job:rl")
  const dead = options.deadLetter ?? kvDeadLetter(store)
  const byName = new Map<string, AnyJob>()
  for (const job of options.jobs) {
    if (byName.has(job.name)) throw new JobError("DUPLICATE_JOB", `Two jobs named "${job.name}".`)
    byName.set(job.name, job)
  }
  const pausedKey = (name: string) => `signet-job:paused:${name}`
  const doneKey = (id: string) => `signet-job:done:${id}`
  const stepDeps = {
    store,
    now,
    ttlSeconds: stepTtlSeconds,
    send: (m: JobMessage, delaySeconds?: number) =>
      queue.send(m, delaySeconds ? { delaySeconds } : undefined),
  }
  const steps = stepStore(stepDeps)
  const triggers = new Map<string, AnyJob[]>()
  const on = (event: string, list: readonly AnyJob[]) => {
    for (const job of list) lookup(job.name)
    triggers.set(event, [...(triggers.get(event) ?? []), ...list])
  }

  const lookup = (name: string) => {
    const job = byName.get(name)
    if (!job) throw new JobError("UNKNOWN_JOB", `No job named "${name}" is registered.`)
    return job
  }

  /** True the first time a key is seen. Exact with `incr`, approximate without. */
  const claimKey = async (name: string, key: string) => {
    const k = `signet-job:key:${name}:${key}`
    if (store.incr) return (await store.incr(k, keyTtlSeconds)) === 1
    if (await store.get(k)) return false
    await store.set(k, "1", { ttlSeconds: keyTtlSeconds })
    return true
  }

  const enqueueByName = async (name: string, input: unknown, opts: EnqueueOptions = {}) => {
    const job = lookup(name)
    const data = validate(job, input)
    const id = crypto.randomUUID()
    if (opts.key !== undefined) {
      if (!opts.key) throw new JobError("BAD_INPUT", "An enqueue key must not be empty.")
      if (!(await claimKey(name, opts.key))) return { id, enqueued: false }
    }
    const message: JobMessage = { id, job: name, input: data, attempt: 1 }
    if (opts.key) message.key = opts.key
    if (opts.actor) message.actor = opts.actor
    await queue.send(message, opts.delaySeconds ? { delaySeconds: opts.delaySeconds } : undefined)
    await setStatus(message, { state: "queued" })
    return { id, enqueued: true }
  }

  const report = async (event: JobRunEvent) => {
    if (!options.onJobRun) return
    try {
      await options.onJobRun(event)
    } catch (err) {
      onError(err)
    }
  }

  const toDead = async (message: JobMessage, err: unknown): Promise<HandleResult> => {
    await dead.put({
      ...message,
      error: { code: codeOf(err), message: messageOf(err) },
      failedAt: new Date().toISOString(),
    })
    return { status: "dead", code: codeOf(err) }
  }

  /** A concurrency slot: claim one of `limit` keys, release by deleting it. Exact with `incr`. */
  const acquire = async (job: AnyJob, input: unknown) => {
    const c = job.concurrency
    if (!c) return async () => {}
    const lease = Math.max(60, Math.ceil(job.timeoutSeconds ?? 900))
    const base = `signet-job:slot:${job.name}:${c.key(input)}`
    for (let i = 0; i < c.limit; i++) {
      const k = `${base}:${i}`
      let mine: boolean
      if (store.incr) mine = (await store.incr(k, lease)) === 1
      else {
        // ponytail: without incr (Workers KV) two runs can take the same slot.
        mine = !(await store.get(k))
        if (mine) await store.set(k, "1", { ttlSeconds: lease })
      }
      if (mine) return () => store.delete(k)
    }
    return null
  }

  const handle = async (message: JobMessage): Promise<HandleResult> => {
    const result = await dispatch(message)
    if (result.status !== "skipped")
      await setStatus(message, {
        state: result.status,
        ...(result.code ? { error: { code: result.code } } : {}),
      })
    return result
  }

  const dispatch = async (message: JobMessage): Promise<HandleResult> => {
    const job = byName.get(message.job)
    if (!job) {
      return toDead(
        message,
        new JobError("UNKNOWN_JOB", `No job named "${message.job}" is registered.`),
      )
    }
    if (await store.get(doneKey(message.id))) return { status: "skipped" }
    if (await store.get(cancelKey(message.id))) return { status: "cancelled" }
    if (await store.get(pausedKey(job.name))) {
      await queue.send(message, { delaySeconds: pausedDelaySeconds })
      return { status: "paused" }
    }
    const actor = message.actor ?? { type: "system", id: job.name }
    const started = Date.now()
    const ac = new AbortController()
    let input: unknown
    try {
      input = validate(job, message.input)
    } catch (err) {
      const result = await toDead(message, err)
      await report({
        name: job.name,
        id: message.id,
        attempt: message.attempt,
        durationMs: 0,
        ok: false,
        code: result.code,
        error: err,
        actor,
      })
      return result
    }
    const release = await acquire(job, input)
    if (!release) {
      await queue.send(message, { delaySeconds: throttleDelaySeconds })
      return { status: "throttled" }
    }
    try {
      if (job.rateLimit) {
        const r = job.rateLimit
        const hit = await limits.hit(`job:${job.name}`, r.key(input), r.max, r.windowSeconds)
        if (!hit.ok) {
          await queue.send(message, { delaySeconds: Math.max(1, hit.resetSeconds) })
          return { status: "throttled" }
        }
      }
      return await execute(job, message, input, actor, ac, started)
    } finally {
      await release()
    }
  }

  const execute = async (
    job: AnyJob,
    message: JobMessage,
    input: unknown,
    actor: JobActor,
    ac: AbortController,
    started: number,
  ): Promise<HandleResult> => {
    const used = { value: false }
    let cost = 0
    const budget = job.budget && {
      key: job.budget.key(input) as string,
      limit: job.budget.limitUsd,
      window: job.budget.windowSeconds,
    }
    const checkpoint = async () => {
      if (await store.get(cancelKey(message.id)))
        throw new JobError("CANCELLED", "The run was cancelled.")
      if (
        budget &&
        budgets &&
        (await budgets.spent(budget.key, budget.window, now())) >= budget.limit
      )
        throw new JobError(
          "BUDGET_EXCEEDED",
          `Budget for "${budget.key}" is used up ($${budget.limit} per ${budget.window}s).`,
        )
    }
    const ctx: JobContext = {
      id: message.id,
      name: job.name,
      attempt: message.attempt,
      actor,
      signal: ac.signal,
      step: makeSteps(stepDeps, steps, message, used, checkpoint),
      progress: (done, total, note) =>
        setStatus(message, {
          state: "running",
          progress: { done, ...(total !== undefined ? { total } : {}), ...(note ? { note } : {}) },
        }),
      async recordCost(usd) {
        cost += usd
        if (budget && budgets) await budgets.record(budget.key, usd, budget.window, now())
      },
      ...(message.key ? { key: message.key } : {}),
    }
    const withCost = () => (cost ? { costUsd: cost } : {})
    const run = async () => {
      await job.run(input, ctx)
    }
    running.set(message.id, ac)
    try {
      await setStatus(message, { state: "running" })
      await checkpoint()
      await withTimeout(job.timeoutSeconds, ac, () =>
        message.key && options.idempotency
          ? options.idempotency(message.key, job.name, run).then(() => undefined)
          : run(),
      )
    } catch (err) {
      if (err instanceof Suspend) return { status: err.status }
      const code = codeOf(err)
      const base = { name: job.name, id: message.id, attempt: message.attempt, actor }
      await report({
        ...base,
        durationMs: Date.now() - started,
        ok: false,
        code,
        error: err,
        ...withCost(),
      })
      if (code === "CANCELLED") return { status: "cancelled", code }
      const policy = policyOf(job)
      if (message.attempt < policy.attempts && !FINAL.has(code)) {
        await queue.send(
          { ...message, attempt: message.attempt + 1 },
          { delaySeconds: retryDelay(policy, message.attempt) },
        )
        return { status: "retrying", code }
      }
      return toDead(message, err)
    } finally {
      running.delete(message.id)
    }
    // Stray wake-ups (a wait's timer after the event resumed it) skip a finished run.
    if (used.value) await store.set(doneKey(message.id), "1", { ttlSeconds: stepTtlSeconds })
    await report({
      name: job.name,
      id: message.id,
      attempt: message.attempt,
      durationMs: Date.now() - started,
      ok: true,
      actor,
      ...withCost(),
    })
    return { status: "done" }
  }

  const emit: Jobs["emit"] = async (event, payload, opts = {}) => {
    let started = 0
    for (const job of triggers.get(event) ?? []) {
      const r = await enqueueByName(job.name, payload, opts)
      if (r.enqueued) started++
    }
    return { started, woken: await steps.wake(event, payload) }
  }
  for (const [event, list] of Object.entries(options.triggers ?? {})) on(event, list)

  const runtime: Jobs = {
    jobs: byName,
    queue,
    store,
    enqueue: (job, input, opts) => enqueueByName(job.name, input, opts),
    enqueueByName,
    handle,
    listDead: () => dead.list(),
    async retryDead(id) {
      const entry = await dead.get(id)
      if (!entry) return false
      const { error: _e, failedAt: _f, ...message } = entry
      await queue.send({ ...message, attempt: 1 })
      await dead.delete(id)
      return true
    },
    async pause(name) {
      lookup(name)
      await store.set(pausedKey(name), "1")
    },
    async resume(name) {
      lookup(name)
      await store.delete(pausedKey(name))
    },
    async isPaused(name) {
      return (await store.get(pausedKey(name))) !== null
    },
    runDueSchedules: (at) => runDueSchedules(runtime, options.schedules ?? [], at),
    emit,
    send: emit,
    on,
    listApprovals: () => steps.listApprovals(),
    status: readStatus,
    async cancel(id) {
      await store.set(cancelKey(id), "1", { ttlSeconds: stepTtlSeconds })
      running.get(id)?.abort(new JobError("CANCELLED", "The run was cancelled."))
      const prev = await readStatus(id)
      if (prev) await setStatus(prev, { state: "cancelled" })
    },
    async approve(id, step, decision = {}) {
      if (!(await steps.removeApproval(id, step))) return false
      const payload = {
        approved: decision.approved ?? true,
        ...(decision.by ? { by: decision.by } : {}),
      }
      await steps.wake(approvalEvent(id, step), payload)
      return true
    },
    outboxEvent: (event, payload) => ({ topic: `event:${event}`, payload }),
    outboxMessage(job, input) {
      return { topic: job.name, payload: validate(lookup(job.name), input) }
    },
    outboxQueue: {
      async send({ id, topic, payload }) {
        if (topic.startsWith("event:")) await emit(topic.slice(6), payload, { key: `outbox:${id}` })
        else await enqueueByName(topic, payload, { key: `outbox:${id}` })
      },
    },
  }
  // ponytail: a job binds to the last createJobs that listed it, so `job.enqueue`
  // works from module scope. Two runtimes with the same job in one isolate:
  // call `jobs.enqueue(job, input)` on the one you mean.
  for (const job of byName.values()) job[RUNTIME] = runtime
  return runtime
}
