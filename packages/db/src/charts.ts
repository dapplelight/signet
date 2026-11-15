/**
 * Subscription charts from the customer timeline (`customerEvents`, written by
 * `customers.record` and `customers.logImpression`): MRR, active subscribers
 * and trials, trial conversion, churn, refunds, new versus renewal revenue and
 * paywall conversion, per UTC day, with filters by store, plan, country and
 * offering, saved filters ("audiences") and CSV.
 *
 * ```ts
 * const charts = createCharts(db, { tables: { customerEvents, chartAudiences, offerings } })
 * const r = await charts.metrics({ from: "2026-10-01", to: "2026-10-31", store: "appstore" })
 * r.summary.mrr          // { INR: 4990000, USD: 129900 }, minor units per month
 * chartsCsv(r)           // one row per day
 * ```
 *
 * The database does the day bucketing (one GROUP BY on SQLite, D1 and
 * Postgres); the bucketed rows are then replayed per subscription. Money is
 * per currency, in minor units. A total in one currency is given only with
 * `fx` rates for every currency in it. App Store amounts are Apple's list
 * prices, so a result with any of them says `approximate`.
 *
 * How the timeline reads:
 * - a subscription is a gateway's `subscriptionId`; one-time purchases have none
 *   and count as new revenue only;
 * - `trial` starts a trial lasting the product's free-trial offer `days` (else
 *   `trialDays`); a paid charge within it (or the day after) is a conversion;
 * - the first paid charge is new revenue, later ones renewals; each charge
 *   covers one interval of its product (unknown products: a month), and MRR is
 *   that charge normalised to a month (a year / 12);
 * - a refund or expiration ends coverage that day; coverage that ends with no
 *   renewal is churn on that day;
 * - a start (trial or first charge) is a paywall conversion when the customer
 *   saw an offering within `attributionDays` before it; that offering is the
 *   subscription's offering for the offering filter;
 * - a customer's country is the latest one recorded on their events.
 */

