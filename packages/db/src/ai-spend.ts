/**
 * AI spend caps: per user, per org and global, per UTC day and month, in cost
 * units (1 unit = one millionth of a US dollar, so spend stays an integer).
 *
 * ```ts
 * import { createAiSpend, spendKey } from "@dapplelight/signet-db/ai-spend"
 * const spend = createAiSpend(db, {
 *   tables: { usageCounters, aiSpendCaps },
 *   caps: { user: { day: 200_000 }, global: { month: 50_000_000 } }, // $0.20/user/day, $50/month
 * })
 * const extractor = createExtractor({ providers, ledger: spend.ledger })
 * await extractor.extract({ ...args, budget: { key: spendKey({ userId, orgId }) } })
 * ```
 *
 * Spend is counted in the `usageCounters` table from `entitlementTables()`
 * (key `ai.spend`); caps set by an admin live in `aiSpendCaps()` and win over
 * the `caps` passed here. A user or org with its own row uses it; otherwise
 * the `*` row for that scope; otherwise the option; otherwise no cap.
 *
 * Fails closed like signet-ai's ledger: a database error refuses the call.
 * Calls in flight are not reserved, so concurrent calls can overshoot a cap by
 * their own cost.
 */

import { and, eq, getTableColumns, inArray, like, sql, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { periodOf } from "./entitlements.js"
import { SignetDbError } from "./errors.js"

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: table columns are known by name
type Cols = Record<string, any>

export type SpendScope = "user" | "org" | "global"
export type SpendPeriod = "day" | "month"
export type SpendSubject = { userId?: string | null; orgId?: string | null }
/** Caps in cost units, e.g. `{ user: { day: 200_000 }, global: { month: 50_000_000 } }`. */
export type SpendCaps = Partial<Record<SpendScope, Partial<Record<SpendPeriod, number>>>>

export const SPEND_KEY = "ai.spend"
export const UNITS_PER_USD = 1_000_000
const SCOPES = new Set<string>(["user", "org", "global"])
const PERIODS: SpendPeriod[] = ["day", "month"]

/** USD to cost units, rounded up so no spend is lost. */
export const usdToUnits = (usd: number): number =>
  usd > 0 ? Math.ceil(Math.round(usd * UNITS_PER_USD * 1000) / 1000) : 0

/** The `budget.key` for signet-ai that charges a user and their org. */
export const spendKey = (s: SpendSubject): string => JSON.stringify([s.userId ?? "", s.orgId ?? ""])

/** Reads `spendKey`'s output; any other string is taken as a user id. */
export function parseSpendKey(key: string | undefined): SpendSubject {
  if (!key) return {}
  try {
    const v = JSON.parse(key)
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "string"))
      return { ...(v[0] ? { userId: v[0] } : {}), ...(v[1] ? { orgId: v[1] } : {}) }
  } catch {}
  return { userId: key }
}

export type SpendRefusal = {
  ok: false
  scope: SpendScope
  /** The user or org id; "*" for global. */
  subject: string
  period: SpendPeriod
  capUnits: number
  usedUnits: number
  /** When the period rolls over and spend is allowed again. */
  resetsAt: Date
}
export type SpendCheck = { ok: true } | SpendRefusal

export type PeriodUsage = {
  used: number
  /** Null is unlimited. */
  cap: number | null
  remaining: number | null
  resetsAt: Date
}
export type SubjectUsage = {
  scope: SpendScope
  subject: string
  day: PeriodUsage
  month: PeriodUsage
}

export type SpendCapRow = {
  id: string
  scope: SpendScope
  subject: string
  period: SpendPeriod
  units: number | null
  updatedBy: string | null
  updatedAt: Date
}

export type AiSpendOptions = {
  tables: { usageCounters: Table; aiSpendCaps: Table }
  /** Caps used when no row in `aiSpendCaps` applies. Default: none. */
  caps?: SpendCaps
  now?: () => Date
}

/** Start of the next UTC day or month. */
export function periodEnd(period: SpendPeriod, at: Date): Date {
  const y = at.getUTCFullYear()
  const m = at.getUTCMonth()
  return period === "day"
    ? new Date(Date.UTC(y, m, at.getUTCDate() + 1))
    : new Date(Date.UTC(y, m + 1, 1))
}

const counterOf = (scope: SpendScope, id: string) =>
  scope === "global" ? "global" : `${scope}:${id}`

