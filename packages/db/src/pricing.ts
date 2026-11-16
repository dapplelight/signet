/**
 * Pricing experiments: a placement (`createOfferings`) runs an experiment
 * (`createExperiments`) whose variants serve different offerings, and this
 * module reads out which one earns more and rolls the winner out.
 *
 * ```ts
 * const ex = createExperiments(db, { tables: experimentTables(), events })
 * const offerings = createOfferings(db, { tables, plans, experiments: ex })
 * await ex.create("annual-first", {
 *   variants: [{ key: "control", weight: 50 }, { key: "annual", weight: 50, value: { offering: "annual-first" } }],
 *   goal: "subscribed",
 * }, { actor })
 * await offerings.setPlacement("onboarding", { offering: "default", experiment: "annual-first" }, { actor })
 * await ex.start("annual-first", { actor })
 * await offerings.current("onboarding", audience, subjectId)   // sticky variant, exposure recorded
 *
 * const pricing = createPricing(db, { offerings, experiments: ex, tables })
 * await pricing.readout("annual-first")          // conversion, revenue per exposed user, trials, LTV estimate
 * await pricing.rollout("annual-first", "annual", { actor })   // placement serves it; experiment stops
 * ```
 *
 * Attribution needs no extra writes: a subject's purchases are the customer
 * timeline's events (`customers.record`) for that subject at or after their
 * exposure, followed through identity merges when `customerIdentities` is passed.
 */