import { and, eq, lt, sql, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import { newId } from "./id.js"
import { minorDigits } from "./money.js"
import type { OfferingProduct } from "./offerings.js"
import { type Actor, audited } from "./scoped.js"

export type ChartFilter = {
  /** "appstore", "googleplay", "web" (every other gateway), or one gateway's name. */
  store?: string
  plan?: string
  /** ISO 3166-1 alpha-2. */
  country?: string
  /** An offering key: subscriptions started from its paywall, and its impressions. */
  offering?: string
}

export type ChartQuery = ChartFilter & {
  /** First day, "YYYY-MM-DD" or a Date (UTC). */
  from: string | Date
  /** Last day, inclusive; a day after today is read as today. */
  to: string | Date
  /** A saved audience's id: its filter, with any filter given here on top. */
  audience?: string
}

/** Minor units per currency. */
export type PerCurrency = Record<string, number>

export type ChartDay = {
  /** "YYYY-MM-DD", UTC. */
  day: string
  activeSubscribers: number
  activeTrials: number
  /** Monthly recurring revenue on this day, per currency. */
  mrr: PerCurrency
  /** MRR in `fx.base`, or null without rates for every currency. */
  mrrTotal: number | null
  newRevenue: PerCurrency
  renewalRevenue: PerCurrency
  refunds: PerCurrency
  refundCount: number
  /** First paid charges. */
  newSubscriptions: number
  trialsStarted: number
  trialConversions: number
  churned: number
  impressions: number
  /** Starts attributed to a paywall impression. */
  conversions: number
}

export type ChartSummary = {
  /** On the last day. */
  mrr: PerCurrency
  mrrTotal: number | null
  activeSubscribers: number
  activeTrials: number
  newRevenue: PerCurrency
  renewalRevenue: PerCurrency
  refunds: PerCurrency
  refundCount: number
  newSubscriptions: number
  trialsStarted: number
  /** Of trials started in the range, the share that converted by its end; null with none. */
  trialConversion: number | null
  churned: number
  /** Churned in the range over subscribers active the day before it; null with none. */
  churnRate: number | null
  impressions: number
  conversions: number
  /** Conversions over impressions; null with no impressions. */
  paywallConversion: number | null
}

export type ChartResult = {
  from: string
  to: string
  filter: ChartFilter
  currencies: string[]
  /** The base currency of the totals, or null without `fx`. */
  base: string | null
  /** Includes App Store prices, not settled revenue. */
  approximate: boolean
  days: ChartDay[]
  summary: ChartSummary
}

export type Audience = { id: string; name: string; filter: ChartFilter; createdBy: string | null }

export type ChartsOptions = {
  tables: { customerEvents: Table; chartAudiences?: Table; offerings?: Table }
  /** Products for plan, interval and trial length. Default: every offering version's. */
  products?: readonly OfferingProduct[]
  /** Exchange rates for totals: `rates[c]` is one unit of `c` in `base` units (major units). */
  fx?: { base: string; rates: Readonly<Record<string, number>> }
  /** A trial's length when its product has no free-trial offer. Default 7. */
  trialDays?: number
  /** How long a paywall impression counts for a start. Default 7. */
  attributionDays?: number
  now?: () => Date
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: columns are known by name
type Cols = Record<string, any>

const DAY = 86_400_000
const MAX_DAYS = 731
const bad = (m: string) => new SignetDbError("BAD_VALUE", m)
const ORDER: Record<string, number> = {
  trial: 1,
  purchase: 2,
  renewal: 3,
  refund: 4,
  expiration: 5,
}
const STORES = new Set(["appstore", "googleplay"])
const storeOf = (gateway: string) => (STORES.has(gateway) ? gateway : "web")
const dayText = (d: number) => new Date(d * DAY).toISOString().slice(0, 10)

function dayOf(v: string | Date, name: string): number {
  const d =
    typeof v === "string" ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : "x") : v
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw bad(`${name} is a date, YYYY-MM-DD.`)
  return Math.floor(d.getTime() / DAY)
}

/** The day `n` intervals after `day` (calendar months in UTC). */
function addInterval(day: number, interval: string | undefined): number {
  const d = new Date(day * DAY)
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return Math.floor(d.getTime() / DAY)
}

const add = (m: PerCurrency, cur: string | null, v: number | null) => {
  if (!cur || v === null || !v) return
  m[cur] = (m[cur] ?? 0) + v
}
const round = (m: PerCurrency) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v)]))

function checkFilter(f: Cols): ChartFilter {
  const out: ChartFilter = {}
  for (const k of ["store", "plan", "country", "offering"] as const) {
    const v = f[k]
    if (v === undefined || v === null || v === "") continue
    if (typeof v !== "string" || v.length > 64)
      throw bad(`${k} is a string of at most 64 characters.`)
    out[k] = k === "country" ? v.toUpperCase() : v
  }
  if (out.country && !/^[A-Z]{2}$/.test(out.country))
    throw bad("country is an ISO 3166-1 alpha-2 code, e.g. IN.")
  return out
}

/** Minor units in `cur` to minor units in `base`, or null without a rate. */
function convert(m: PerCurrency, fx: ChartsOptions["fx"]): number | null {
  if (!fx) return null
  let total = 0
  for (const [cur, v] of Object.entries(m)) {
    if (!v) continue
    const rate = cur === fx.base ? 1 : fx.rates[cur]
    if (typeof rate !== "number" || !Number.isFinite(rate)) return null
    total += (v / 10 ** minorDigits(cur)) * rate * 10 ** minorDigits(fx.base)
  }
  return Math.round(total)
}

type Row = {
  subject: string
  sub: string | null
  gateway: string
  product: string | null
  kind: string
  currency: string | null
  offering: string | null
  country: string | null
  day: number
  amount: number | null
  n: number
}

