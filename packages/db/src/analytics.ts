/**
 * Analytics events stored in your own database (any signet-db dialect), and
 * typed questions over them: counts, unique people, time series, breakdowns,
 * funnels, retention cohorts and period-over-period trends.
 *
 * ```ts
 * const store = createAnalyticsStore(db, { table: analyticsEvents(), privacy })
 * registerIngest(app, "/api/events", { engine: store, userId: (c) => c.get("user")?.id })
 * await store.trend({ event: "signup", period: "week" })   // { current: 124, previous: 105, change: 0.18 }
 * await store.prune()                                       // from a daily cron
 * ```
 *
 * `store` is an `AnalyticsSink`, so signet-server's `registerIngest` and
 * `serverTracker` write to it directly. A person is `userId`, else
 * `anonymousId`; `$identify` links a browser's anonymous events to its user.
 *
 * Every value reaches SQL as a bound parameter. Property names are checked
 * against `[A-Za-z_][A-Za-z0-9_]*` before use; bucket sizes are integers
 * this module computes.
 */

import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  type SQL,
  sql,
  type Table,
} from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"

export { type AnalyticsToolsOptions, analyticsTools } from "./analytics-tools.js"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const WEEK = 7 * DAY
/** 1970-01-05 was a Monday: weeks start on Monday. */
const MONDAY = 4 * DAY

type Scalar = string | number | boolean | null | undefined

/** What `write` accepts: signet-server's `TrackedEvent`. */
export type StoredEventInput = {
  name: string
  props?: Record<string, Scalar>
  ts?: number
  anonymousId?: string
  sessionId?: string
  userId?: string
}

export type AnalyticsStoreOptions = {
  /** The `analyticsEvents()` table. */
  table: Table
  /**
   * Days to keep events; `prune()` deletes older ones. Default 395 (13
   * months, so this month can be compared with the same month last year).
   * `null` keeps everything.
   */
  retentionDays?: number | null
  /**
   * signet-db's `createPrivacy(...)`, or anything with `has`. When given, a
   * userId is stored, and `$identify` links, only for people who consented
   * to `purpose`; otherwise their events are kept anonymous.
   */
  privacy?: { has(subject: string, purpose: string): Promise<boolean> }
  /** The consent purpose. Default "analytics". */
  purpose?: string
  /** Clock, for tests. */
  now?: () => Date
}

export type Bucket = "hour" | "day" | "week"
export type Period = "day" | "week" | "month" | number
type Time = Date | number

export type Range = {
  /** Default: `to` minus 7 days. */
  from?: Time
  /** Exclusive. Default: now. */
  to?: Time
}

export type Filter = Range & {
  /** One event name; omit for every event. */
  event?: string
  /** Property equality, e.g. `{ plan: "pro" }`. Compared as text. */
  where?: Record<string, string | number | boolean>
}

export type TrendResult = {
  current: number
  previous: number
  /** (current − previous) / previous; null when previous is 0. */
  change: number | null
}

