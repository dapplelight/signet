/**
 * Where the webhook inbox, payment records and ledger live. `memoryStore()` for
 * tests; `sqlStore(client, { dialect })` for SQLite, Cloudflare D1 or Postgres
 * (including a signet-db database), with tables from `paymentsSchema(dialect)`.
 *
 * The SQL client is structural, one function, so any driver fits:
 *
 * ```ts
 * sqlStore({ query: (s, p) => sqlite.query(s).all(...p) }, { dialect: "sqlite" })      // bun:sqlite
 * sqlStore({ query: async (s, p) => (await env.DB.prepare(s).bind(...p).all()).results }, { dialect: "sqlite" }) // D1
 * sqlStore({ query: (s, p) => sql.unsafe(s, p) }, { dialect: "pg" })                    // postgres-js
 * ```
 *
 * Amounts are integer columns; dates are epoch milliseconds, so both dialects
 * read the same. Every multi-row write is one statement, so it is atomic
 * without a transaction (D1 has none).
 */

import type { Event, PaymentStatus } from "./types.js"

export type Actor = { type: "user" | "agent" | "system"; id: string }

export type StoredEvent = Event & {
  status: "pending" | "processed" | "failed"
  attempts: number
  error?: string
  receivedAt: Date
  actor?: Actor
}

export type PaymentRecord = {
  gateway: string
  gatewayId: string
  status: PaymentStatus
  amount: number
  currency: string
  amountRefunded: number
  fee?: number
  customerId?: string
  /** Your user the payment belongs to: agent tools scope on it. */
  userId?: string
  reference?: string
  orderId?: string
  /** occurredAt of the newest event applied, so an older one never wins. */
  lastEventAt?: Date
  createdAt: Date
  updatedAt: Date
}

/** One leg of a ledger transaction. Debits are positive, credits negative. */
export type LedgerEntry = {
  txId: string
  seq: number
  account: string
  amount: number
  currency: string
  kind: string
  gateway?: string
  /** The payment (gatewayId) the entry is about. */
  ref?: string
  at: Date
}

export type PaymentQuery = {
  gateway?: string
  userId?: string
  status?: PaymentStatus
  limit: number
  offset?: number
}

export type PaymentsStore = {
  /** Insert unless (gateway, id) exists. Returns false for a duplicate. */
  addEvent(event: Event, extra?: { actor?: Actor }): Promise<boolean>
  getEvent(gateway: string, id: string): Promise<StoredEvent | undefined>
  /** Pending events, oldest occurredAt first. */
  pendingEvents(limit: number): Promise<StoredEvent[]>
  setEventStatus(
    gateway: string,
    id: string,
    status: StoredEvent["status"],
    error?: string,
  ): Promise<void>
  eventsFor(gateway: string, paymentId: string): Promise<StoredEvent[]>
  savePayment(p: PaymentRecord): Promise<void>
  getPayment(gateway: string, gatewayId: string): Promise<PaymentRecord | undefined>
  /** A record created at checkout under an order id or your reference. */
  findLinked(
    gateway: string,
    link: { orderId?: string; reference?: string },
  ): Promise<PaymentRecord | undefined>
  renamePayment(gateway: string, from: string, to: string): Promise<void>
  listPayments(q: PaymentQuery): Promise<PaymentRecord[]>
  /** Insert all entries of one transaction atomically. Returns false if txId exists. */
  post(entries: LedgerEntry[]): Promise<boolean>
  entries(q: {
    ref?: string
    account?: string
    gateway?: string
    from?: Date
    to?: Date
  }): Promise<LedgerEntry[]>
  balance(account: string, currency: string): Promise<number>
}

// ---------------------------------------------------------------- memory