export function createCharts(db: SignetDb<unknown>, options: ChartsOptions) {
  const E = options.tables.customerEvents
  const ec = E as unknown as Cols
  const A = options.tables.chartAudiences
  const ac = A as unknown as Cols
  const o = db.orm as AnyOrm
  const now = options.now ?? (() => new Date())
  const window = options.attributionDays ?? 7
  const trialDefault = options.trialDays ?? 7

  async function products(): Promise<Map<string, OfferingProduct>> {
    const map = new Map<string, OfferingProduct>()
    let list: readonly OfferingProduct[] = options.products ?? []
    if (!options.products && options.tables.offerings) {
      const oc = options.tables.offerings as unknown as Cols
      const rows = await o.select().from(options.tables.offerings).orderBy(oc.createdAt)
      list = rows.flatMap((r: Cols) => r.products as OfferingProduct[])
    }
    for (const p of list) map.set(`${p.store}:${p.id}`, p) // later versions win
    return map
  }

  /**
   * One GROUP BY per call: events bucketed per subscription, kind and UTC day.
   * ponytail: reads every bucket up to `to` and replays in memory; fine to about
   * a million timeline rows, a daily snapshot table if it outgrows that.
   */
  async function rows(untilDay: number): Promise<Row[]> {
    const day =
      db.dialect === "pg"
        ? sql<number>`cast(floor(extract(epoch from ${ec.occurredAt}) / 86400) as integer)`
        : sql<number>`cast(${ec.occurredAt} / 86400000 as integer)`
    const raw = await o
      .select({
        subject: ec.subject,
        sub: ec.subscriptionId,
        gateway: ec.gateway,
        product: ec.productId,
        kind: ec.kind,
        currency: ec.currency,
        offering: ec.offering,
        day,
        amount: sql`sum(${ec.amount})`,
        n: sql`count(*)`,
        country: sql`max(${ec.country})`,
      })
      .from(E)
      .where(lt(ec.occurredAt, new Date((untilDay + 1) * DAY)))
      .groupBy(
        ec.subject,
        ec.subscriptionId,
        ec.gateway,
        ec.productId,
        ec.kind,
        ec.currency,
        ec.offering,
        day,
      )
    return raw.map((r: Cols) => ({
      ...r,
      day: Number(r.day),
      amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
      n: Number(r.n),
    }))
  }

  async function audienceFilter(id: string): Promise<ChartFilter> {
    if (!A) throw bad("Saved audiences need the chartAudiences table.")
    const [r] = await o.select().from(A).where(eq(ac.id, id)).limit(1)
    if (!r) throw new SignetDbError("NOT_FOUND", `No audience ${id}.`)
    return checkFilter(r.filter as Cols)
  }

  async function metrics(q: ChartQuery): Promise<ChartResult> {
    const fromDay = dayOf(q.from, "from")
    const today = Math.floor(now().getTime() / DAY)
    const toDay = Math.min(dayOf(q.to, "to"), today)
    if (toDay < fromDay) throw bad("from is on or before to (and not after today).")
    if (toDay - fromDay + 1 > MAX_DAYS) throw bad(`At most ${MAX_DAYS} days at a time.`)
    const filter = { ...(q.audience ? await audienceFilter(q.audience) : {}), ...checkFilter(q) }
    const catalogue = await products()
    const all = (await rows(toDay)).sort(
      (a, b) => a.day - b.day || (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9),
    )
    const span = toDay - fromDay + 1
    const days: ChartDay[] = Array.from({ length: span }, (_, i) => ({
      day: dayText(fromDay + i),
      activeSubscribers: 0,
      activeTrials: 0,
      mrr: {},
      mrrTotal: null,
      newRevenue: {},
      renewalRevenue: {},
      refunds: {},
      refundCount: 0,
      newSubscriptions: 0,
      trialsStarted: 0,
      trialConversions: 0,
      churned: 0,
      impressions: 0,
      conversions: 0,
    }))
    const at = (d: number) => (d >= fromDay && d <= toDay ? days[d - fromDay] : undefined)
    const currencies = new Set<string>()
    let approximate = false
    let cohort = 0
    let cohortConverted = 0
    let activeBefore = 0

    // Per customer: latest country, and impressions in day order.
    const country = new Map<string, string>()
    const seen = new Map<string, { day: number; offering: string }[]>()
    for (const r of all) {
      if (r.country) country.set(r.subject, r.country)
      if (r.kind === "impression" && r.offering) {
        const list = seen.get(r.subject) ?? []
        list.push({ day: r.day, offering: r.offering })
        seen.set(r.subject, list)
      }
    }
    const attributed = (subject: string, day: number) => {
      const list = seen.get(subject) ?? []
      for (let i = list.length - 1; i >= 0; i--) {
        const x = list[i] as { day: number; offering: string }
        if (x.day <= day) return day - x.day <= window ? x.offering : null
      }
      return null
    }
    const where = (
      subject: string,
      gateway: string,
      plan: string | undefined,
      offering: string | null,
    ) =>
      (!filter.store || filter.store === storeOf(gateway) || filter.store === gateway) &&
      (!filter.plan || filter.plan === plan) &&
      (!filter.country || filter.country === country.get(subject)) &&
      (!filter.offering || filter.offering === offering)

    for (const r of all) {
      if (r.kind !== "impression") continue
      if (filter.offering && r.offering !== filter.offering) continue
      if (filter.country && (r.country ?? country.get(r.subject)) !== filter.country) continue
      const d = at(r.day)
      if (d) d.impressions += r.n
    }

    // Group the rest per subscription; one-time purchases and their refunds stand alone.
    const subs = new Map<string, Row[]>()
    for (const r of all) {
      if (r.kind === "impression" || r.gateway === "promotional") continue
      if (!r.sub) {
        if (r.kind !== "purchase" && r.kind !== "refund") continue
        const plan = r.product
          ? catalogue.get(`${storeOf(r.gateway)}:${r.product}`)?.plan
          : undefined
        const offering = attributed(r.subject, r.day)
        if (!where(r.subject, r.gateway, plan, offering)) continue
        const d = at(r.day)
        if (!d) continue
        if (r.currency && r.amount) currencies.add(r.currency)
        if (r.gateway === "appstore" && r.amount) approximate = true
        if (r.kind === "purchase") {
          add(d.newRevenue, r.currency, r.amount)
          if (offering) d.conversions += r.n
        } else {
          add(d.refunds, r.currency, r.amount)
          d.refundCount += r.n
        }
        continue
      }
      const key = `${r.gateway}|${r.sub}`
      const list = subs.get(key) ?? []
      list.push(r)
      subs.set(key, list)
    }

    for (const list of subs.values()) {
      const first = list[0] as Row
      const productId = [...list].reverse().find((r) => r.product)?.product
      const info = productId ? catalogue.get(`${storeOf(first.gateway)}:${productId}`) : undefined
      const offering = attributed(first.subject, first.day)
      if (!where(first.subject, first.gateway, info?.plan, offering)) continue
      const trialLen = info?.offers?.find((x) => x.type === "free_trial")?.days ?? trialDefault
      const pieces: { from: number; to: number; mrr: number; cur: string | null; cut?: boolean }[] =
        []
      let trial: { from: number; to: number } | null = null
      let paid = false
      let started = false
      const start = (day: number) => {
        if (started) return
        started = true
        const d = at(day)
        if (d && offering) d.conversions++
      }
      const cut = (day: number) => {
        const last = pieces.at(-1)
        if (last && last.to > day) {
          last.to = Math.max(day, last.from)
          last.cut = true
        }
        if (trial && trial.to > day) trial.to = Math.max(day, trial.from)
      }
      for (const r of list) {
        const d = at(r.day)
        if (r.currency && r.amount) currencies.add(r.currency)
        if (r.gateway === "appstore" && r.amount) approximate = true
        if (r.kind === "trial") {
          if (paid || trial) continue
          trial = { from: r.day, to: r.day + trialLen }
          start(r.day)
          if (d) d.trialsStarted++
          if (r.day >= fromDay && r.day <= toDay) cohort++
        } else if (r.kind === "purchase" || r.kind === "renewal") {
          if (!paid) {
            paid = true
            if (d) {
              add(d.newRevenue, r.currency, r.amount)
              d.newSubscriptions++
            }
            if (trial && r.day <= trial.to + 1) {
              trial.to = Math.min(trial.to, r.day)
              if (d) d.trialConversions++
              if (trial.from >= fromDay && trial.from <= toDay) cohortConverted++
            }
            start(r.day)
          } else if (d) add(d.renewalRevenue, r.currency, r.amount)
          // No amount on the event (Google Play): the product's display price, for MRR only.
          const amount = r.amount ?? info?.price?.amount ?? null
          const cur = r.amount !== null ? r.currency : (info?.price?.currency ?? null)
          const mrr = amount === null ? 0 : info?.interval === "year" ? amount / 12 : amount
          const end = addInterval(r.day, info?.interval)
          const last = pieces.at(-1)
          if (last && r.day <= last.to) {
            const to = Math.max(last.to, end)
            last.to = r.day
            pieces.push({ from: r.day, to, mrr, cur })
          } else pieces.push({ from: r.day, to: end, mrr, cur })
          if (last && last.to <= last.from) pieces.splice(pieces.indexOf(last), 1)
        } else if (r.kind === "refund") {
          if (d) {
            add(d.refunds, r.currency, r.amount)
            d.refundCount += r.n
          }
          cut(r.day)
        } else if (r.kind === "expiration") cut(r.day)
      }
      for (const [i, p] of pieces.entries()) {
        const next = pieces[i + 1]
        const ends = !next || next.from > p.to
        // A paid period that runs out today may still renew (webhook not landed, store a day late):
        // keep it active through today and count churn only once the end is in the past.
        // An explicit refund or expiration (cut) ends it at once.
        const pending = ends && !p.cut && p.to === today
        for (
          let day = Math.max(p.from, fromDay);
          day < Math.min(pending ? p.to + 1 : p.to, toDay + 1);
          day++
        ) {
          const d = days[day - fromDay] as ChartDay
          d.activeSubscribers++
          add(d.mrr, p.cur, p.mrr)
        }
        if (p.from <= fromDay - 1 && fromDay - 1 < (pending ? p.to + 1 : p.to)) activeBefore++
        if (ends && (p.cut || p.to < today)) {
          const d = at(p.to)
          if (d && p.to > p.from) d.churned++
        }
      }
      if (trial)
        for (let day = Math.max(trial.from, fromDay); day < Math.min(trial.to, toDay + 1); day++)
          (days[day - fromDay] as ChartDay).activeTrials++
    }

    for (const d of days) {
      d.mrr = round(d.mrr)
      d.newRevenue = round(d.newRevenue)
      d.renewalRevenue = round(d.renewalRevenue)
      d.refunds = round(d.refunds)
      d.mrrTotal = convert(d.mrr, options.fx)
    }
    const sum = (k: "newRevenue" | "renewalRevenue" | "refunds") => {
      const m: PerCurrency = {}
      for (const d of days) for (const [c, v] of Object.entries(d[k])) add(m, c, v)
      return m
    }
    const count = (k: keyof ChartDay) => days.reduce((n, d) => n + (d[k] as number), 0)
    const last = days.at(-1) as ChartDay
    const churned = count("churned")
    const impressions = count("impressions")
    const conversions = count("conversions")
    return {
      from: dayText(fromDay),
      to: dayText(toDay),
      filter,
      currencies: [...currencies].sort(),
      base: options.fx?.base ?? null,
      approximate,
      days,
      summary: {
        mrr: last.mrr,
        mrrTotal: last.mrrTotal,
        activeSubscribers: last.activeSubscribers,
        activeTrials: last.activeTrials,
        newRevenue: sum("newRevenue"),
        renewalRevenue: sum("renewalRevenue"),
        refunds: sum("refunds"),
        refundCount: count("refundCount"),
        newSubscriptions: count("newSubscriptions"),
        trialsStarted: count("trialsStarted"),
        trialConversion: cohort ? cohortConverted / cohort : null,
        churned,
        churnRate: activeBefore ? churned / activeBefore : null,
        impressions,
        conversions,
        paywallConversion: impressions ? conversions / impressions : null,
      },
    }
  }

  // --------------------------------------------------------------- audiences

  const table = () => {
    if (!A) throw bad("Saved audiences need the chartAudiences table.")
    return A
  }
  const view = (r: Cols): Audience => ({
    id: r.id,
    name: r.name,
    filter: r.filter as ChartFilter,
    createdBy: r.createdBy ?? null,
  })

  async function saveAudience(
    name: string,
    filter: ChartFilter,
    { actor }: { actor: Actor },
  ): Promise<Audience> {
    if (typeof name !== "string" || !name.trim() || name.length > 100)
      throw bad("name is required, at most 100 characters.")
    const f = checkFilter((filter ?? {}) as Cols)
    if (!Object.keys(f).length) throw bad("An audience needs at least one filter.")
    const id = newId(now().getTime())
    await audited(db, { actor }).insert(table(), {
      id,
      name: name.trim(),
      filter: f,
      createdBy: actor.id,
    } as never)
    return { id, name: name.trim(), filter: f, createdBy: actor.id }
  }

  async function audiences(): Promise<Audience[]> {
    return (await o.select().from(table()).orderBy(ac.name)).map(view)
  }

  async function removeAudience(id: string, { actor }: { actor: Actor }): Promise<boolean> {
    return (await audited(db, { actor }).delete(table(), and(eq(ac.id, id)))).length > 0
  }

  /** `metrics` as CSV (`chartsCsv`). */
  const csv = async (q: ChartQuery) => chartsCsv(await metrics(q))

  return { metrics, csv, saveAudience, audiences, removeAudience }
}