import { and, eq, inArray, isNotNull, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import {
  type Experiment,
  type ExperimentStatus,
  type Experiments,
  twoProportionTest,
  type Variant,
} from "./experiments.js"
import {
  type Offerings,
  type Placement,
  type PricingVariantValue,
  variantOffering,
} from "./offerings.js"
import type { Actor } from "./scoped.js"

export type PerCurrency = Record<string, number>

/** One exposure: who saw which variant, when (epoch ms). */
export type PricingExposure = { subject: string; variant: string; exposedAt: number }

/** One customer timeline event, as the readout reads it. */
export type PricingEvent = {
  subject: string
  kind: string
  amount: number | null
  currency: string | null
  occurredAt: Date | number
  subscriptionId?: string | null
  approximate?: boolean
}

export type PricingVariantReadout = {
  key: string
  /** The offering this variant serves; null is the placement's own. */
  offering: PricingVariantValue | null
  exposed: number
  /** Exposed subjects who started a trial or bought after their exposure. */
  converted: number
  /** converted / exposed; 0 with nobody exposed. */
  rate: number
  /** (rate − control rate) / control rate; null for the control or a control rate of 0. */
  lift: number | null
  /** Two-sided two-proportion z-test against the control. */
  pValue: number | null
  significant: boolean
  /** Exposed subjects who started a free trial. */
  trials: number
  /** Of those, who paid after the trial. */
  trialConverted: number
  /** trialConverted / trials; null with no trials. */
  trialConversion: number | null
  /** Charges minus refunds after exposure, per currency, minor units. */
  revenue: PerCurrency
  /** revenue / exposed, per currency, minor units (fractional). */
  revenuePerExposed: PerCurrency
  /** Some revenue is App Store list prices, not settled money. */
  approximate: boolean
  /**
   * An estimate, not a measurement: the average charge × the expected number
   * of payments (1 / observed churn per charge, capped). Null with no charges.
   */
  ltv: {
    estimate: true
    perCurrency: PerCurrency
    /** Subscriptions that ended (expired or refunded) per paid charge. */
    churn: number
    expectedPayments: number
  } | null
}

export type PricingReadout = {
  experiment: string
  status: ExperimentStatus
  winner: string | null
  /** Placements running this experiment now. */
  placements: string[]
  alpha: number
  control: string
  variants: PricingVariantReadout[]
}

export type PricingTables = {
  experimentExposures: Table
  customerEvents: Table
  /** Follow exposures under an anonymous id to the account it merged into. */
  customerIdentities?: Table
}

export type PricingOptions = {
  tables: PricingTables
  offerings: Pick<Offerings, "placements" | "setPlacement">
  experiments: Pick<Experiments, "get" | "rollout">
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: columns are known by name
type Cols = Record<string, any>

const STARTS = new Set(["trial", "purchase"])
const CHARGES = new Set(["purchase", "renewal"])
const KINDS = ["trial", "purchase", "renewal", "refund", "expiration"]
const CHUNK = 500

const add = (m: PerCurrency, c: string, n: number) => {
  m[c] = (m[c] ?? 0) + n
}
const ms = (d: Date | number) => (typeof d === "number" ? d : d.getTime())

/**
 * The readout as a pure function of the variants, exposures and timeline
 * events (any order; events before a subject's exposure are ignored).
 * `maxPayments` caps the LTV estimate's expected payments (default 24).
 */
export function pricingReadout(
  variants: readonly Variant[],
  exposures: readonly PricingExposure[],
  events: readonly PricingEvent[],
  opts: { alpha?: number; maxPayments?: number } = {},
): Pick<PricingReadout, "alpha" | "control" | "variants"> {
  const alpha = opts.alpha ?? 0.05
  const cap = opts.maxPayments ?? 24
  const bySubject = new Map<string, PricingEvent[]>()
  for (const e of events) {
    const list = bySubject.get(e.subject) ?? []
    list.push(e)
    bySubject.set(e.subject, list)
  }
  const acc = new Map(
    variants.map((v) => [
      v.key,
      {
        exposed: 0,
        converted: 0,
        trials: 0,
        trialConverted: 0,
        revenue: {} as PerCurrency,
        chargeSum: {} as PerCurrency,
        chargeCount: {} as PerCurrency,
        charges: 0,
        ended: 0,
        approximate: false,
      },
    ]),
  )
  for (const x of exposures) {
    const a = acc.get(x.variant)
    if (!a) continue
    a.exposed++
    const mine = (bySubject.get(x.subject) ?? [])
      .filter((e) => ms(e.occurredAt) >= x.exposedAt)
      .sort((p, q) => ms(p.occurredAt) - ms(q.occurredAt))
    if (mine.some((e) => STARTS.has(e.kind))) a.converted++
    const trial = mine.find((e) => e.kind === "trial")
    if (trial) {
      a.trials++
      const t = ms(trial.occurredAt)
      if (mine.some((e) => CHARGES.has(e.kind) && (e.amount ?? 0) > 0 && ms(e.occurredAt) >= t))
        a.trialConverted++
    }
    const ended = new Set<string>()
    for (const e of mine) {
      if (!e.currency || e.amount == null) {
        if (e.kind === "expiration" && e.subscriptionId) ended.add(e.subscriptionId)
        continue
      }
      if (CHARGES.has(e.kind) && e.amount > 0) {
        add(a.revenue, e.currency, e.amount)
        add(a.chargeSum, e.currency, e.amount)
        add(a.chargeCount, e.currency, 1)
        a.charges++
        if (e.approximate) a.approximate = true
      } else if (e.kind === "refund") {
        add(a.revenue, e.currency, -Math.abs(e.amount))
        if (e.subscriptionId) ended.add(e.subscriptionId)
      } else if (e.kind === "expiration" && e.subscriptionId) ended.add(e.subscriptionId)
    }
    a.ended += ended.size
  }
  const rows = variants.map((v) => {
    const a = acc.get(v.key) as NonNullable<ReturnType<typeof acc.get>>
    const churn = a.charges ? Math.min(1, a.ended / a.charges) : 0
    // ponytail: one churn rate for every interval and currency in the variant;
    // split by product interval if monthly and yearly plans are mixed.
    const expectedPayments = churn > 0 ? Math.min(cap, 1 / churn) : cap
    const per = (m: PerCurrency, by: (c: string) => number) =>
      Object.fromEntries(Object.entries(m).map(([c, n]) => [c, n / by(c)]))
    return {
      key: v.key,
      offering: variantOffering(v.value),
      exposed: a.exposed,
      converted: a.converted,
      rate: a.exposed ? a.converted / a.exposed : 0,
      trials: a.trials,
      trialConverted: a.trialConverted,
      trialConversion: a.trials ? a.trialConverted / a.trials : null,
      revenue: a.revenue,
      revenuePerExposed: a.exposed ? per(a.revenue, () => a.exposed) : {},
      approximate: a.approximate,
      ltv: a.charges
        ? {
            estimate: true as const,
            perCurrency: per(a.chargeSum, (c) => (a.chargeCount[c] as number) / expectedPayments),
            churn,
            expectedPayments,
          }
        : null,
    }
  })
  const control = rows[0] as (typeof rows)[number]
  return {
    alpha,
    control: control.key,
    variants: rows.map((r, i) => {
      if (i === 0) return { ...r, lift: null, pValue: null, significant: false }
      const pValue = twoProportionTest(control.converted, control.exposed, r.converted, r.exposed)
      return {
        ...r,
        lift: control.rate ? (r.rate - control.rate) / control.rate : null,
        pValue,
        significant: pValue !== null && pValue < alpha,
      }
    }),
  }
}

export function createPricing(db: SignetDb<unknown>, options: PricingOptions) {
  const { experimentExposures: X, customerEvents: E, customerIdentities: I } = options.tables
  const xc = X as unknown as Cols
  const ec = E as unknown as Cols
  const ic = I as unknown as Cols | undefined
  const o = db.orm as AnyOrm

  const must = async (key: string): Promise<Experiment> => {
    const e = await options.experiments.get(key)
    if (!e) throw new SignetDbError("NOT_FOUND", `No experiment "${key}".`)
    return e
  }
  const linked = async (key: string): Promise<Placement[]> =>
    (await options.offerings.placements()).filter((p) => p.experiment === key)

  /**
   * Per variant: exposures, conversion (a trial or purchase after exposure)
   * with a z-test against the control, trial conversion, revenue per exposed
   * user from the customer timeline, and an LTV estimate.
   */
  async function readout(
    key: string,
    opts: { alpha?: number; maxPayments?: number } = {},
  ): Promise<PricingReadout> {
    const e = await must(key)
    // ponytail: loads every exposure and its subjects' events into memory;
    // fine to ~100k exposed subjects, aggregate in SQL beyond that.
    const exposures: PricingExposure[] = (
      await o
        .select({ subject: xc.subject, variant: xc.variant, exposedAt: xc.exposedAt })
        .from(X)
        .where(eq(xc.experiment, key))
    ).map((r: Cols) => ({ ...r, exposedAt: Number(r.exposedAt) }))
    const subjects = [...new Set(exposures.map((x) => x.subject))]
    const merged = new Map<string, string>()
    const events: PricingEvent[] = []
    for (let i = 0; i < subjects.length; i += CHUNK) {
      const chunk = subjects.slice(i, i + CHUNK)
      if (I && ic)
        for (const r of await o
          .select({ id: ic.id, subject: ic.subject })
          .from(I)
          .where(and(inArray(ic.id, chunk), isNotNull(ic.subject))))
          merged.set(r.id, r.subject)
      const ids = [...new Set([...chunk, ...chunk.map((s) => merged.get(s) ?? s)])]
      for (const r of await o
        .select({
          subject: ec.subject,
          kind: ec.kind,
          amount: ec.amount,
          currency: ec.currency,
          occurredAt: ec.occurredAt,
          subscriptionId: ec.subscriptionId,
          approximate: ec.approximate,
        })
        .from(E)
        .where(and(inArray(ec.subject, ids), inArray(ec.kind, KINDS))))
        events.push({ ...r, amount: r.amount == null ? null : Number(r.amount) })
    }
    // An exposure under an anonymous id reads the account it merged into. Several
    // exposures can land on one account (merged ids, two devices): keep the
    // earliest and its variant so each account counts once.
    const first = new Map<string, PricingExposure>()
    for (const x of exposures) {
      const subject = merged.get(x.subject) ?? x.subject
      const seen = first.get(subject)
      if (!seen || x.exposedAt < seen.exposedAt) first.set(subject, { ...x, subject })
    }
    const resolved = [...first.values()]
    return {
      experiment: key,
      status: e.status,
      winner: e.winner,
      placements: (await linked(key)).map((p) => p.placement),
      ...pricingReadout(e.variants, resolved, events, opts),
    }
  }

  /**
   * Roll `variant` out: the experiment gives everyone it (and stops), and every
   * placement running it now serves that variant's offering directly (the
   * placement's own when the variant names none), with the experiment unlinked.
   * Safe to retry after a partial failure.
   */
  async function rollout(
    key: string,
    variant: string,
    { actor }: { actor: Actor },
  ): Promise<{ experiment: Experiment; placements: Placement[] }> {
    const e = await must(key)
    const v = e.variants.find((x) => x.key === variant)
    if (!v) throw new SignetDbError("BAD_VALUE", `"${variant}" is not a variant of "${key}".`)
    const places = await linked(key)
    if (!places.length)
      throw new SignetDbError(
        "BAD_VALUE",
        `No placement runs "${key}"; roll it out with experiments.rollout instead.`,
      )
    // Experiment first: if a placement write fails after it, assignment already serves the winner.
    const experiment =
      e.status === "rolled_out" && e.winner === variant
        ? e
        : await options.experiments.rollout(key, variant, { actor })
    const named = variantOffering(v.value)
    const placements: Placement[] = []
    for (const p of places)
      placements.push(
        await options.offerings.setPlacement(
          p.placement,
          {
            offering: named?.offering ?? p.offering,
            version: named ? (named.version ?? null) : p.version,
            overrides: p.overrides,
            experiment: null,
          },
          { actor },
        ),
      )
    return { experiment, placements }
  }

  return { readout, rollout }
}

export type Pricing = ReturnType<typeof createPricing>