export function memoryStore(): PaymentsStore {
  const events = new Map<string, StoredEvent>()
  const payments = new Map<string, PaymentRecord>()
  const ledger: LedgerEntry[] = []
  const k = (g: string, id: string) => `${g}\u0000${id}`
  const clone = <T>(v: T): T => structuredClone(v)
  return {
    async addEvent(e, extra = {}) {
      if (events.has(k(e.gateway, e.id))) return false
      events.set(k(e.gateway, e.id), {
        ...clone(e),
        status: "pending",
        attempts: 0,
        receivedAt: new Date(),
        ...(extra.actor ? { actor: extra.actor } : {}),
      })
      return true
    },
    async getEvent(g, id) {
      const e = events.get(k(g, id))
      return e && clone(e)
    },
    async pendingEvents(limit) {
      return [...events.values()]
        .filter((e) => e.status === "pending")
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
        .slice(0, limit)
        .map(clone)
    },
    async setEventStatus(g, id, status, error) {
      const e = events.get(k(g, id))
      if (!e) return
      e.status = status
      e.error = error
      if (status !== "pending") e.attempts++
    },
    async eventsFor(g, pid) {
      return [...events.values()]
        .filter((e) => e.gateway === g && e.paymentId === pid)
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
        .map(clone)
    },
    async savePayment(p) {
      payments.set(k(p.gateway, p.gatewayId), clone(p))
    },
    async getPayment(g, id) {
      const p = payments.get(k(g, id))
      return p && clone(p)
    },
    async findLinked(g, { orderId, reference }) {
      const p = [...payments.values()].find(
        (p) =>
          p.gateway === g &&
          ((orderId && p.orderId === orderId) || (reference && p.reference === reference)),
      )
      return p && clone(p)
    },
    async renamePayment(g, from, to) {
      const p = payments.get(k(g, from))
      if (!p) return
      payments.delete(k(g, from))
      payments.set(k(g, to), { ...p, gatewayId: to })
    },
    async listPayments(q) {
      return [...payments.values()]
        .filter(
          (p) =>
            (!q.gateway || p.gateway === q.gateway) &&
            (!q.userId || p.userId === q.userId) &&
            (!q.status || p.status === q.status),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(q.offset ?? 0, (q.offset ?? 0) + q.limit)
        .map(clone)
    },
    async post(entries) {
      const tx = entries[0]?.txId
      if (!tx || ledger.some((e) => e.txId === tx)) return false
      ledger.push(...entries.map(clone))
      return true
    },
    async entries(q) {
      return ledger
        .filter(
          (e) =>
            (!q.ref || e.ref === q.ref) &&
            (!q.account || e.account === q.account) &&
            (!q.gateway || e.gateway === q.gateway) &&
            (!q.from || e.at >= q.from) &&
            (!q.to || e.at < q.to),
        )
        .map(clone)
    },
    async balance(account, currency) {
      return ledger
        .filter((e) => e.account === account && e.currency === currency)
        .reduce((s, e) => s + e.amount, 0)
    },
  }
}

// ---------------------------------------------------------------- sql

export type SqlClient = {
  /** Run one statement with positional parameters; return its rows (or [] for none). */
  query(
    sql: string,
    params: unknown[],
  ): Promise<Record<string, unknown>[]> | Record<string, unknown>[]
}

export type Dialect = "sqlite" | "pg"

/** CREATE TABLE / INDEX statements for the three tables. Run them in a migration. */
export function paymentsSchema(dialect: Dialect): string[] {
  const big = dialect === "pg" ? "BIGINT" : "INTEGER"
  return [
    `CREATE TABLE IF NOT EXISTS pay_events (
  gateway TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, payment_id TEXT,
  occurred_at ${big} NOT NULL, received_at ${big} NOT NULL, status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, body TEXT NOT NULL,
  PRIMARY KEY (gateway, id))`,
    "CREATE INDEX IF NOT EXISTS pay_events_pending ON pay_events (status, occurred_at)",
    "CREATE INDEX IF NOT EXISTS pay_events_payment ON pay_events (gateway, payment_id)",
    `CREATE TABLE IF NOT EXISTS pay_payments (
  gateway TEXT NOT NULL, gateway_id TEXT NOT NULL, status TEXT NOT NULL,
  amount ${big} NOT NULL, currency TEXT NOT NULL, amount_refunded ${big} NOT NULL DEFAULT 0,
  fee ${big}, customer_id TEXT, user_id TEXT, reference TEXT, order_id TEXT,
  last_event_at ${big}, created_at ${big} NOT NULL, updated_at ${big} NOT NULL,
  PRIMARY KEY (gateway, gateway_id))`,
    "CREATE INDEX IF NOT EXISTS pay_payments_user ON pay_payments (user_id, created_at)",
    "CREATE INDEX IF NOT EXISTS pay_payments_link ON pay_payments (gateway, order_id)",
    `CREATE TABLE IF NOT EXISTS pay_ledger (
  tx_id TEXT NOT NULL, seq INTEGER NOT NULL, account TEXT NOT NULL, amount ${big} NOT NULL,
  currency TEXT NOT NULL, kind TEXT NOT NULL, gateway TEXT, ref TEXT, at ${big} NOT NULL,
  PRIMARY KEY (tx_id, seq))`,
    "CREATE INDEX IF NOT EXISTS pay_ledger_ref ON pay_ledger (ref)",
    "CREATE INDEX IF NOT EXISTS pay_ledger_account ON pay_ledger (account, currency)",
  ]
}

type Row = Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined ? undefined : Number(v))
const date = (v: unknown) => (v === null || v === undefined ? undefined : new Date(Number(v)))
const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v))

