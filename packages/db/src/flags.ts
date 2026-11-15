/**
 * Feature flags defined in code, with stored overrides in `flagOverrides()`.
 *
 * ```ts
 * const flags = defineFlags({
 *   newEditor: {
 *     default: false,
 *     rules: [{ when: { plan: ["pro"] }, value: true }],
 *     rollout: { percent: 10, value: true },
 *   },
 * })
 * const ff = createFlags(db, flags, { table: schema.flagOverrides, entitlements: ent })
 * await ff.get("newEditor", { id: userId })  // { value, reason }
 * ```
 *
 * Evaluation order, first match wins: the subject's override, the everyone
 * override (`subject: "*"`), targeting rules in order, the percentage
 * rollout, the default. `evaluateFlag` is the same order as a pure function.
 * Rollout buckets come from a stable hash of the flag's salt and the subject
 * id, so a subject keeps its bucket and raising the percent only adds subjects.
 */

import { and, eq, gt, inArray, isNull, or, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import { type Actor, audited } from "./scoped.js"

export type FlagValue = string | number | boolean

export type FlagRule = {
  /** Every condition given must hold. */
  when: {
    /** The subject's plan is one of these. */
    plan?: readonly string[]
    /** Each attribute equals the value, or is one of the values in a list. */
    attributes?: Readonly<Record<string, FlagValue | readonly FlagValue[]>>
  }
  value: FlagValue
}

export type FlagDef = {
  readonly default: FlagValue
  readonly description?: string
  readonly rules?: readonly FlagRule[]
  /** `percent` (0 to 100, two decimals) of subjects get `value`. `salt` defaults to the flag key; change it to reshuffle. */
  readonly rollout?: { readonly percent: number; readonly value: FlagValue; readonly salt?: string }
}
export type Flags = Readonly<Record<string, FlagDef>>

type Widen<V> = V extends boolean ? boolean : V extends number ? number : string
/** The value type of a flag: the widened type of its default. */
export type ValueOf<F extends Flags, K extends keyof F> = Widen<F[K]["default"]>

export type FlagSubject = {
  id: string
  plan?: string
  attributes?: Readonly<Record<string, FlagValue | null | undefined>>
}

export type FlagReason = "override" | "rule" | "rollout" | "default"
export type FlagResult<V = FlagValue> = { value: V; reason: FlagReason; rule?: number }

/** Declare flags in code. Throws if a rule or rollout value is not the default's type. */
export function defineFlags<const F extends Flags>(flags: F): F {
  for (const [key, def] of Object.entries(flags)) {
    const t = typeof def.default
    const values = [...(def.rules ?? []).map((r) => r.value), def.rollout?.value]
    if (values.some((v) => v !== undefined && typeof v !== t))
      throw new SignetDbError(
        "BAD_VALUE",
        `Flag "${key}": every value must be a ${t}, like its default.`,
      )
    const p = def.rollout?.percent
    if (p !== undefined && !(p >= 0 && p <= 100))
      throw new SignetDbError("BAD_VALUE", `Flag "${key}": rollout.percent is 0 to 100.`)
  }
  return flags
}

/** The subject's bucket for a salt, 0 to 9999: FNV-1a over `${salt}:${id}`. */
export function bucket(salt: string, id: string): number {
  let h = 0x811c9dc5
  for (const ch of new TextEncoder().encode(`${salt}:${id}`)) {
    h ^= ch
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % 10_000
}

/** Whether a subject meets a rule's `when`: every condition given holds. */
export const matchesRule = (rule: Pick<FlagRule, "when">, s: FlagSubject): boolean => {
  const { plan, attributes } = rule.when
  if (plan && !(s.plan !== undefined && plan.includes(s.plan))) return false
  for (const [k, want] of Object.entries(attributes ?? {})) {
    const got = s.attributes?.[k]
    if (got === null || got === undefined) return false
    if (Array.isArray(want) ? !want.includes(got) : want !== got) return false
  }
  return true
}

/** Evaluate one flag: override, rules, rollout, default. */
export function evaluateFlag<V extends FlagValue>(
  key: string,
  def: FlagDef,
  subject: FlagSubject,
  override?: { value: FlagValue },
): FlagResult<V> {
  if (override && typeof override.value === typeof def.default)
    return { value: override.value as V, reason: "override" }
  const rules = def.rules ?? []
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i] as FlagRule
    if (matchesRule(r, subject)) return { value: r.value as V, reason: "rule", rule: i }
  }
  const ro = def.rollout
  if (ro && bucket(ro.salt ?? key, subject.id) < Math.round(ro.percent * 100))
    return { value: ro.value as V, reason: "rollout" }
  return { value: def.default as V, reason: "default" }
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: flag columns are known by name
type Cols = Record<string, any>

export type FlagsOptions = {
  /** The `flagOverrides()` table. */
  table: Table
  /** Fills `subject.plan` when the caller leaves it out. Anything with `get(id) → { plan }`. */
  entitlements?: { get(subject: string): Promise<{ plan: string }> }
  /** Clock, for tests. */
  now?: () => Date
}

export type StoredFlagOverride = {
  flag: string
  subject: string
  value: FlagValue
  expiresAt: Date | null
}

export function createFlags<F extends Flags>(
  db: SignetDb<unknown>,
  flags: F,
  options: FlagsOptions,
) {
  const t = options.table
  const c = t as unknown as Cols
  const o = db.orm as AnyOrm
  const now = options.now ?? (() => new Date())
  const live = () => or(isNull(c.expiresAt), gt(c.expiresAt, now()))
  const def = (key: string): FlagDef => {
    const d = flags[key]
    if (!d)
      throw new SignetDbError(
        "BAD_VALUE",
        `Unknown flag "${key}". Flags: ${Object.keys(flags).join(", ") || "none"}.`,
      )
    return d
  }
  const withPlan = async (s: FlagSubject): Promise<FlagSubject> =>
    s.plan === undefined && options.entitlements
      ? { ...s, plan: (await options.entitlements.get(s.id)).plan }
      : s
  const toOverride = (r: Cols): StoredFlagOverride => ({
    flag: r.flag,
    subject: r.subject,
    value: (r.value as { v: FlagValue }).v,
    expiresAt: r.expiresAt ?? null,
  })

  /** Unexpired overrides that apply to `subjectId` (its own and "*"), or all of them. */
  async function overrides(subjectId?: string): Promise<StoredFlagOverride[]> {
    const where = subjectId ? and(live(), inArray(c.subject, [subjectId, "*"])) : live()
    return (await o.select().from(t).where(where)).map(toOverride)
  }

  const pick = (list: StoredFlagOverride[], key: string, id: string) =>
    list.find((x) => x.flag === key && x.subject === id) ??
    list.find((x) => x.flag === key && x.subject === "*")

  async function all(subject: FlagSubject): Promise<{ [K in keyof F]: FlagResult<ValueOf<F, K>> }> {
    const s = await withPlan(subject)
    const list = await overrides(s.id)
    return Object.fromEntries(
      Object.entries(flags).map(([k, d]) => [k, evaluateFlag(k, d, s, pick(list, k, s.id))]),
    ) as never
  }

  return {
    flags,
    async get<K extends keyof F & string>(
      key: K,
      subject: FlagSubject,
    ): Promise<FlagResult<ValueOf<F, K>>> {
      const d = def(key)
      const s = await withPlan(subject)
      const list = (
        await o
          .select()
          .from(t)
          .where(and(live(), eq(c.flag, key), inArray(c.subject, [s.id, "*"])))
      ).map(toOverride)
      return evaluateFlag(key, d, s, pick(list, key, s.id))
    },
    /** Every flag for one subject. */
    all,
    overrides,
    /** Store an override for a subject, or for everyone with `subject: "*"`. */
    async set<K extends keyof F & string>(
      key: K,
      value: ValueOf<F, K>,
      opts: { subject: string; actor: Actor; expiresAt?: Date },
    ): Promise<StoredFlagOverride> {
      const d = def(key)
      if (typeof value !== typeof d.default)
        throw new SignetDbError("BAD_VALUE", `Flag "${key}" takes a ${typeof d.default}.`)
      if (!opts.subject) throw new SignetDbError("BAD_VALUE", 'A subject id (or "*") is required.')
      const id = `${key}|${opts.subject}`
      const w = audited(db, { actor: opts.actor })
      const values = { value: { v: value }, expiresAt: opts.expiresAt ?? null }
      let [row] = await w.update(t, values as never, eq(c.id, id))
      if (!row) {
        try {
          ;[row] = await w.insert(t, { id, flag: key, subject: opts.subject, ...values } as never)
        } catch (err) {
          ;[row] = await w.update(t, values as never, eq(c.id, id)) // lost an insert race
          if (!row) throw err
        }
      }
      return toOverride(row as Cols)
    },
    /** Remove an override. Returns whether there was one. */
    async clear(key: keyof F & string, opts: { subject: string; actor: Actor }): Promise<boolean> {
      def(key)
      const gone = await audited(db, { actor: opts.actor }).delete(
        t,
        eq(c.id, `${key}|${opts.subject}`),
      )
      return gone.length > 0
    },
  }
}

export type FlagStore<F extends Flags = Flags> = ReturnType<typeof createFlags<F>>
