/**
 * Durable steps for jobs: `step.run` memoises a result in the `KeyValue`, `step.sleep` and `step.waitFor` suspend the run by re-enqueueing instead of blocking.
 *
 * A retry (or a wake-up) runs the job from the top; finished steps return
 * their stored result, so it resumes after the last completed one. Results
 * are stored as JSON, so a replay returns the JSON form (Dates as strings).
 * Step names must be unique within a run and stable across deploys.
 */

import type { KeyValue } from "../adapters/index.js"
import type { JobMessage } from "./jobs.js"

export type Steps = {
  /** Run `fn` once per job run id; later attempts get its stored result. */
  run<T>(name: string, fn: () => T | Promise<T>): Promise<T>
  /** Suspend for `seconds` (any length: long sleeps hop in 12 h legs). */
  sleep(name: string, seconds: number): Promise<void>
  /**
   * Suspend until `jobs.emit(event, payload)`; returns the payload, or null on
   * timeout (default 7 days). Put an id in the event name to wait for one
   * thing: `order.paid:${orderId}`.
   */
  waitFor<T = unknown>(
    name: string,
    opts: { event: string; timeoutSeconds?: number },
  ): Promise<T | null>
  /**
   * Suspend until `jobs.approve(id, step, ...)` (or the `decide_job_approval`
   * agent tool). Times out as not approved (default 7 days).
   */
  waitForApproval(
    name: string,
    summary: string,
    opts?: { timeoutSeconds?: number },
  ): Promise<ApprovalDecision>
}

export type ApprovalDecision = { approved: boolean; by?: string; timedOut?: true }

/** One step waiting on a person, for `jobs.listApprovals()`. */
export type PendingApproval = {
  id: string
  job: string
  step: string
  summary: string
  requestedAt: string
}

type StepState =
  | { done: true; value: unknown }
  | { sleepUntil: number }
  | { waitUntil: number; event: string }

type Waiter = { message: JobMessage; step: string }

/** Thrown by a step to end this run early; `handle` turns it into a status. */
export class Suspend {
  constructor(readonly status: "sleeping" | "waiting") {}
}

const MAX_DELAY = 43_200
const WEEK = 604_800

export type StepDeps = {
  store: KeyValue
  send(message: JobMessage, delaySeconds?: number): Promise<void>
  now(): number
  ttlSeconds: number
}

const stepKey = (id: string, name: string) => `signet-job:step:${id}:${name}`
const waitersKey = (event: string) => `signet-job:waiters:${event}`
const APPROVALS = "signet-job:approvals"
export const approvalEvent = (id: string, step: string) => `signet-approval:${id}:${step}`

async function readJson<T>(store: KeyValue, key: string, fallback: T): Promise<T> {
  const raw = await store.get(key)
  return raw ? (JSON.parse(raw) as T) : fallback
}

// ponytail: the waiter and approval lists are read-modify-write in the
// KeyValue, so two writers at the same instant can drop an entry. Fine for a
// handful of waits; a table-backed store if many runs wait on one event.
export function stepStore(deps: StepDeps) {
  const { store, ttlSeconds } = deps
  const read = (id: string, name: string) =>
    readJson<StepState | null>(store, stepKey(id, name), null)
  const write = (id: string, name: string, state: StepState) =>
    store.set(stepKey(id, name), JSON.stringify(state), { ttlSeconds })

  return {
    read,
    write,
    async addWaiter(event: string, waiter: Waiter) {
      const list = await readJson<Waiter[]>(store, waitersKey(event), [])
      list.push(waiter)
      await store.set(waitersKey(event), JSON.stringify(list), { ttlSeconds })
    },
    /** Resolve every run waiting on `event` with `payload` and wake it. Returns how many. */
    async wake(event: string, payload: unknown): Promise<number> {
      const list = await readJson<Waiter[]>(store, waitersKey(event), [])
      if (!list.length) return 0
      await store.delete(waitersKey(event))
      let woken = 0
      for (const { message, step } of list) {
        const state = await read(message.id, step)
        if (!state || "done" in state) continue // timed out already
        await write(message.id, step, { done: true, value: payload ?? null })
        const { wake: _w, ...rest } = message
        await deps.send(rest)
        woken++
      }
      return woken
    },
    listApprovals: () => readJson<PendingApproval[]>(store, APPROVALS, []),
    async addApproval(entry: PendingApproval) {
      const list = await readJson<PendingApproval[]>(store, APPROVALS, [])
      if (!list.some((a) => a.id === entry.id && a.step === entry.step)) list.push(entry)
      await store.set(APPROVALS, JSON.stringify(list))
    },
    async removeApproval(id: string, step: string): Promise<boolean> {
      const list = await readJson<PendingApproval[]>(store, APPROVALS, [])
      const rest = list.filter((a) => !(a.id === id && a.step === step))
      if (rest.length === list.length) return false
      await store.set(APPROVALS, JSON.stringify(rest))
      return true
    },
  }
}