export type CohortRow = {
  /** Start of the cohort's bucket, epoch ms. */
  cohort: number
  size: number
  /** People active in each period after joining; `returned[0]` is the joining period. */
  returned: number[]
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: analytics columns are known by name
type Cols = Record<string, any>

const bad = (msg: string) => new SignetDbError("BAD_INPUT", msg)
const ms = (t: Time) => (t instanceof Date ? t.getTime() : t)
const PROP = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const BUCKETS: Record<Bucket, number> = { hour: HOUR, day: DAY, week: WEEK }

/** Bucket start for `ts`; the same formula runs in SQL. */
const bucketShift = (bucket: Bucket, utcOffsetMinutes: number) =>
  utcOffsetMinutes * 60_000 - (bucket === "week" ? MONDAY : 0)
const bucketStart = (ts: number, size: number, shift: number) =>
  Math.floor((ts + shift) / size) * size - shift

export function createAnalyticsStore(db: SignetDb<unknown>, options: AnalyticsStoreOptions) {
  const o = db.orm as AnyOrm
  const T = options.table
  const C = T as unknown as Cols
  const now = options.now ?? (() => new Date())
  const purpose = options.purpose ?? "analytics"
  const retentionDays = options.retentionDays === undefined ? 395 : options.retentionDays
  const pg = db.dialect === "pg"

  const person = sql`coalesce(${C.userId}, ${C.anonymousId})`

  const prop = (key: string): SQL => {
    if (!PROP.test(key)) throw bad(`Property "${key}" is not a plain name.`)
    return pg
      ? sql`(${C.props} ->> ${key}::text)`
      : sql`cast(json_extract(${C.props}, ${`$.${key}`}) as text)`
  }

  const range = (r: Range = {}): [number, number] => {
    const to = r.to === undefined ? now().getTime() : ms(r.to)
    const from = r.from === undefined ? to - WEEK : ms(r.from)
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to)
      throw bad("from must be a time before to.")
    return [from, to]
  }

  const conditions = (f: Filter, extra: Array<SQL | undefined> = []) => {
    const [from, to] = range(f)
    if (f.event !== undefined && (typeof f.event !== "string" || !f.event))
      throw bad("event must be a non-empty string.")
    return and(
      f.event === undefined ? undefined : eq(C.name, f.event),
      gte(C.ts, from),
      lt(C.ts, to),
      ...Object.entries(f.where ?? {}).map(([k, v]) => sql`${prop(k)} = ${String(v)}`),
      ...extra,
    )
  }

  const num = (v: unknown) => Number(v ?? 0)

  const toRow = (e: StoredEventInput, keepUser: boolean) => {
    const props: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(e.props ?? {})) {
      if (v === null || v === undefined) continue
      // Booleans as text, so filters compare the same way in every dialect.
      props[k] = typeof v === "boolean" ? String(v) : v
    }
    return {
      name: e.name,
      ts: typeof e.ts === "number" && Number.isFinite(e.ts) ? Math.trunc(e.ts) : now().getTime(),
      anonymousId: e.anonymousId ?? null,
      sessionId: e.sessionId ?? null,
      userId: keepUser ? (e.userId ?? null) : null,
      props: Object.keys(props).length ? props : null,
    }
  }

  async function write(events: StoredEventInput[]): Promise<number> {
    const valid = events.filter((e) => typeof e?.name === "string" && e.name)
    const consent = new Map<string, boolean>()
    for (const e of valid) {
      if (!e.userId || consent.has(e.userId)) continue
      consent.set(e.userId, options.privacy ? await options.privacy.has(e.userId, purpose) : true)
    }
    const allowed = (e: StoredEventInput) => !!e.userId && consent.get(e.userId) === true
    // Without consent, `$identify` (which exists only to link) is not stored at all.
    const kept = valid.filter((e) => e.name !== "$identify" || allowed(e))
    const rows = kept.map((e) => toRow(e, allowed(e)))
    // 10 rows x 7 columns stays under D1's 100 bound parameters per statement.
    for (let i = 0; i < rows.length; i += 10) await o.insert(T).values(rows.slice(i, i + 10))
    for (const e of kept)
      if (e.name === "$identify" && e.anonymousId) await identify(e.anonymousId, e.userId as string)
    return rows.length
  }

  /** Give the anonymous events of `anonymousId` to `userId`. Returns how many moved. */
  async function identify(anonymousId: string, userId: string): Promise<number> {
    if (!anonymousId || !userId) throw bad("identify needs an anonymousId and a userId.")
    if (options.privacy && !(await options.privacy.has(userId, purpose))) return 0
    const moved = await o
      .update(T)
      .set({ userId })
      .where(and(eq(C.anonymousId, anonymousId), isNull(C.userId)))
      .returning({ id: C.id })
    return moved.length
  }

  async function count_(f: Filter = {}): Promise<number> {
    const [row] = await o.select({ n: count() }).from(T).where(conditions(f))
    return num(row?.n)
  }

  async function uniques(f: Filter & { by?: "person" | "session" } = {}): Promise<number> {
    const key = f.by === "session" ? C.sessionId : person
    const [row] = await o
      .select({ n: sql`count(distinct ${key})` })
      .from(T)
      .where(conditions(f))
    return num(row?.n)
  }

  async function series(
    f: Filter & { bucket?: Bucket; unique?: boolean; utcOffsetMinutes?: number } = {},
  ): Promise<Array<{ start: number; value: number }>> {
    const bucket = f.bucket ?? "day"
    const size = BUCKETS[bucket]
    if (!size) throw bad(`bucket must be one of ${Object.keys(BUCKETS).join(", ")}.`)
    const offset = f.utcOffsetMinutes ?? 0
    if (!Number.isInteger(offset) || Math.abs(offset) > 14 * 60)
      throw bad("utcOffsetMinutes must be a whole number of minutes within ±14 hours.")
    const shift = bucketShift(bucket, offset)
    const [from, to] = range(f)
    // Integers this module computed, inlined so every dialect does integer arithmetic.
    const startSql = sql`(((${C.ts} + ${sql.raw(String(shift))}) / ${sql.raw(String(size))}) * ${sql.raw(String(size))} - ${sql.raw(String(shift))})`
    const value = f.unique ? sql`count(distinct ${person})` : sql`count(*)`
    const rows: Array<{ start: unknown; value: unknown }> = await o
      .select({ start: startSql, value })
      .from(T)
      .where(conditions(f))
      .groupBy(startSql)
    const got = new Map(rows.map((r) => [num(r.start), num(r.value)]))
    const out: Array<{ start: number; value: number }> = []
    for (let t = bucketStart(from, size, shift); t < to; t += size)
      out.push({ start: t, value: got.get(t) ?? 0 })
    return out
  }

  async function breakdown(
    f: Filter & { property: string; limit?: number; unique?: boolean },
  ): Promise<Array<{ value: string | null; count: number }>> {
    const limit = f.limit ?? 10
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw bad("limit must be 1 to 100.")
    const key = prop(f.property)
    const n = f.unique ? sql`count(distinct ${person})` : sql`count(*)`
    const rows: Array<{ value: unknown; n: unknown }> = await o
      .select({ value: key, n })
      .from(T)
      .where(conditions(f))
      // By position: in Postgres the property name is a parameter, and two
      // parameters are never "the same expression" to GROUP BY.
      .groupBy(sql`1`)
      .orderBy(desc(n))
      .limit(limit)
    return rows.map((r) => ({ value: r.value == null ? null : String(r.value), count: num(r.n) }))
  }

  /**
   * People who did each step in order, each within `withinMs` of their
   * first step (default: the whole range).
   */
  async function funnel(
    f: Range & { steps: string[]; withinMs?: number },
  ): Promise<Array<{ event: string; count: number; rate: number }>> {
    const steps = f.steps
    if (
      !Array.isArray(steps) ||
      steps.length < 2 ||
      steps.length > 10 ||
      !steps.every((s) => typeof s === "string" && s)
    )
      throw bad("steps must be 2 to 10 event names.")
    const [from, to] = range(f)
    const within = f.withinMs ?? Number.POSITIVE_INFINITY
    // ponytail: walks the steps' rows in memory; move to SQL window functions if a range holds millions.
    const rows: Array<{ p: string; name: string; ts: unknown }> = await o
      .select({ p: person, name: C.name, ts: C.ts })
      .from(T)
      .where(
        and(inArray(C.name, [...new Set(steps)]), gte(C.ts, from), lt(C.ts, to), isNotNull(person)),
      )
      .orderBy(C.ts)
    const reached = new Map<string, { stage: number; start: number }>()
    for (const r of rows) {
      const ts = num(r.ts)
      const s = reached.get(r.p) ?? { stage: 0, start: ts }
      if (
        s.stage < steps.length &&
        r.name === steps[s.stage] &&
        (s.stage === 0 || ts - s.start <= within)
      ) {
        if (s.stage === 0) s.start = ts
        s.stage++
      }
      reached.set(r.p, s)
    }
    const counts = steps.map((_, i) => [...reached.values()].filter((s) => s.stage > i).length)
    return steps.map((event, i) => ({
      event,
      count: counts[i] as number,
      rate: counts[0] ? (counts[i] as number) / (counts[0] as number) : 0,
    }))
  }

  /**
   * Cohorts by the bucket of each person's first `startEvent` in the range,
   * and how many of them did `returnEvent` (default: any event) in each
   * following period.
   */
  async function retention(
    f: Range & {
      startEvent: string
      returnEvent?: string
      bucket?: "day" | "week"
      periods?: number
    },
  ): Promise<CohortRow[]> {
    const bucket = f.bucket ?? "week"
    const size = BUCKETS[bucket]
    const periods = f.periods ?? 8
    if (bucket !== "day" && bucket !== "week") throw bad("bucket must be day or week.")
    if (!Number.isInteger(periods) || periods < 1 || periods > 52)
      throw bad("periods must be 1 to 52.")
    if (typeof f.startEvent !== "string" || !f.startEvent) throw bad("startEvent is required.")
    const shift = bucketShift(bucket, 0)
    const [from, to] = range(f)
    const firsts: Array<{ p: string; first: unknown }> = await o
      .select({ p: person, first: sql`min(${C.ts})` })
      .from(T)
      .where(and(eq(C.name, f.startEvent), gte(C.ts, from), lt(C.ts, to), isNotNull(person)))
      .groupBy(person)
    const joined = new Map(firsts.map((r) => [r.p, num(r.first)]))
    // ponytail: loads return events per person in memory; fine for app-sized data.
    const returns: Array<{ p: string; ts: unknown }> = await o
      .select({ p: person, ts: C.ts })
      .from(T)
      .where(
        and(
          f.returnEvent ? eq(C.name, f.returnEvent) : undefined,
          gte(C.ts, from),
          lt(C.ts, bucketStart(to, size, shift) + size * (periods + 1)),
          isNotNull(person),
        ),
      )
    const active = new Map<string, Set<number>>()
    for (const r of returns) {
      const first = joined.get(r.p)
      const ts = num(r.ts)
      if (first === undefined || ts < first) continue
      const k = (bucketStart(ts, size, shift) - bucketStart(first, size, shift)) / size
      if (k < periods) (active.get(r.p) ?? active.set(r.p, new Set()).get(r.p))?.add(k)
    }
    const cohorts = new Map<number, CohortRow>()
    for (const [p, first] of joined) {
      const start = bucketStart(first, size, shift)
      const row = cohorts.get(start) ?? { cohort: start, size: 0, returned: Array(periods).fill(0) }
      row.size++
      for (const k of active.get(p) ?? []) row.returned[k]++
      cohorts.set(start, row)
    }
    return [...cohorts.values()].sort((a, b) => a.cohort - b.cohort)
  }

  /** This period against the one before it, both ending now (or at `to`). */
  async function trend(
    f: Omit<Filter, "from"> & { period?: Period; unique?: boolean },
  ): Promise<TrendResult> {
    const p = f.period ?? "week"
    const size = p === "day" ? DAY : p === "week" ? WEEK : p === "month" ? 30 * DAY : p
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0)
      throw bad("period must be day, week, month or a positive number of ms.")
    const end = f.to === undefined ? now().getTime() : ms(f.to)
    const measure = (from: number, to: number) =>
      f.unique ? uniques({ ...f, from, to }) : count_({ ...f, from, to })
    const current = await measure(end - size, end)
    const previous = await measure(end - 2 * size, end - size)
    return { current, previous, change: previous ? (current - previous) / previous : null }
  }

  /** Event names in a range with their counts, most frequent first. */
  async function events(r: Range = {}): Promise<Array<{ name: string; count: number }>> {
    const [from, to] = range(r)
    const rows: Array<{ name: string; n: unknown }> = await o
      .select({ name: C.name, n: count() })
      .from(T)
      .where(and(gte(C.ts, from), lt(C.ts, to)))
      .groupBy(C.name)
      .orderBy(desc(count()))
      .limit(200)
    return rows.map((r) => ({ name: r.name, count: num(r.n) }))
  }

  /** Delete events older than `retentionDays`. Run it from a daily cron. */
  async function prune(): Promise<number> {
    if (retentionDays === null) return 0
    const cutoff = now().getTime() - retentionDays * DAY
    const gone = await o.delete(T).where(lt(C.ts, cutoff)).returning({ id: C.id })
    return gone.length
  }

  return {
    table: T,
    write,
    identify,
    count: count_,
    uniques,
    series,
    breakdown,
    funnel,
    retention,
    trend,
    events,
    prune,
  }
}

export type AnalyticsStore = ReturnType<typeof createAnalyticsStore>
