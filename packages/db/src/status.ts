/**
 * A status page and the maintenance switch, on the tables from `statusTables()`.
 *
 * ```ts
 * const status = createStatus(db, { tables: { statusComponents, statusIncidents, maintenance } })
 * await status.setComponent("api", { name: "API", position: 1 }, { actor })
 * const inc = await status.openIncident({ title: "Slow sign-in", impact: "minor", components: ["api"], message: "Looking into it" }, { actor })
 * await status.updateIncident(inc.id, { status: "resolved", message: "Fixed" }, { actor })
 * await status.setMaintenance({ on: true, message: "Upgrading the database", until }, { actor })
 * await status.summary()   // what the public status page shows
 * ```
 *
 * Component statuses are set by hand, like most status pages. The overall
 * status is the worst of the components and the impact of open incidents;
 * maintenance mode shows as `maintenance` unless something is worse.
 * signet-server's `maintenanceMode` middleware reads `maintenance()`.
 */

import { and, asc, desc, eq, gte, isNull, or, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import { type Actor, audited } from "./scoped.js"

/** Ordered best to worst. */
export const COMPONENT_STATUSES = [
  "operational",
  "maintenance",
  "degraded",
  "partial_outage",
  "major_outage",
] as const
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number]
export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]
export const INCIDENT_IMPACTS = ["minor", "major", "critical"] as const
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number]

const IMPACT_STATUS: Record<IncidentImpact, ComponentStatus> = {
  minor: "degraded",
  major: "partial_outage",
  critical: "major_outage",
}

export type StatusComponent = {
  key: string
  name: string
  description: string | null
  status: ComponentStatus
  position: number
  updatedAt: Date
}

export type IncidentUpdate = { at: string; status: IncidentStatus; message: string }

export type Incident = {
  id: string
  title: string
  status: IncidentStatus
  impact: IncidentImpact
  components: string[]
  updates: IncidentUpdate[]
  startedAt: Date
  resolvedAt: Date | null
}

export type Maintenance = { on: boolean; message: string | null; until: Date | null }

export type StatusSummary = {
  status: ComponentStatus
  components: StatusComponent[]
  /** Open incidents, then those resolved in the last `days`, newest first. */
  incidents: Incident[]
  maintenance: Maintenance
}

export type StatusTables = { statusComponents: Table; statusIncidents: Table; maintenance: Table }

export type StatusOptions = {
  tables: StatusTables
  /** Clock, for tests. */
  now?: () => Date
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: status columns are known by name
type Cols = Record<string, any>

const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const bad = (message: string) => new SignetDbError("BAD_VALUE", message)
const oneOf = <T extends string>(list: readonly T[], v: unknown, name: string): T => {
  if (!list.includes(v as T)) throw bad(`${name} is one of ${list.join(", ")}.`)
  return v as T
}
const text = (v: unknown, name: string, max: number): string => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw bad(`${name} is text of 1 to ${max} characters.`)
  return v.trim()
}

/** The worse of two statuses. */
export const worst = (a: ComponentStatus, b: ComponentStatus): ComponentStatus =>
  COMPONENT_STATUSES.indexOf(a) >= COMPONENT_STATUSES.indexOf(b) ? a : b

