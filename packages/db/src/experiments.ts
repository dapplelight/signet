/**
 * A/B/n experiments on top of feature flags, on the tables from
 * `experimentTables()`, with conversions read from `analyticsEvents()`.
 *
 * ```ts
 * const ex = createExperiments(db, { tables: { experiments, experimentExposures }, events: analyticsEvents })
 * await ex.create("onboarding-copy", {
 *   variants: [{ key: "control", weight: 50 }, { key: "short", weight: 50, value: { steps: 3 } }],
 *   goal: "signup_completed",
 * }, { actor })
 * await ex.start("onboarding-copy", { actor })
 * await ex.expose("onboarding-copy", { id: userId })   // { variant: "short", value: { steps: 3 }, reason: "assigned" }
 * await ex.results("onboarding-copy")                   // per-variant rates, lift and p-value against the control
 * await ex.rollout("onboarding-copy", "short", { actor })
 * ```
 *
 * Assignment needs no storage: the variant comes from the flags' `bucket`
 * (FNV-1a of `salt:subjectId`) laid over the weights, so a subject always
 * gets the same variant. Variants and weights are fixed once the experiment
 * starts, which keeps assignment sticky. `expose` records the first time a
 * subject saw the experiment; a conversion is that subject's goal event
 * (by `userId` or `anonymousId`) at or after that moment.
 *
 * A variant's `value` is free JSON the app reads. Pricing experiments put an
 * offering key there (`{ offering: "annual-first" }`) and a placement serves
 * `assignment.value.offering`.
 */

