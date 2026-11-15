/**
 * DPDP building blocks (India's Digital Personal Data Protection Act, 2023)
 * on the tables from `privacyTables()`: consent records per purpose and
 * notice version, withdrawal, and data-export and erasure requests that run
 * `exportUser` / `deleteUser` when fulfilled.
 *
 * ```ts
 * const privacy = createPrivacy(db, { tables: privacyTables(), userTables: [notes, [users, users.id]] })
 * await privacy.give(userId, "marketing-email", { noticeVersion: "2026-11-01", source: "signup" })
 * await privacy.has(userId, "marketing-email")          // true
 * await privacy.withdraw(userId, "marketing-email")     // as easy as giving it
 * const req = await privacy.requestErasure(userId)
 * await privacy.fulfil(req.id, { actor: { type: "user", id: staffId } })
 * ```
 *
 * Records are append-only: withdrawing sets `withdrawnAt`, giving again adds
 * a row, so the history shows what was agreed, to which notice, and when.
 * This is record-keeping, not legal advice: response deadlines, what to keep
 * after erasure and the notice text are the app's call.
 */

import { and, desc, eq, isNull, lt, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import type { Actor } from "./scoped.js"
import { deleteUser, exportUser, type UserTable } from "./user-data.js"

export { type PrivacyToolsOptions, privacyTools } from "./privacy-tools.js"

export type PrivacyTables = { consents: Table; dataRequests: Table }

export type PrivacyOptions = {
  tables: PrivacyTables
  /** The tables `fulfil` exports from and erases, children before parents. */
  userTables?: readonly UserTable[]
  /** Sets `dueAt` on new requests. No default: the deadline is yours to set. */
  respondWithinMs?: number
  /** Clock, for tests. */
  now?: () => Date
}

export type Consent = {
  id: string
  subject: string
  purpose: string
  noticeVersion: string
  source: string | null
  givenAt: Date
  withdrawnAt: Date | null
}

export type DataRequestKind = "export" | "erasure"
export type DataRequestStatus = "pending" | "completed" | "rejected"

export type DataRequest = {
  id: string
  subject: string
  kind: DataRequestKind
  status: DataRequestStatus
  requestedAt: Date
  dueAt: Date | null
  closedAt: Date | null
  closedBy: string | null
  note: string | null
  result: unknown
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: privacy columns are known by name
type Cols = Record<string, any>

const bad = (msg: string) => new SignetDbError("BAD_INPUT", msg)
const need = (v: string, what: string) => {
  if (typeof v !== "string" || !v) throw bad(`${what} is required.`)
  return v
}

export function createPrivacy(db: SignetDb<unknown>, options: PrivacyOptions) {
  const o = db.orm as AnyOrm
  const T = options.tables
  const C = T.consents as unknown as Cols
  const D = T.dataRequests as unknown as Cols
  const now = options.now ?? (() => new Date())

  const toConsent = (r: Cols): Consent => ({
    id: r.id,
    subject: r.subject,
    purpose: r.purpose,
    noticeVersion: r.noticeVersion,
    source: r.source ?? null,
    givenAt: r.givenAt,
    withdrawnAt: r.withdrawnAt ?? null,
  })
  const toRequest = (r: Cols): DataRequest => ({
    id: r.id,
    subject: r.subject,
    kind: r.kind,
    status: r.status,
    requestedAt: r.requestedAt,
    dueAt: r.dueAt ?? null,
    closedAt: r.closedAt ?? null,
    closedBy: r.closedBy ?? null,
    note: r.note ?? null,
    result: r.result ?? null,
  })

  const activeOf = async (subject: string, purpose?: string): Promise<Consent[]> =>
    (
      await o
        .select()
        .from(T.consents)
        .where(
          and(
            eq(C.subject, subject),
            isNull(C.withdrawnAt),
            purpose === undefined ? undefined : eq(C.purpose, purpose),
          ),
        )
        .orderBy(desc(C.givenAt), desc(C.id))
    ).map(toConsent)

  async function withdraw(subject: string, purpose?: string): Promise<number> {
    const rows = await o
      .update(T.consents)
      .set({ withdrawnAt: now() })
      .where(
        and(
          eq(C.subject, need(subject, "subject")),
          isNull(C.withdrawnAt),
          purpose === undefined ? undefined : eq(C.purpose, purpose),
        ),
      )
      .returning()
    return rows.length
  }

  async function request(subject: string, kind: DataRequestKind): Promise<DataRequest> {
    need(subject, "subject")
    const [open] = await o
      .select()
      .from(T.dataRequests)
      .where(and(eq(D.subject, subject), eq(D.kind, kind), eq(D.status, "pending")))
    if (open) return toRequest(open)
    const at = now()
    const [row] = await o
      .insert(T.dataRequests)
      .values({
        subject,
        kind,
        status: "pending",
        requestedAt: at,
        dueAt: options.respondWithinMs ? new Date(at.getTime() + options.respondWithinMs) : null,
      })
      .returning()
    return toRequest(row)
  }

  async function pending(id: string): Promise<DataRequest> {
    const [row] = await o.select().from(T.dataRequests).where(eq(D.id, id))
    if (!row) throw new SignetDbError("NOT_FOUND", `No data request ${id}.`)
    const r = toRequest(row)
    if (r.status !== "pending") throw bad(`Data request ${id} is already ${r.status}.`)
    return r
  }

  async function close(
    id: string,
    status: "completed" | "rejected",
    actor: Actor,
    extra: { note?: string; result?: unknown },
  ): Promise<DataRequest> {
    const [row] = await o
      .update(T.dataRequests)
      .set({
        status,
        closedAt: now(),
        closedBy: `${actor.type}:${actor.id}`,
        note: extra.note ?? null,
        result: extra.result ?? null,
      })
      .where(and(eq(D.id, id), eq(D.status, "pending")))
      .returning()
    if (!row) throw bad(`Data request ${id} was closed by someone else.`)
    return toRequest(row)
  }

  return {
    tables: T,

    /** Record consent to `purpose` under `noticeVersion`. Already active for that version: returns it. */
    async give(
      subject: string,
      purpose: string,
      opts: { noticeVersion: string; source?: string },
    ): Promise<Consent> {
      need(subject, "subject")
      need(purpose, "purpose")
      need(opts?.noticeVersion, "noticeVersion")
      const same = (await activeOf(subject, purpose)).find(
        (c) => c.noticeVersion === opts.noticeVersion,
      )
      if (same) return same
      const [row] = await o
        .insert(T.consents)
        .values({
          subject,
          purpose,
          noticeVersion: opts.noticeVersion,
          source: opts.source ?? null,
          givenAt: now(),
        })
        .returning()
      return toConsent(row)
    },
    /** Withdraw consent to `purpose` (or every purpose). Returns how many records closed. */
    withdraw,
    /** Whether consent to `purpose` is in force; with `noticeVersion`, to that notice. */
    async has(
      subject: string,
      purpose: string,
      opts: { noticeVersion?: string } = {},
    ): Promise<boolean> {
      const list = await activeOf(subject, purpose)
      return opts.noticeVersion === undefined
        ? list.length > 0
        : list.some((c) => c.noticeVersion === opts.noticeVersion)
    },
    /** Consents in force, newest first. */
    active: (subject: string) => activeOf(subject),
    /** Every record, withdrawn ones included, newest first. */
    async history(subject: string): Promise<Consent[]> {
      const rows: Cols[] = await o
        .select()
        .from(T.consents)
        .where(eq(C.subject, subject))
        .orderBy(desc(C.givenAt), desc(C.id))
      return rows.map(toConsent)
    },

    /** Open an export request; an open one of the same kind is returned instead. */
    requestExport: (subject: string) => request(subject, "export"),
    /** Open an erasure request; an open one of the same kind is returned instead. */
    requestErasure: (subject: string) => request(subject, "erasure"),
    async listRequests(
      opts: { subject?: string; status?: DataRequestStatus; kind?: DataRequestKind } = {},
    ): Promise<DataRequest[]> {
      const conds = [
        opts.subject !== undefined ? eq(D.subject, opts.subject) : undefined,
        opts.status ? eq(D.status, opts.status) : undefined,
        opts.kind ? eq(D.kind, opts.kind) : undefined,
      ].filter(Boolean)
      const rows: Cols[] = await o
        .select()
        .from(T.dataRequests)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(D.requestedAt), desc(D.id))
      return rows.map(toRequest)
    },
    /** Pending requests past `dueAt`. */
    async overdue(): Promise<DataRequest[]> {
      const rows: Cols[] = await o
        .select()
        .from(T.dataRequests)
        .where(and(eq(D.status, "pending"), lt(D.dueAt, now())))
      return rows.map(toRequest)
    },
    /**
     * Carry out a pending request. Export returns the data (send it to the
     * person; it is not stored). Erasure deletes `userTables` rows with
     * `deleteUser`, withdraws every consent, and stores the row counts.
     */
    async fulfil(
      id: string,
      opts: { actor: Actor },
    ): Promise<{ request: DataRequest; data?: Record<string, Record<string, unknown>[]> }> {
      const tables = options.userTables
      if (!tables?.length)
        throw bad("createPrivacy needs userTables to fulfil export and erasure requests.")
      const r = await pending(id)
      if (r.kind === "export") {
        const data = await exportUser(db, r.subject, tables)
        return { request: await close(id, "completed", opts.actor, {}), data }
      }
      const counts = await deleteUser(db, r.subject, tables, { actor: opts.actor })
      await withdraw(r.subject)
      return { request: await close(id, "completed", opts.actor, { result: counts }) }
    },
    /** Close a pending request without acting, with the reason given to the person. */
    async reject(id: string, opts: { actor: Actor; reason: string }): Promise<DataRequest> {
      need(opts?.reason, "reason")
      await pending(id)
      return close(id, "rejected", opts.actor, { note: opts.reason })
    },
  }
}

export type Privacy = ReturnType<typeof createPrivacy>