export type Charts = ReturnType<typeof createCharts>

/** Major units in plain digits, for CSV: 49900 INR is "499.00". */
const major = (v: number, cur: string) => {
  const d = minorDigits(cur)
  return (v / 10 ** d).toFixed(d)
}

/**
 * One row per day: counts, then money per currency in major units
 * (`mrr_INR`, `new_revenue_INR`, ...), then the MRR total when there is one.
 */
export function chartsCsv(r: ChartResult): string {
  const money = [
    ["mrr", "mrr"],
    ["new_revenue", "newRevenue"],
    ["renewal_revenue", "renewalRevenue"],
    ["refunds", "refunds"],
  ] as const
  const counts = [
    ["active_subscribers", "activeSubscribers"],
    ["active_trials", "activeTrials"],
    ["new_subscriptions", "newSubscriptions"],
    ["trials_started", "trialsStarted"],
    ["trial_conversions", "trialConversions"],
    ["churned", "churned"],
    ["refund_count", "refundCount"],
    ["impressions", "impressions"],
    ["conversions", "conversions"],
  ] as const
  const head = [
    "day",
    ...counts.map(([h]) => h),
    ...money.flatMap(([h]) => r.currencies.map((c) => `${h}_${c}`)),
    ...(r.base ? [`mrr_total_${r.base}`] : []),
  ]
  const lines = r.days.map((d) =>
    [
      d.day,
      ...counts.map(([, k]) => String(d[k])),
      ...money.flatMap(([, k]) => r.currencies.map((c) => major(d[k][c] ?? 0, c))),
      ...(r.base ? [d.mrrTotal === null ? "" : major(d.mrrTotal, r.base)] : []),
    ].join(","),
  )
  return `${[head.join(","), ...lines].join("\n")}\n`
}
