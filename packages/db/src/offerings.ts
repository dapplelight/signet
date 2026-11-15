/**
 * Offerings and remote paywalls, on the tables from `monetisationTables()`.
 *
 * An offering is a set of store and web products mapped to plans, plus the
 * paywall that sells them. Each `publish` writes a new immutable version. A
 * placement ("onboarding", "settings-upgrade") points at the offering it
 * serves now, optionally pinned to a version, with overrides per audience
 * (country, platform, user attribute). The app asks for a placement, so
 * changing what it shows needs no app release.
 *
 * ```ts
 * const offerings = createOfferings(db, { tables, plans })
 * await offerings.publish("default", { products, paywall }, { actor })     // version 1
 * await offerings.setPlacement("onboarding", {
 *   offering: "default",
 *   overrides: [{ when: { country: ["IN"] }, offering: "india" }],
 * }, { actor })
 * await offerings.current("onboarding", { country: "IN", platform: "appstore" })
 * ```
 */

import { and, desc, eq, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import { matchesRule } from "./flags.js"
import { type Actor, audited } from "./scoped.js"

/** Where a product is sold: "appstore", "googleplay", or "web" (any web gateway). */
export type ProductStore = "appstore" | "googleplay" | "web" | (string & {})
export type ProductInterval = "month" | "year" | "once"

export type OfferingProduct = {
  /** The store product id, or the web gateway's plan or price id. */
  id: string
  store: ProductStore
  /** The plan key from `definePlans` this product grants. */
  plan: string
  interval?: ProductInterval
  /** Display price in minor units. Stores charge their own price; this is what the paywall shows. */
  price?: { amount: number; currency: string }
}

/** What the remote paywall shows. Every field is optional; the screen has defaults. */
export type PaywallConfig = {
  title?: string
  subtitle?: string
  /** Plan keys shown, in order. Default: every plan the products grant, in product order. */
  plans?: string[]
  /** The plan selected first and marked. */
  highlight?: string
  /** The mark on the highlighted plan, e.g. "Best value". */
  badge?: string
  /** Trial terms shown under the plans, e.g. "7 days free, then billed yearly". */
  trial?: string
  /** The purchase button's text. */
  cta?: string
}

export type Offering = {
  key: string
  version: number
  products: OfferingProduct[]
  paywall: PaywallConfig | null
  note: string | null
  createdBy: string | null
  createdAt: Date
}

export type Audience = {
  /** ISO 3166-1 alpha-2, e.g. "IN". */
  country?: string
  /** "appstore", "googleplay" or "web", matching `OfferingProduct.store`. */
  platform?: string
  attributes?: Readonly<Record<string, string | number | boolean | null | undefined>>
}

export type AudienceRule = {
  /** Every condition given must hold; a list matches any of its values. */
  when: {
    country?: readonly string[]
    platform?: readonly string[]
    attributes?: Readonly<
      Record<string, string | number | boolean | readonly (string | number | boolean)[]>
    >
  }
  offering: string
  /** A pinned version; omitted serves the latest. */
  version?: number
}

export type Placement = {
  placement: string
  offering: string
  version: number | null
  overrides: AudienceRule[]
  updatedBy: string | null
  updatedAt: Date
}

export type CurrentOffering = Offering & {
  placement: string
  /** The override that matched (its index), or null for the placement's own offering. */
  override: number | null
}

export type OfferingTables = { offerings: Table; placements: Table }

export type OfferingsOptions = {
  tables: OfferingTables
  /** `definePlans(...)`: every product's plan must be one of these. */
  plans?: Readonly<Record<string, unknown>>
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: offering columns are known by name
type Cols = Record<string, any>

const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const bad = (message: string) => new SignetDbError("BAD_VALUE", message)
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200
const optStr = (v: unknown, name: string, max = 500) => {
  if (v === undefined) return
  if (typeof v !== "string" || v.length > max)
    throw bad(`paywall.${name} is a string of at most ${max} characters.`)
}

export function createOfferings(db: SignetDb<unknown>, options: OfferingsOptions) {
  const { offerings: O, placements: PL } = options.tables
  const oc = O as unknown as Cols
  const pc = PL as unknown as Cols
  const o = db.orm as AnyOrm
  const plans = options.plans

  const key = (k: string, what: string) => {
    if (typeof k !== "string" || !KEY.test(k))
      throw bad(`${what} "${k}" must be 1-64 letters, digits, ".", "_" or "-".`)
    return k
  }

  function checkProducts(products: unknown): OfferingProduct[] {
    if (!Array.isArray(products) || products.length === 0)
      throw bad("An offering needs at least one product.")
    const seen = new Set<string>()
    return products.map((p: Cols, i) => {
      if (!p || !isStr(p.id) || !isStr(p.store) || !isStr(p.plan))
        throw bad(`products[${i}] needs id, store and plan.`)
      if (plans && !(p.plan in plans))
        throw bad(
          `products[${i}].plan "${p.plan}" is not a plan. Plans: ${Object.keys(plans).join(", ")}.`,
        )
      if (p.interval !== undefined && !["month", "year", "once"].includes(p.interval))
        throw bad(`products[${i}].interval is month, year or once.`)
      if (
        p.price !== undefined &&
        !(
          Number.isSafeInteger(p.price?.amount) &&
          p.price.amount >= 0 &&
          /^[A-Z]{3}$/.test(p.price?.currency)
        )
      )
        throw bad(`products[${i}].price is { amount: minor units, currency: "INR" }.`)
      const id = `${p.store}:${p.id}`
      if (seen.has(id)) throw bad(`products[${i}]: ${id} is listed twice.`)
      seen.add(id)
      return {
        id: p.id,
        store: p.store,
        plan: p.plan,
        ...(p.interval ? { interval: p.interval } : {}),
        ...(p.price ? { price: { amount: p.price.amount, currency: p.price.currency } } : {}),
      }
    })
  }

  function checkPaywall(pw: unknown, products: OfferingProduct[]): PaywallConfig | null {
    if (pw === undefined || pw === null) return null
    if (typeof pw !== "object") throw bad("paywall is an object.")
    const w = pw as Cols
    for (const k of ["title", "subtitle", "badge", "trial", "cta"]) optStr(w[k], k)
    const sold = new Set(products.map((p) => p.plan))
    if (w.plans !== undefined) {
      if (
        !Array.isArray(w.plans) ||
        w.plans.some((p: unknown) => typeof p !== "string" || !sold.has(p))
      )
        throw bad("paywall.plans lists plans this offering's products grant.")
    }
    if (w.highlight !== undefined && !sold.has(w.highlight))
      throw bad(`paywall.highlight "${w.highlight}" is not a plan this offering sells.`)
    const out: PaywallConfig = {}
    for (const k of ["title", "subtitle", "plans", "highlight", "badge", "trial", "cta"] as const)
      if (w[k] !== undefined) (out as Cols)[k] = w[k]
    return out
  }

  const view = (r: Cols): Offering => ({
    key: r.key,
    version: Number(r.version),
    products: r.products as OfferingProduct[],
    paywall: (r.paywall as PaywallConfig | null) ?? null,
    note: r.note ?? null,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt,
  })

  /** One version, or the latest with none given. */
  async function get(k: string, version?: number | null): Promise<Offering | null> {
    const q = o.select().from(O)
    const [r] =
      version == null
        ? await q.where(eq(oc.key, k)).orderBy(desc(oc.version)).limit(1)
        : await q.where(and(eq(oc.key, k), eq(oc.version, version))).limit(1)
    return r ? view(r) : null
  }

  /**
   * Publish a new version of `key`: products and paywall are validated, then
   * written as version latest + 1. The row id is `${key}@${version}`, so two
   * concurrent publishes cannot take the same number; the loser retries.
   */
  async function publish(
    k: string,
    input: { products: OfferingProduct[]; paywall?: PaywallConfig | null; note?: string },
    { actor }: { actor: Actor },
  ): Promise<Offering> {
    key(k, "Offering key")
    const products = checkProducts(input.products)
    const paywall = checkPaywall(input.paywall, products)
    if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 500))
      throw bad("note is a string of at most 500 characters.")
    for (let attempt = 0; attempt < 5; attempt++) {
      const version = ((await get(k))?.version ?? 0) + 1
      try {
        await audited(db, { actor }).insert(O, {
          id: `${k}@${version}`,
          key: k,
          version,
          products,
          paywall,
          note: input.note ?? null,
          createdBy: actor.id,
        } as never)
        return (await get(k, version)) as Offering
      } catch (err) {
        if (await get(k, version)) continue // another publish took this number
        throw err
      }
    }
    throw new SignetDbError("CONFLICT", `Could not publish "${k}": too many concurrent publishes.`)
  }

  async function versions(k: string): Promise<Offering[]> {
    return (await o.select().from(O).where(eq(oc.key, k)).orderBy(desc(oc.version))).map(view)
  }

  /** Every offering's latest version. */
  async function list(): Promise<Offering[]> {
    const latest = new Map<string, Offering>()
    for (const r of await o.select().from(O).orderBy(desc(oc.version))) {
      if (!latest.has(r.key)) latest.set(r.key, view(r))
    }
    return [...latest.values()].sort((a, b) => a.key.localeCompare(b.key))
  }

  const placementView = (r: Cols): Placement => ({
    placement: r.placement,
    offering: r.offering,
    version: r.version == null ? null : Number(r.version),
    overrides: (r.overrides as AudienceRule[]) ?? [],
    updatedBy: r.updatedBy ?? null,
    updatedAt: r.updatedAt,
  })

  async function exists(k: string, version?: number | null, where = "offering") {
    if (!(await get(k, version)))
      throw bad(`${where} "${k}"${version == null ? "" : ` version ${version}`} is not published.`)
  }

  function checkRules(rules: unknown): AudienceRule[] {
    if (rules === undefined) return []
    if (!Array.isArray(rules) || rules.length > 50)
      throw bad("overrides is a list of at most 50 rules.")
    return rules.map((r: Cols, i) => {
      const w = r?.when
      if (!w || typeof w !== "object" || !isStr(r.offering))
        throw bad(`overrides[${i}] needs when and offering.`)
      const list = (v: unknown, n: string) => {
        if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === "string")))
          throw bad(`overrides[${i}].when.${n} is a list of strings.`)
      }
      list(w.country, "country")
      list(w.platform, "platform")
      if (
        w.attributes !== undefined &&
        (typeof w.attributes !== "object" || Array.isArray(w.attributes))
      )
        throw bad(`overrides[${i}].when.attributes is an object.`)
      if (r.version !== undefined && !Number.isSafeInteger(r.version))
        throw bad(`overrides[${i}].version is an integer.`)
      return {
        when: {
          ...(w.country ? { country: w.country } : {}),
          ...(w.platform ? { platform: w.platform } : {}),
          ...(w.attributes ? { attributes: w.attributes } : {}),
        },
        offering: r.offering,
        ...(r.version !== undefined ? { version: r.version } : {}),
      }
    })
  }

  /**
   * Point a placement at an offering (pinned to `version`, or the latest), with
   * audience overrides, first match wins. Every offering named must be published.
   */
  async function setPlacement(
    placement: string,
    input: { offering: string; version?: number | null; overrides?: AudienceRule[] },
    { actor }: { actor: Actor },
  ): Promise<Placement> {
    key(placement, "Placement")
    const overrides = checkRules(input.overrides)
    await exists(input.offering, input.version)
    for (const r of overrides) await exists(r.offering, r.version, "override offering")
    const values = {
      offering: input.offering,
      version: input.version ?? null,
      overrides,
      updatedBy: actor.id,
    }
    const w = audited(db, { actor })
    if (!(await w.update(PL, values as never, eq(pc.placement, placement))).length) {
      try {
        await w.insert(PL, { placement, ...values } as never)
      } catch (err) {
        // A concurrent first write: update the row it made.
        if (!(await w.update(PL, values as never, eq(pc.placement, placement))).length) throw err
      }
    }
    return (await getPlacement(placement)) as Placement
  }

  async function getPlacement(placement: string): Promise<Placement | null> {
    const [r] = await o.select().from(PL).where(eq(pc.placement, placement)).limit(1)
    return r ? placementView(r) : null
  }

  async function placements(): Promise<Placement[]> {
    return (await o.select().from(PL)).map(placementView)
  }

  /**
   * The offering a placement serves to this audience: the first matching
   * override, else the placement's own. Null for an unknown placement.
   */
  async function current(
    placement: string,
    audience: Audience = {},
  ): Promise<CurrentOffering | null> {
    const p = await getPlacement(placement)
    if (!p) return null
    const subject = {
      id: "",
      attributes: {
        ...audience.attributes,
        ...(audience.country ? { country: audience.country.toUpperCase() } : {}),
        ...(audience.platform ? { platform: audience.platform } : {}),
      },
    }
    for (const [i, r] of p.overrides.entries()) {
      const when = {
        attributes: {
          ...r.when.attributes,
          ...(r.when.country ? { country: r.when.country.map((c) => c.toUpperCase()) } : {}),
          ...(r.when.platform ? { platform: r.when.platform } : {}),
        },
      }
      if (!matchesRule({ when }, subject)) continue
      const hit = await get(r.offering, r.version)
      if (hit) return { ...hit, placement, override: i }
    }
    const own = await get(p.offering, p.version)
    return own ? { ...own, placement, override: null } : null
  }

  return { publish, get, versions, list, setPlacement, getPlacement, placements, current }
}

export type Offerings = ReturnType<typeof createOfferings>

/**
 * The `billing.plans` map for `createEntitlements` from offering products:
 * `{ "appstore:pro.monthly": "pro", "web:price_9f": "pro" }` becomes
 * `"<store>:<id>"` keys, with `web` products keyed by their bare id (web
 * gateways' plan and price ids). Spread it into your own map.
 */
export function plansFromProducts<K extends string>(
  products: readonly (OfferingProduct & { plan: K })[],
): Record<string, K> {
  return Object.fromEntries(
    products.map((p) => [p.store === "web" ? p.id : `${p.store}:${p.id}`, p.plan]),
  )
}
