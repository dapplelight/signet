// The real books for the robustness tests: signet-payments' createPayments
// over a memory store (inbox, payment records, ledger) and signet-db's
// entitlements over in-memory SQLite, both on one fake clock.
import { Database } from "bun:sqlite"
import * as sqc from "@dapplelight/signet-db/columns/sqlite"
import { createEntitlements, definePlans } from "@dapplelight/signet-db/entitlements"
import { createDb } from "@dapplelight/signet-db/sqlite"
import {
  createPayments,
  type Event,
  memoryStore,
  type PaymentGateway,
} from "@dapplelight/signet-payments"
import { type Column, getTableColumns, getTableName, is, SQL, type Table } from "drizzle-orm"
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core"
import { fakeClock } from "../src/clock"

/** CREATE TABLE for a drizzle SQLite table (as signet-db's own test harness does). */
export function ddl(table: Table): string {
  const dialect = new SQLiteSyncDialect()
  const def = (c: Column) =>
    c.default === undefined
      ? ""
      : is(c.default, SQL)
        ? ` default ${dialect.sqlToQuery(c.default).sql}`
        : ` default '${String(c.default)}'`
  const cols = Object.values(getTableColumns(table) as Record<string, Column>).map(
    (c) =>
      `"${c.name}" ${c.getSQLType()}${c.primary ? " primary key" : ""}${c.notNull && !c.primary ? " not null" : ""}${def(c)}`,
  )
  const pk = getTableConfig(table as never).primaryKeys[0]
  if (pk) cols.push(`primary key (${pk.columns.map((c) => `"${c.name}"`).join(", ")})`)
  return `create table "${getTableName(table)}" (${cols.join(", ")})`
}

export const plans = definePlans({
  free: { features: ["export"], limits: {} },
  pro: { features: ["export", "sso"], limits: {} },
})

/** Books for one test: the user is "u1"; every subscription event is applied to them. */
export function books(
  gateways: (now: () => number) => PaymentGateway[],
  start = "2026-11-01T10:00:00Z",
) {
  const clock = fakeClock(start)
  const sqlite = new Database(":memory:")
  const tables = sqc.entitlementTables()
  const audit = sqc.auditLog()
  const idempotency = sqc.idempotencyKeys()
  for (const t of [...Object.values(tables), audit, idempotency]) sqlite.run(ddl(t))
  const db = createDb(sqlite, { audit, idempotency })
  const ent = createEntitlements(db, {
    plans,
    default: "free",
    tables,
    now: () => clock.date(),
    billing: {
      plans: {
        plan_pro: "pro",
        price_pro: "pro",
        "appstore:pro.monthly": "pro",
        "googleplay:pro.monthly": "pro",
      },
      graceMs: 0,
    },
  })
  const applied: { event: Event; result: unknown }[] = []
  const store = memoryStore()
  const gws = gateways(clock.now)
  const payments = createPayments({
    gateways: gws,
    db: store,
    onEvent: async (event) => {
      applied.push({ event, result: await ent.applyBillingEvent(event, { subject: "u1" }) })
    },
  })
  /** Deliver webhooks in order; returns each response's JSON. */
  const deliver = async (gateway: string, ...reqs: Request[]) => {
    const out: { received?: boolean; duplicate?: boolean; code?: string; status: number }[] = []
    for (const r of reqs) {
      const res = await payments.handleWebhook(gateway, r)
      out.push({ ...(await res.json()), status: res.status })
    }
    return out
  }
  const plan = async () => (await ent.get("u1")).plan
  const bal = (account: string, currency: string) => store.balance(account, currency)
  return { clock, ent, store, payments, deliver, plan, bal, applied, gws }
}