export function createAiSpend(db: SignetDb<unknown>, options: AiSpendOptions) {
  const o = db.orm as AnyOrm
  const U = options.tables.usageCounters
  const C = options.tables.aiSpendCaps
  const uc = getTableColumns(U) as Cols
  const cc = getTableColumns(C) as Cols
  const now = options.now ?? (() => new Date())

  const targets = (s: SpendSubject): Array<[SpendScope, string]> => [
    ["global", "*"],
    ...(s.userId ? [["user", s.userId] as [SpendScope, string]] : []),
    ...(s.orgId ? [["org", s.orgId] as [SpendScope, string]] : []),
  ]

  /** Caps for these targets: `${scope}:${id}:${period}` to units (Infinity: none). */
  async function capsFor(list: Array<[SpendScope, string]>) {
    const ids = list.flatMap(([scope, id]) =>
      PERIODS.flatMap((p) => [`${scope}:${id}:${p}`, `${scope}:*:${p}`]),
    )
    const rows: Cols[] = await o
      .select()
      .from(C)
      .where(inArray(cc.id, [...new Set(ids)]))
    const byId = new Map(rows.map((r) => [r.id as string, r.units as number | null]))
    const out = new Map<string, number>()
    for (const [scope, id] of list)
      for (const p of PERIODS) {
        const own = byId.get(`${scope}:${id}:${p}`)
        const all = byId.get(`${scope}:*:${p}`)
        const v =
          own !== undefined ? own : all !== undefined ? all : (options.caps?.[scope]?.[p] ?? null)
        out.set(`${scope}:${id}:${p}`, v === null ? Number.POSITIVE_INFINITY : Number(v))
      }
    return out
  }

  /** Used units for these targets this day and month: `${counter}|${period}` to units. */
  async function usedFor(list: Array<[SpendScope, string]>, at: Date) {
    const day = periodOf("day", at)
    const month = periodOf("month", at)
    const rows: Cols[] = await o
      .select()
      .from(U)
      .where(
        and(
          eq(uc.key, SPEND_KEY),
          inArray(
            uc.subject,
            list.map(([s, id]) => counterOf(s, id)),
          ),
          inArray(uc.period, [day, month]),
        ),
      )
    const m = new Map(rows.map((r) => [`${r.subject}|${r.period}`, Number(r.used)]))
    return (scope: SpendScope, id: string, p: SpendPeriod) =>
      m.get(`${counterOf(scope, id)}|${p === "day" ? day : month}`) ?? 0
  }

  /**
   * Whether `subject` may spend `estimateUnits` more now. Refused once a cap is
   * reached, even with no estimate, so the call after the cap is refused.
   */
  async function check(subject: SpendSubject, estimateUnits = 0, at = now()): Promise<SpendCheck> {
    const list = targets(subject)
    const [caps, used] = await Promise.all([capsFor(list), usedFor(list, at)])
    for (const [scope, id] of list)
      for (const period of PERIODS) {
        const cap = caps.get(`${scope}:${id}:${period}`) ?? Number.POSITIVE_INFINITY
        const u = used(scope, id, period)
        if (Number.isFinite(cap) && (u >= cap || u + estimateUnits > cap))
          return {
            ok: false,
            scope,
            subject: id,
            period,
            capUnits: cap,
            usedUnits: u,
            resetsAt: periodEnd(period, at),
          }
      }
    return { ok: true }
  }

  /** Add spend to the subject's user, org and global counters for this day and month. */
  async function record(subject: SpendSubject, units: number, at = now()): Promise<void> {
    if (!Number.isFinite(units) || units <= 0) return
    const n = Math.ceil(units)
    const rows = targets(subject).flatMap(([scope, id]) =>
      PERIODS.map((p) => ({
        subject: counterOf(scope, id),
        key: SPEND_KEY,
        period: periodOf(p, at),
        used: n,
      })),
    )
    await o
      .insert(U)
      .values(rows)
      .onConflictDoUpdate({
        target: [uc.subject, uc.key, uc.period],
        set: { used: sql`${uc.used} + ${n}` },
      })
  }

  /** Spend and caps for one user, one org, or global (`id` "*"), this day and month. */
  async function usage(scope: SpendScope, id = "*", at = now()): Promise<SubjectUsage> {
    if (!SCOPES.has(scope)) throw new SignetDbError("BAD_VALUE", "scope is user, org or global.")
    const key = scope === "global" ? "*" : id
    const list: Array<[SpendScope, string]> = [[scope, key]]
    const [caps, used] = await Promise.all([capsFor(list), usedFor(list, at)])
    const one = (p: SpendPeriod): PeriodUsage => {
      const cap = caps.get(`${scope}:${key}:${p}`) ?? Number.POSITIVE_INFINITY
      const u = used(scope, key, p)
      const finite = Number.isFinite(cap)
      return {
        used: u,
        cap: finite ? cap : null,
        remaining: finite ? Math.max(0, cap - u) : null,
        resetsAt: periodEnd(p, at),
      }
    }
    return { scope, subject: key, day: one("day"), month: one("month") }
  }

  /** The biggest spenders of a scope this period, most first. */
  async function top(
    scope: "user" | "org",
    period: SpendPeriod = "month",
    limit = 20,
    at = now(),
  ): Promise<Array<{ subject: string; used: number; cap: number | null }>> {
    if (scope !== "user" && scope !== "org")
      throw new SignetDbError("BAD_VALUE", "top takes user or org.")
    const rows: Cols[] = await o
      .select()
      .from(U)
      .where(
        and(
          eq(uc.key, SPEND_KEY),
          eq(uc.period, periodOf(period, at)),
          like(uc.subject, `${scope}:%`),
        ),
      )
      .orderBy(sql`${uc.used} desc`)
      .limit(Math.min(Math.max(1, Math.floor(limit)), 200))
    const list = rows.map(
      (r) => [scope, String(r.subject).slice(scope.length + 1)] as [SpendScope, string],
    )
    const caps = list.length ? await capsFor(list) : new Map<string, number>()
    return rows.map((r, i) => {
      const id = (list[i] as [SpendScope, string])[1]
      const cap = caps.get(`${scope}:${id}:${period}`) ?? Number.POSITIVE_INFINITY
      return { subject: id, used: Number(r.used), cap: Number.isFinite(cap) ? cap : null }
    })
  }

  const validate = (scope: string, subject: string, period: string) => {
    if (!SCOPES.has(scope)) throw new SignetDbError("BAD_VALUE", "scope is user, org or global.")
    if (period !== "day" && period !== "month")
      throw new SignetDbError("BAD_VALUE", "period is day or month.")
    if (scope === "global" && subject !== "*")
      throw new SignetDbError("BAD_VALUE", 'A global cap has subject "*".')
    if (!subject || subject.length > 200)
      throw new SignetDbError("BAD_VALUE", 'subject is a user or org id, or "*" for every one.')
    return `${scope}:${subject}:${period}`
  }

  /** Every stored cap. */
  async function caps(): Promise<SpendCapRow[]> {
    return (await o.select().from(C).orderBy(cc.id)) as SpendCapRow[]
  }

  /** Store a cap; `units: null` stores "unlimited", which beats a `*` row or an option. */
  async function setCap(
    input: { scope: SpendScope; subject?: string; period: SpendPeriod; units: number | null },
    opts: { actor?: { id: string } } = {},
  ): Promise<SpendCapRow> {
    const subject = input.subject ?? "*"
    const id = validate(input.scope, subject, input.period)
    if (input.units !== null && !(Number.isSafeInteger(input.units) && input.units >= 0))
      throw new SignetDbError(
        "BAD_VALUE",
        "units is a whole number of cost units, 0 or more, or null.",
      )
    const values = {
      id,
      scope: input.scope,
      subject,
      period: input.period,
      units: input.units,
      updatedBy: opts.actor?.id ?? null,
      updatedAt: now(),
    }
    await o
      .insert(C)
      .values(values)
      .onConflictDoUpdate({
        target: cc.id,
        set: { units: values.units, updatedBy: values.updatedBy, updatedAt: values.updatedAt },
      })
    const [row] = await o.select().from(C).where(eq(cc.id, id))
    return row as SpendCapRow
  }

  /** Remove a stored cap, so the `*` row or the option applies again. True when one was removed. */
  async function removeCap(scope: SpendScope, subject: string, period: SpendPeriod) {
    const id = validate(scope, subject, period)
    const rows = await o.delete(C).where(eq(cc.id, id)).returning({ id: cc.id })
    return rows.length > 0
  }

  const globalDayCap = options.caps?.global?.day
  /**
   * A `ledger` for signet-ai's `createExtractor`: checks the caps before a call
   * and records its cost after. Charge a call with `budget: { key: spendKey(...) }`;
   * a plain string key is a user id.
   */
  const ledger = {
    /** The global daily cap from `caps`, in USD (Infinity without one). For display only. */
    windowUsd: globalDayCap === undefined ? Number.POSITIVE_INFINITY : globalDayCap / UNITS_PER_USD,
    async spentUsd(at = Date.now(), key?: string): Promise<number> {
      const s = parseSpendKey(key)
      const u = await usage(s.userId ? "user" : "global", s.userId ?? "*", new Date(at))
      return u.day.used / UNITS_PER_USD
    },
    async remainingUsd(at = Date.now()): Promise<number> {
      const u = await usage("global", "*", new Date(at))
      return u.day.remaining === null ? Number.POSITIVE_INFINITY : u.day.remaining / UNITS_PER_USD
    },
    async canSpend(estimateUsd: number, at = Date.now(), key?: string): Promise<boolean> {
      return (await check(parseSpendKey(key), usdToUnits(estimateUsd), new Date(at))).ok
    },
    async record(usd: number, at = Date.now(), key?: string): Promise<void> {
      await record(parseSpendKey(key), usdToUnits(usd), new Date(at))
    },
  }

  /**
   * An `onUsage` for signet-ai's `streamChat`, `chat` and `ground`, which have
   * no ledger: records each report's cost under its `key`. Check first with
   * `check` (or `requireAiSpend` in signet-server). Do not also pass it to an
   * extractor that has `ledger`, or spend counts twice.
   */
  const onUsage = (report: { costUsd: number; key?: string }): Promise<void> =>
    record(parseSpendKey(report.key), usdToUnits(report.costUsd)).catch(() => {})

  return { check, record, usage, top, caps, setCap, removeCap, ledger, onUsage }
}

export type AiSpend = ReturnType<typeof createAiSpend>