export function createStatus(db: SignetDb<unknown>, options: StatusOptions) {
  const { statusComponents: C, statusIncidents: I, maintenance: M } = options.tables
  const cc = C as unknown as Cols
  const ic = I as unknown as Cols
  const mc = M as unknown as Cols
  const o = db.orm as AnyOrm
  const now = options.now ?? (() => new Date())

  const componentView = (r: Cols): StatusComponent => ({
    key: r.key,
    name: r.name,
    description: r.description ?? null,
    status: r.status,
    position: Number(r.position),
    updatedAt: r.updatedAt,
  })
  const incidentView = (r: Cols): Incident => ({
    id: r.id,
    title: r.title,
    status: r.status,
    impact: r.impact,
    components: r.components as string[],
    updates: r.updates as IncidentUpdate[],
    startedAt: r.startedAt,
    resolvedAt: r.resolvedAt ?? null,
  })

  async function components(): Promise<StatusComponent[]> {
    return (await o.select().from(C).orderBy(asc(cc.position), asc(cc.key))).map(componentView)
  }

  async function getIncident(id: string): Promise<Incident | null> {
    const [r] = await o.select().from(I).where(eq(ic.id, id)).limit(1)
    return r ? incidentView(r) : null
  }

  /** Open incidents and, with `days`, those resolved since then; newest first. */
  async function incidents(opts: { days?: number; limit?: number } = {}): Promise<Incident[]> {
    const since = new Date(now().getTime() - (opts.days ?? 0) * 86_400_000)
    return (
      await o
        .select()
        .from(I)
        .where(or(isNull(ic.resolvedAt), gte(ic.resolvedAt, since)))
        .orderBy(desc(ic.startedAt))
        .limit(Math.min(opts.limit ?? 50, 200))
    ).map(incidentView)
  }

  async function maintenance(): Promise<Maintenance> {
    const [r] = await o.select().from(M).where(eq(mc.id, "current")).limit(1)
    return r
      ? { on: Boolean(r.on), message: r.message ?? null, until: r.until ?? null }
      : { on: false, message: null, until: null }
  }

  /** Update a row, or insert it on first write (and update after a lost insert race). */
  async function upsert(table: Table, where: unknown, row: Cols, values: Cols, actor: Actor) {
    const w = audited(db, { actor })
    if ((await w.update(table, values as never, where as never)).length) return
    try {
      await w.insert(table, { ...row, ...values } as never)
    } catch (err) {
      if (!(await w.update(table, values as never, where as never)).length) throw err
    }
  }

  return {
    components,
    incidents,
    getIncident,
    maintenance,

    /** Add or change a component. `status` defaults to operational on create. */
    async setComponent(
      key: string,
      input: {
        name?: string
        description?: string | null
        status?: ComponentStatus
        position?: number
      },
      { actor }: { actor: Actor },
    ): Promise<StatusComponent> {
      if (typeof key !== "string" || !KEY.test(key))
        throw bad(`Component key "${key}" must be 1-64 letters, digits, ".", "_" or "-".`)
      const values: Cols = {}
      if (input.name !== undefined) values.name = text(input.name, "name", 100)
      if (input.description !== undefined)
        values.description =
          input.description === null ? null : text(input.description, "description", 500)
      if (input.status !== undefined)
        values.status = oneOf(COMPONENT_STATUSES, input.status, "status")
      if (input.position !== undefined) {
        if (!Number.isSafeInteger(input.position)) throw bad("position is an integer.")
        values.position = input.position
      }
      const [had] = await o.select().from(C).where(eq(cc.key, key)).limit(1)
      if (!had && !values.name) throw bad("A new component needs a name.")
      if (had && !Object.keys(values).length) return componentView(had)
      await upsert(C, eq(cc.key, key), { key, status: "operational", position: 0 }, values, actor)
      const [r] = await o.select().from(C).where(eq(cc.key, key)).limit(1)
      return componentView(r)
    },

    /** Remove a component. Returns whether there was one. */
    async removeComponent(key: string, { actor }: { actor: Actor }): Promise<boolean> {
      return (await audited(db, { actor }).delete(C, eq(cc.key, key))).length > 0
    },

    async openIncident(
      input: {
        title: string
        impact: IncidentImpact
        components?: string[]
        message: string
        status?: Exclude<IncidentStatus, "resolved">
      },
      { actor }: { actor: Actor },
    ): Promise<Incident> {
      const title = text(input.title, "title", 200)
      const impact = oneOf(INCIDENT_IMPACTS, input.impact, "impact")
      const status = oneOf(
        INCIDENT_STATUSES.filter((s) => s !== "resolved"),
        input.status ?? "investigating",
        "status",
      )
      const message = text(input.message, "message", 5000)
      const keys = input.components ?? []
      if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string"))
        throw bad("components is a list of component keys.")
      const known = new Set((await components()).map((c) => c.key))
      const unknown = keys.filter((k) => !known.has(k))
      if (unknown.length) throw bad(`Unknown components: ${unknown.join(", ")}.`)
      const at = now()
      const [row] = await audited(db, { actor }).insert(I, {
        title,
        impact,
        status,
        components: [...new Set(keys)],
        updates: [{ at: at.toISOString(), status, message }],
        startedAt: at,
      } as never)
      return incidentView(row as Cols)
    },

    /** Post an update; `resolved` closes the incident. A resolved incident cannot change. */
    async updateIncident(
      id: string,
      input: { status: IncidentStatus; message: string; impact?: IncidentImpact },
      { actor }: { actor: Actor },
    ): Promise<Incident> {
      const status = oneOf(INCIDENT_STATUSES, input.status, "status")
      const message = text(input.message, "message", 5000)
      const inc = await getIncident(id)
      if (!inc) throw new SignetDbError("NOT_FOUND", `No incident "${id}".`)
      if (inc.resolvedAt) throw new SignetDbError("CONFLICT", "This incident is resolved.")
      const at = now()
      const values: Cols = {
        status,
        updates: [...inc.updates, { at: at.toISOString(), status, message }],
        ...(input.impact !== undefined
          ? { impact: oneOf(INCIDENT_IMPACTS, input.impact, "impact") }
          : {}),
        ...(status === "resolved" ? { resolvedAt: at } : {}),
      }
      // Conditional on still being open, so two resolves cannot both append.
      const [row] = await audited(db, { actor }).update(
        I,
        values as never,
        and(eq(ic.id, id), isNull(ic.resolvedAt)),
      )
      if (!row) throw new SignetDbError("CONFLICT", "This incident changed; reload it.")
      return incidentView(row as Cols)
    },

    /** Turn maintenance mode on or off. `until` becomes the 503's Retry-After. */
    async setMaintenance(
      input: { on: boolean; message?: string | null; until?: Date | null },
      { actor }: { actor: Actor },
    ): Promise<Maintenance> {
      if (typeof input.on !== "boolean") throw bad("on is true or false.")
      if (input.until != null && !(input.until instanceof Date && !Number.isNaN(+input.until)))
        throw bad("until is a date.")
      const values = {
        on: input.on,
        message: input.message == null ? null : text(input.message, "message", 500),
        until: input.until ?? null,
        updatedBy: actor.id,
      }
      await upsert(M, eq(mc.id, "current"), { id: "current" }, values, actor)
      return maintenance()
    },

    /** What the public status page shows: overall status, components, recent incidents, maintenance. */
    async summary(opts: { days?: number } = {}): Promise<StatusSummary> {
      const [list, recent, m] = await Promise.all([
        components(),
        incidents({ days: opts.days ?? 7 }),
        maintenance(),
      ])
      let status: ComponentStatus = m.on ? "maintenance" : "operational"
      for (const c of list) status = worst(status, c.status)
      for (const i of recent) if (!i.resolvedAt) status = worst(status, IMPACT_STATUS[i.impact])
      return { status, components: list, incidents: recent, maintenance: m }
    },
  }
}

export type StatusStore = ReturnType<typeof createStatus>
