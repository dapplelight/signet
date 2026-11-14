/**
 * Cron schedules for jobs: a 5-field UTC matcher, `defineSchedule`, and `runDueSchedules` for a Cloudflare cron trigger or a Node/Bun interval.
 *
 * Fields: minute hour day-of-month month day-of-week, each `*`, a number, a
 * range `a-b`, a step `*\/n`, `a-b/n` or `a/n`, or a comma list of those.
 * Day-of-week is 0-7 (0 and 7 are Sunday). As in Vixie cron, when both
 * day-of-month and day-of-week are restricted, a day matching either runs.
 * No month or day names, no `@daily` shorthands.
 */

import type { Jobs } from "./jobs.js"

type Field = { set: Set<number>; star: boolean }
export type Cron = { minute: Field; hour: Field; dom: Field; month: Field; dow: Field }

const BOUNDS: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
]

function parseField(src: string, [min, max]: [number, number], expr: string): Field {
  const set = new Set<number>()
  const bad = () => new Error(`Invalid cron expression "${expr}": bad field "${src}".`)
  const num = (s: string) => {
    if (!/^\d+$/.test(s)) throw bad()
    const n = Number(s)
    if (n < min || n > max) throw bad()
    return n
  }
  for (const part of src.split(",")) {
    const [range, stepSrc, extra] = part.split("/")
    if (extra !== undefined || range === undefined) throw bad()
    const step = stepSrc === undefined ? 1 : num(stepSrc)
    if (step < 1) throw bad()
    let lo: number
    let hi: number
    if (range === "*") [lo, hi] = [min, max]
    else if (range.includes("-")) {
      const [a = "", b = ""] = range.split("-")
      ;[lo, hi] = [num(a), num(b)]
      if (lo > hi) throw bad()
    } else {
      lo = num(range)
      hi = stepSrc === undefined ? lo : max
    }
    for (let n = lo; n <= hi; n += step) set.add(n)
  }
  return { set, star: src === "*" }
}

/** Parse a 5-field expression. Throws with the offending field. */
export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Invalid cron expression "${expr}": need 5 fields.`)
  const [minute, hour, dom, month, dow] = parts.map((p, i) =>
    parseField(p, BOUNDS[i] as [number, number], expr),
  ) as [Field, Field, Field, Field, Field]
  if (dow.set.has(7)) dow.set.add(0)
  return { minute, hour, dom, month, dow }
}

/** Does `date`'s UTC minute match? */
export function cronMatches(cron: Cron | string, date: Date): boolean {
  const c = typeof cron === "string" ? parseCron(cron) : cron
  if (!c.minute.set.has(date.getUTCMinutes())) return false
  if (!c.hour.set.has(date.getUTCHours())) return false
  if (!c.month.set.has(date.getUTCMonth() + 1)) return false
  const domOk = c.dom.set.has(date.getUTCDate())
  const dowOk = c.dow.set.has(date.getUTCDay())
  if (c.dom.star || c.dow.star) return domOk && dowOk
  return domOk || dowOk
}

export type Schedule = {
  name: string
  cron: string
  parsed: Cron
  job: { name: string }
  input: unknown | (() => unknown)
}

/** A job to enqueue on a cron. `input` may be a function, called at each tick. */
export function defineSchedule(def: {
  name: string
  cron: string
  job: { name: string }
  input?: unknown | (() => unknown)
}): Schedule {
  return { ...def, input: def.input ?? {}, parsed: parseCron(def.cron) }
}

/**
 * Enqueue every schedule due at `now`'s minute. Each enqueue is keyed by
 * schedule and minute, so two ticks (or two instances) in the same minute run
 * it once when the store has `incr` (approximately once without). Returns the
 * names enqueued.
 */
export async function runDueSchedules(
  jobs: Pick<Jobs, "enqueueByName">,
  schedules: readonly Schedule[],
  now: Date = new Date(),
): Promise<string[]> {
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString()
  const ran: string[] = []
  for (const s of schedules) {
    if (!cronMatches(s.parsed, now)) continue
    const input = typeof s.input === "function" ? (s.input as () => unknown)() : s.input
    const r = await jobs.enqueueByName(s.job.name, input, { key: `schedule:${s.name}:${minute}` })
    if (r.enqueued) ran.push(s.name)
  }
  return ran
}

/**
 * Cloudflare `scheduled` handler. Add one `* * * * *` cron trigger in
 * wrangler and let the schedules decide; `waitUntil` keeps the enqueue alive.
 */
export function cloudflareScheduled(jobs: Pick<Jobs, "runDueSchedules">) {
  return (
    event: { scheduledTime: number },
    _env?: unknown,
    ctx?: { waitUntil(p: Promise<unknown>): void },
  ): Promise<string[]> => {
    const work = jobs.runDueSchedules(new Date(event.scheduledTime))
    ctx?.waitUntil(work)
    return work
  }
}

/**
 * Node/Bun: check schedules at the top of every minute. Returns a stop function.
 * Errors go to `onError` (default console.error); the loop keeps going.
 */
export function startScheduler(
  jobs: Pick<Jobs, "runDueSchedules">,
  onError: (err: unknown) => void = console.error,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const tick = () => {
    if (stopped) return
    jobs.runDueSchedules(new Date()).catch(onError)
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
  }
  timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