const reviveEvent = (r: Row): StoredEvent => {
  const b = JSON.parse(String(r.body))
  return {
    ...b,
    occurredAt: new Date(Number(r.occurred_at)),
    receivedAt: new Date(Number(r.received_at)),
    status: r.status as StoredEvent["status"],
    attempts: Number(r.attempts),
    ...(r.error ? { error: String(r.error) } : {}),
  }
}

const revivePayment = (r: Row): PaymentRecord => {
  const p: PaymentRecord = {
    gateway: String(r.gateway),
    gatewayId: String(r.gateway_id),
    status: r.status as PaymentStatus,
    amount: Number(r.amount),
    currency: String(r.currency),
    amountRefunded: Number(r.amount_refunded),
    createdAt: new Date(Number(r.created_at)),
    updatedAt: new Date(Number(r.updated_at)),
  }
  const opt = {
    fee: num(r.fee),
    customerId: str(r.customer_id),
    userId: str(r.user_id),
    reference: str(r.reference),
    orderId: str(r.order_id),
    lastEventAt: date(r.last_event_at),
  }
  for (const [key, v] of Object.entries(opt)) if (v !== undefined) (p as Row)[key] = v
  return p
}

const reviveEntry = (r: Row): LedgerEntry => ({
  txId: String(r.tx_id),
  seq: Number(r.seq),
  account: String(r.account),
  amount: Number(r.amount),
  currency: String(r.currency),
  kind: String(r.kind),
  ...(r.gateway ? { gateway: String(r.gateway) } : {}),
  ...(r.ref ? { ref: String(r.ref) } : {}),
  at: new Date(Number(r.at)),
})