import { and, count, desc, eq, inArray, sql, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import { bucket, type FlagRule, type FlagSubject, matchesRule } from "./flags.js"
import { type Actor, audited } from "./scoped.js"

export type ExperimentStatus = "draft" | "running" | "stopped" | "rolled_out"

export type Variant = {
  key: string
  /** Relative share of traffic; any positive number. */
  weight: number
  /** What the app reads for this variant, e.g. `{ offering: "annual-first" }`. JSON. */
  value?: unknown
}

export type Experiment = {
  key: string
  description: string | null
  status: ExperimentStatus
  /** The first variant is the control. */
  variants: Variant[]
  /** The analytics event name that counts as a conversion. */
  goal: string
  /** Who is in the experiment, as a flag rule's `when`. Null is everyone. */
  audience: FlagRule["when"] | null
  salt: string
  winner: string | null
  startedAt: Date | null
  stoppedAt: Date | null
  updatedBy: string | null
  updatedAt: Date
}

export type ExperimentInput = {
  variants: Variant[]
  goal: string
  description?: string | null
  audience?: FlagRule["when"] | null
  /** Default: the experiment key. Change it to reshuffle (draft only). */
  salt?: string
}

/**
 * - `assigned`: running, and the subject is in it.
 * - `winner`: rolled out; everyone gets the winner.
 * - `not_running`: a draft or stopped experiment; the control.
 * - `not_eligible`: outside the audience; the control.
 */
export type AssignmentReason = "assigned" | "winner" | "not_running" | "not_eligible"

export type Assignment = {
  experiment: string
  variant: string
  value: unknown
  reason: AssignmentReason
}

export type VariantResult = {
  key: string
  exposed: number
  converted: number
  /** converted / exposed; 0 with nobody exposed. */
  rate: number
  /** (rate − control rate) / control rate; null for the control or a control rate of 0. */
  lift: number | null
  /** Two-sided two-proportion z-test against the control; null for the control or too little data. */
  pValue: number | null
  /** pValue below `alpha`. */
  significant: boolean
}

export type ExperimentResults = {
  experiment: string
  status: ExperimentStatus
  goal: string
  alpha: number
  control: string
  variants: VariantResult[]
}

export type ExperimentTables = { experiments: Table; experimentExposures: Table }

export type ExperimentsOptions = {
  tables: ExperimentTables
  /** The `analyticsEvents()` table, for `results`. */
  events?: Table
  /** Clock, for tests. */
  now?: () => Date
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: experiment columns are known by name
type Cols = Record<string, any>

const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const bad = (message: string) => new SignetDbError("BAD_VALUE", message)

/** Check variants: 2 to 10, unique keys, positive weights, JSON values. */
export function checkVariants(variants: unknown): Variant[] {
  if (!Array.isArray(variants) || variants.length < 2 || variants.length > 10)
    throw bad("An experiment has 2 to 10 variants; the first is the control.")
  const seen = new Set<string>()
  return variants.map((v: Cols, i) => {
    if (!v || typeof v.key !== "string" || !KEY.test(v.key))
      throw bad(`variants[${i}].key must be 1-64 letters, digits, ".", "_" or "-".`)
    if (seen.has(v.key)) throw bad(`variants[${i}]: "${v.key}" is listed twice.`)
    seen.add(v.key)
    if (typeof v.weight !== "number" || !Number.isFinite(v.weight) || v.weight <= 0)
      throw bad(`variants[${i}].weight is a positive number.`)
    if (v.value !== undefined && JSON.stringify(v.value).length > 10_000)
      throw bad(`variants[${i}].value is JSON of at most 10,000 characters.`)
    return { key: v.key, weight: v.weight, ...(v.value !== undefined ? { value: v.value } : {}) }
  })
}

/** The variant a subject gets: its bucket (0-9999) laid over the cumulative weights. */
export function pickVariant(
  variants: readonly Variant[],
  salt: string,
  subjectId: string,
): Variant {
  const total = variants.reduce((s, v) => s + v.weight, 0)
  const point = ((bucket(salt, subjectId) + 0.5) / 10_000) * total
  let acc = 0
  for (const v of variants) {
    acc += v.weight
    if (point < acc) return v
  }
  return variants[variants.length - 1] as Variant
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, error below 1.5e-7). */
function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

/**
 * Two-sided two-proportion z-test: the p-value that rates a/n1 and b/n2
 * differ only by chance. Null when either group is empty or nobody (or
 * everybody) converted, where the test says nothing.
 */
export function twoProportionTest(c1: number, n1: number, c2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null
  const p = (c1 + c2) / (n1 + n2)
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
  if (!(se > 0)) return null
  const z = (c2 / n2 - c1 / n1) / se
  return Math.min(1, 2 * (1 - phi(Math.abs(z))))
}

export function createExperiments(db: SignetDb<unknown>, options: ExperimentsOptions) {
  const { experiments: T, experimentExposures: X } = options.tables
  const tc = T as unknown as Cols
  const xc = X as unknown as Cols
  const o = db.orm as AnyOrm
  const now = options.now ?? (() => new Date())

  const view = (r: Cols): Experiment => ({
    key: r.key,
    description: r.description ?? null,
    status: r.status,
    variants: r.variants as Variant[],
    goal: r.goal,
    audience: (r.audience as FlagRule["when"] | null) ?? null,
    salt: r.salt,
    winner: r.winner ?? null,
    startedAt: r.startedAt ?? null,
    stoppedAt: r.stoppedAt ?? null,
    updatedBy: r.updatedBy ?? null,
    updatedAt: r.updatedAt,
  })

  async function get(key: string): Promise<Experiment | null> {
    const [r] = await o.select().from(T).where(eq(tc.key, key)).limit(1)
    return r ? view(r) : null
  }

  async function list(): Promise<Experiment[]> {
    return (await o.select().from(T).orderBy(desc(tc.updatedAt))).map(view)
  }

  const must = async (key: string) => {
    const e = await get(key)
    if (!e) throw new SignetDbError("NOT_FOUND", `No experiment "${key}".`)
    return e
  }

  function checkInput(input: Partial<ExperimentInput>) {
    const out: Cols = {}
    if (input.variants !== undefined) out.variants = checkVariants(input.variants)
    if (input.goal !== undefined) {
      if (typeof input.goal !== "string" || !input.goal || input.goal.length > 200)
        throw bad("goal is an analytics event name.")
      out.goal = input.goal
    }
    if (input.description !== undefined) {
      if (input.description !== null && typeof input.description !== "string")
        throw bad("description is a string.")
      out.description = input.description?.slice(0, 2000) ?? null
    }
    if (input.audience !== undefined) {
      const a = input.audience
      if (a !== null && (typeof a !== "object" || Array.isArray(a)))
        throw bad("audience is a flag rule's when: { plan?, attributes? }.")
      out.audience = a
    }
    if (input.salt !== undefined) {
      if (typeof input.salt !== "string" || !input.salt || input.salt.length > 100)
        throw bad("salt is a non-empty string.")
      out.salt = input.salt
    }
    return out
  }

  /** A new draft. Keys are unique; a taken key is CONFLICT. */
  async function create(
    key: string,
    input: ExperimentInput,
    { actor }: { actor: Actor },
  ): Promise<Experiment> {
    if (typeof key !== "string" || !KEY.test(key))
      throw bad(`Experiment key "${key}" must be 1-64 letters, digits, ".", "_" or "-".`)
    const values = checkInput(input)
    if (!values.variants || !values.goal) throw bad("An experiment needs variants and a goal.")
    if (await get(key)) throw new SignetDbError("CONFLICT", `Experiment "${key}" exists.`)
    try {
      await audited(db, { actor }).insert(T, {
        key,
        status: "draft",
        salt: key,
        description: null,
        audience: null,
        ...values,
        createdBy: actor.id,
        updatedBy: actor.id,
      } as never)
    } catch (err) {
      if (await get(key)) throw new SignetDbError("CONFLICT", `Experiment "${key}" exists.`)
      throw err
    }
    return (await get(key)) as Experiment
  }

  /** Move from one of `from` to a new status, or CONFLICT. One conditional UPDATE, so racing calls cannot both win. */
  async function move(
    key: string,
    from: ExperimentStatus[],
    values: Cols,
    actor: Actor,
    what: string,
  ): Promise<Experiment> {
    const e = await must(key)
    const [row] = await audited(db, { actor }).update(
      T,
      { ...values, updatedBy: actor.id } as never,
      and(eq(tc.key, key), inArray(tc.status, from)),
    )
    if (!row)
      throw new SignetDbError(
        "CONFLICT",
        `Cannot ${what} "${key}": it is ${(await get(key))?.status ?? e.status}.`,
      )
    return view(row as Cols)
  }

  return {
    get,
    list,
    create,
    /** Change a draft: variants, goal, audience, description, salt. */
    async update(key: string, input: Partial<ExperimentInput>, { actor }: { actor: Actor }) {
      return move(key, ["draft"], checkInput(input), actor, "edit")
    },
    /** Start (or resume) assigning and exposing. */
    async start(key: string, { actor }: { actor: Actor }) {
      const e = await must(key)
      return move(
        key,
        ["draft", "stopped"],
        { status: "running", startedAt: e.startedAt ?? now(), stoppedAt: null },
        actor,
        "start",
      )
    },
    /** Stop: everyone gets the control again; results stay. */
    async stop(key: string, { actor }: { actor: Actor }) {
      return move(key, ["running"], { status: "stopped", stoppedAt: now() }, actor, "stop")
    },
    /** Give everyone `variant` from now on. */
    async rollout(key: string, variant: string, { actor }: { actor: Actor }) {
      const e = await must(key)
      if (!e.variants.some((v) => v.key === variant))
        throw bad(`"${variant}" is not a variant of "${key}".`)
      return move(
        key,
        ["running", "stopped"],
        { status: "rolled_out", winner: variant, stoppedAt: e.stoppedAt ?? now() },
        actor,
        "roll out",
      )
    },

    /** The subject's variant, with no record kept. Null for an unknown experiment. */
    async assign(key: string, subject: FlagSubject): Promise<Assignment | null> {
      const e = await get(key)
      return e ? assignOf(e, subject) : null
    },

    /**
     * Assign and record the exposure: call it where the subject actually sees
     * the variant. Only a running experiment records one, once per subject.
     */
    async expose(
      key: string,
      subject: FlagSubject,
    ): Promise<(Assignment & { first: boolean }) | null> {
      const e = await get(key)
      if (!e) return null
      const a = assignOf(e, subject)
      if (a.reason !== "assigned") return { ...a, first: false }
      const inserted = await o
        .insert(X)
        .values({
          id: `${key}|${subject.id}`,
          experiment: key,
          subject: subject.id,
          variant: a.variant,
          exposedAt: now().getTime(),
        })
        .onConflictDoNothing()
        .returning()
      return { ...a, first: inserted.length > 0 }
    },

    /**
     * Per-variant exposures, conversions (the goal event at or after the
     * subject's exposure; `goal` here reads another event) and a two-sided
     * z-test of each variant against the control.
     */
    async results(
      key: string,
      opts: { goal?: string; alpha?: number } = {},
    ): Promise<ExperimentResults> {
      if (!options.events)
        throw new SignetDbError(
          "BAD_CONFIG",
          "Pass `events` (the analyticsEvents table) for results.",
        )
      const e = await must(key)
      const E = options.events
      const ec = E as unknown as Cols
      const goal = opts.goal ?? e.goal
      const alpha = opts.alpha ?? 0.05
      const converted = sql<number>`coalesce(sum(case when exists (select 1 from ${E} where ${ec.name} = ${goal} and ${ec.ts} >= ${xc.exposedAt} and (${ec.userId} = ${xc.subject} or ${ec.anonymousId} = ${xc.subject})) then 1 else 0 end), 0)`
      const rows: Cols[] = await o
        .select({ variant: xc.variant, exposed: count(), converted })
        .from(X)
        .where(eq(xc.experiment, key))
        .groupBy(xc.variant)
      const by = new Map(rows.map((r) => [r.variant, r]))
      const counts = e.variants.map((v) => {
        const r = by.get(v.key)
        const exposed = Number(r?.exposed ?? 0)
        const conv = Number(r?.converted ?? 0)
        return { key: v.key, exposed, converted: conv, rate: exposed ? conv / exposed : 0 }
      })
      const control = counts[0] as (typeof counts)[number]
      // ponytail: each variant is tested against the control at `alpha` with no
      // multiple-comparison correction; divide alpha by the variant count for many arms.
      return {
        experiment: key,
        status: e.status,
        goal,
        alpha,
        control: control.key,
        variants: counts.map((v, i) => {
          if (i === 0) return { ...v, lift: null, pValue: null, significant: false }
          const pValue = twoProportionTest(
            control.converted,
            control.exposed,
            v.converted,
            v.exposed,
          )
          return {
            ...v,
            lift: control.rate ? (v.rate - control.rate) / control.rate : null,
            pValue,
            significant: pValue !== null && pValue < alpha,
          }
        }),
      }
    },
  }
}

/** The assignment for a loaded experiment, as a pure function. */
export function assignOf(e: Experiment, subject: FlagSubject): Assignment {
  const control = e.variants[0] as Variant
  const out = (v: Variant, reason: AssignmentReason): Assignment => ({
    experiment: e.key,
    variant: v.key,
    value: v.value ?? null,
    reason,
  })
  if (e.status === "rolled_out") {
    const w = e.variants.find((v) => v.key === e.winner) ?? control
    return out(w, "winner")
  }
  if (e.status !== "running") return out(control, "not_running")
  if (e.audience && !matchesRule({ when: e.audience }, subject)) return out(control, "not_eligible")
  return out(pickVariant(e.variants, e.salt, subject.id), "assigned")
}

export type Experiments = ReturnType<typeof createExperiments>
