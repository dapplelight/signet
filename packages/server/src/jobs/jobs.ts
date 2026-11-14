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
import { type KeyValue, memoryKv, type Queue } from "../adapters/index.js"
import { runDueSchedules, type Schedule } from "./cron.js"

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
}

export type JobContext = {
  id: string
  name: string
  attempt: number
  key?: string
  actor: JobActor
  /** Aborted when `timeoutSeconds` passes. Hand it to fetch and other cancellable work. */
  signal: AbortSignal
}

type Schema = z.ZodType

export type JobDefinition<S extends Schema> = {
  name: string
  /** Checked at enqueue and again before each run. */
  input: S
  retry?: Partial<RetryPolicy>
  timeoutSeconds?: number
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
}

export type HandleResult = {
  status: "done" | "retrying" | "dead" | "paused" | "skipped"
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

async function withTimeout<T>(
  seconds: number | undefined,
  ac: AbortController,
  work: () => Promise<T>,
): Promise<T> {
  if (!seconds) return work()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new JobError("TIMEOUT", `Timed out after ${seconds}s.`)
      ac.abort(err)
      reject(err)
    }, seconds * 1000)
  })
  try {
    return await Promise.race([work(), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export function createJobs(options: CreateJobsOptions): Jobs {
  const {
    queue,
    store = memoryKv(),
    keyTtlSeconds = 86_400,
    pausedDelaySeconds = 60,
    onError = console.error,
  } = options
  const dead = options.deadLetter ?? kvDeadLetter(store)
  const byName = new Map<string, AnyJob>()
  for (const job of options.jobs) {
    if (byName.has(job.name)) throw new JobError("DUPLICATE_JOB", `Two jobs named "${job.name}".`)
    byName.set(job.name, job)
  }
  const pausedKey = (name: string) => `signet-job:paused:${name}`

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

  const handle = async (message: JobMessage): Promise<HandleResult> => {
    const job = byName.get(message.job)
    if (!job) {
      return toDead(
        message,
        new JobError("UNKNOWN_JOB", `No job named "${message.job}" is registered.`),
      )
    }
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
    const ctx: JobContext = {
      id: message.id,
      name: job.name,
      attempt: message.attempt,
      actor,
      signal: ac.signal,
      ...(message.key ? { key: message.key } : {}),
    }
    const run = async () => {
      await job.run(input, ctx)
    }
    try {
      await withTimeout(job.timeoutSeconds, ac, () =>
        message.key && options.idempotency
          ? options.idempotency(message.key, job.name, run).then(() => undefined)
          : run(),
      )
    } catch (err) {
      const code = codeOf(err)
      const base = { name: job.name, id: message.id, attempt: message.attempt, actor }
      await report({ ...base, durationMs: Date.now() - started, ok: false, code, error: err })
      const policy = policyOf(job)
      if (message.attempt < policy.attempts) {
        await queue.send(
          { ...message, attempt: message.attempt + 1 },
          { delaySeconds: retryDelay(policy, message.attempt) },
        )
        return { status: "retrying", code }
      }
      return toDead(message, err)
    }
    await report({
      name: job.name,
      id: message.id,
      attempt: message.attempt,
      durationMs: Date.now() - started,
      ok: true,
      actor,
    })
    return { status: "done" }
  }

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
    runDueSchedules: (now) => runDueSchedules(runtime, options.schedules ?? [], now),
    outboxMessage(job, input) {
      return { topic: job.name, payload: validate(lookup(job.name), input) }
    },
    outboxQueue: {
      async send({ id, topic, payload }) {
        await enqueueByName(topic, payload, { key: `outbox:${id}` })
      },
    },
  }
  // ponytail: a job binds to the last createJobs that listed it, so `job.enqueue`
  // works from module scope. Two runtimes with the same job in one isolate:
  // call `jobs.enqueue(job, input)` on the one you mean.
  for (const job of byName.values()) job[RUNTIME] = runtime
  return runtime
}