export function sqlStore(client: SqlClient, options: { dialect: Dialect }): PaymentsStore {
  const pg = options.dialect === "pg"
  const q = async (sql: string, params: unknown[] = []): Promise<Row[]> => {
    let i = 0
    const text = pg ? sql.replace(/\?/g, () => `$${++i}`) : sql
    return (await client.query(text, params)) ?? []
  }
  const where = (parts: [string, unknown][]) => {
    const used = parts.filter(([, v]) => v !== undefined)
    return {
      sql: used.length ? ` WHERE ${used.map(([c]) => c).join(" AND ")}` : "",
      params: used.map(([, v]) => v),
    }
  }
  return {
    async addEvent(e, extra = {}) {
      const { occurredAt: _o, ...body } = e
      const rows = await q(
        "INSERT INTO pay_events (gateway, id, type, payment_id, occurred_at, received_at, status, attempts, body) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?) ON CONFLICT DO NOTHING RETURNING id",
        [
          e.gateway,
          e.id,
          e.type,
          e.paymentId ?? null,
          e.occurredAt.getTime(),
          Date.now(),
          JSON.stringify({ ...body, ...(extra.actor ? { actor: extra.actor } : {}) }),
        ],
      )
      return rows.length > 0
    },
    async getEvent(g, id) {
      const [r] = await q("SELECT * FROM pay_events WHERE gateway = ? AND id = ?", [g, id])
      return r && reviveEvent(r)
    },
    async pendingEvents(limit) {
      return (
        await q(
          "SELECT * FROM pay_events WHERE status = 'pending' ORDER BY occurred_at, id LIMIT ?",
          [limit],
        )
      ).map(reviveEvent)
    },
    async setEventStatus(g, id, status, error) {
      await q(
        `UPDATE pay_events SET status = ?, error = ?, attempts = attempts + ${status === "pending" ? 0 : 1} WHERE gateway = ? AND id = ?`,
        [status, error ?? null, g, id],
      )
    },
    async eventsFor(g, pid) {
      return (
        await q(
          "SELECT * FROM pay_events WHERE gateway = ? AND payment_id = ? ORDER BY occurred_at, id",
          [g, pid],
        )
      ).map(reviveEvent)
    },
    async savePayment(p) {
      const cols = [
        "gateway",
        "gateway_id",
        "status",
        "amount",
        "currency",
        "amount_refunded",
        "fee",
        "customer_id",
        "user_id",
        "reference",
        "order_id",
        "last_event_at",
        "created_at",
        "updated_at",
      ]
      const vals = [
        p.gateway,
        p.gatewayId,
        p.status,
        p.amount,
        p.currency,
        p.amountRefunded,
        p.fee ?? null,
        p.customerId ?? null,
        p.userId ?? null,
        p.reference ?? null,
        p.orderId ?? null,
        p.lastEventAt?.getTime() ?? null,
        p.createdAt.getTime(),
        p.updatedAt.getTime(),
      ]
      await q(
        `INSERT INTO pay_payments (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT (gateway, gateway_id) DO UPDATE SET ${cols
          .slice(2)
          .map((c) => `${c} = excluded.${c}`)
          .join(", ")}`,
        vals,
      )
    },
    async getPayment(g, id) {
      const [r] = await q("SELECT * FROM pay_payments WHERE gateway = ? AND gateway_id = ?", [
        g,
        id,
      ])
      return r && revivePayment(r)
    },
    async findLinked(g, { orderId, reference }) {
      if (!orderId && !reference) return undefined
      const [r] = await q(
        "SELECT * FROM pay_payments WHERE gateway = ? AND (order_id = ? OR reference = ?) LIMIT 1",
        [g, orderId ?? null, reference ?? null],
      )
      return r && revivePayment(r)
    },
    async renamePayment(g, from, to) {
      await q("UPDATE pay_payments SET gateway_id = ? WHERE gateway = ? AND gateway_id = ?", [
        to,
        g,
        from,
      ])
    },
    async listPayments(f) {
      const w = where([
        ["gateway = ?", f.gateway],
        ["user_id = ?", f.userId],
        ["status = ?", f.status],
      ])
      return (
        await q(`SELECT * FROM pay_payments${w.sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [
          ...w.params,
          f.limit,
          f.offset ?? 0,
        ])
      ).map(revivePayment)
    },
    async post(entries) {
      if (!entries.length) return false
      const rows = await q(
        `INSERT INTO pay_ledger (tx_id, seq, account, amount, currency, kind, gateway, ref, at) VALUES ${entries.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")} ON CONFLICT DO NOTHING RETURNING tx_id`,
        entries.flatMap((e) => [
          e.txId,
          e.seq,
          e.account,
          e.amount,
          e.currency,
          e.kind,
          e.gateway ?? null,
          e.ref ?? null,
          e.at.getTime(),
        ]),
      )
      return rows.length > 0
    },
    async entries(f) {
      const w = where([
        ["ref = ?", f.ref],
        ["account = ?", f.account],
        ["gateway = ?", f.gateway],
        ["at >= ?", f.from?.getTime()],
        ["at < ?", f.to?.getTime()],
      ])
      return (await q(`SELECT * FROM pay_ledger${w.sql} ORDER BY at, tx_id, seq`, w.params)).map(
        reviveEntry,
      )
    },
    async balance(account, currency) {
      const [r] = await q(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM pay_ledger WHERE account = ? AND currency = ?",
        [account, currency],
      )
      const n = Number(r?.total ?? 0)
      if (!Number.isSafeInteger(n))
        throw new Error(`Balance of ${account} is past 2^53 minor units.`)
      return n
    },
  }
}