export type StepStore = ReturnType<typeof stepStore>

/**
 * The `step` object for one run. `used.value` turns true once a step is
 * called, so `handle` knows to mark the run finished (stray wake-ups skip it).
 */
export function makeSteps(
  deps: StepDeps,
  db: StepStore,
  message: JobMessage,
  used: { value: boolean },
  beforeStep: () => Promise<void>,
): Steps {
  const { id } = message
  const later = async (until: number, name: string) => {
    const seconds = Math.min(Math.ceil((until - deps.now()) / 1000), MAX_DELAY)
    await deps.send({ ...message, wake: name }, Math.max(1, seconds))
  }

  const waitFor = async <T>(
    name: string,
    { event, timeoutSeconds = WEEK }: { event: string; timeoutSeconds?: number },
  ): Promise<T | null> => {
    used.value = true
    await beforeStep()
    const state = await db.read(id, name)
    if (state && "done" in state) return state.value as T
    if (!state) {
      const until = deps.now() + timeoutSeconds * 1000
      await db.write(id, name, { waitUntil: until, event })
      await db.addWaiter(event, { message: { ...message, wake: undefined }, step: name })
      await later(until, name)
      throw new Suspend("waiting")
    }
    if (!("waitUntil" in state)) throw new Error(`Step "${name}" was not a wait in an earlier run.`)
    if (deps.now() >= state.waitUntil) {
      await db.write(id, name, { done: true, value: null })
      return null
    }
    // The timer for a long wait hops in 12 h legs; any other copy just stops.
    if (message.wake === name) await later(state.waitUntil, name)
    throw new Suspend("waiting")
  }

  return {
    async run(name, fn) {
      used.value = true
      await beforeStep()
      const state = await db.read(id, name)
      if (state && "done" in state) return state.value as never
      const value = await fn()
      await db.write(id, name, { done: true, value: value ?? null })
      return value
    },
    async sleep(name, seconds) {
      used.value = true
      await beforeStep()
      const state = await db.read(id, name)
      if (state && "done" in state) return
      if (state && !("sleepUntil" in state))
        throw new Error(`Step "${name}" was not a sleep in an earlier run.`)
      const until = state ? state.sleepUntil : deps.now() + seconds * 1000
      if (deps.now() >= until) {
        await db.write(id, name, { done: true, value: null })
        return
      }
      if (!state) await db.write(id, name, { sleepUntil: until })
      if (!state || message.wake === name) await later(until, name)
      throw new Suspend("sleeping")
    },
    waitFor,
    async waitForApproval(name, summary, opts = {}) {
      if (!(await db.read(id, name)))
        await db.addApproval({
          id,
          job: message.job,
          step: name,
          summary,
          requestedAt: new Date(deps.now()).toISOString(),
        })
      const decision = await waitFor<ApprovalDecision>(name, {
        event: approvalEvent(id, name),
        ...(opts.timeoutSeconds ? { timeoutSeconds: opts.timeoutSeconds } : {}),
      })
      if (decision) return decision
      await db.removeApproval(id, name)
      return { approved: false, timedOut: true }
    },
  }
}
