/**
 * Record collaboration for org apps: comment threads with @mentions on any
 * record, a per-record activity timeline (audit log plus comments), and
 * version history with diff, restore and undo.
 *
 * ```ts
 * export const { comments, recordVersions } = collabTables()
 * const db = createDb(env.DB, { audit, versions: { table: recordVersions, track: [tasks] } })
 * const collab = createCollab(db, {
 *   tables: { comments },
 *   records: { tasks },                    // what can be commented on, by name
 *   orgs,                                  // createOrgs(...)
 *   people: (ids) => usersById(ids),       // names for mentions and the timeline
 *   notify: (to, m) => notifier.notify(to, "comment.mention", m, { idempotencyKey: m.key }),
 * })
 * const who = { orgId, userId }
 * await collab.addComment(who, { table: "tasks", id }, { body: "Ready, @[Asha](user:u_1)?" })
 * await collab.timeline(who, { table: "tasks", id })     // { items, nextCursor }
 * await collab.undo(who, { table: "tasks", id }, { expected: 4 })
 * ```
 *
 * Safe by default:
 * - Deny by default: only tables named in `records` exist, each must have an
 *   `orgId` column, and a record of another org, or any record for a
 *   non-member, reads as not found.
 * - Reading and commenting need membership; restore and undo need the
 *   `<record>:write` permission (`tasks:write`). `access` replaces that rule.
 *   Editing a comment is its author's; deleting is the author's or needs
 *   `comments:moderate`.
 * - Mentions are stable user ids in the text (`@[Name](user:<id>)`), kept
 *   only for org members. Each person is notified once per comment, however
 *   often it is edited.
 * - Comment writes, restores and undos are audited when the db has an audit table.
 */

import { and, asc, desc, eq, getTableName, isNull, lt, type SQL, type Table } from "drizzle-orm"
import { decryptRows } from "./crypt.js"
import { columnsOf, encryptedKeys, type SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import { newId } from "./id.js"
import { hasPermission, OrgError } from "./orgs.js"
import { isTracked, primaryKeyOf, snapshot } from "./versions.js"

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: collab columns are known by name
type Cols = Record<string, any>
type Rec = Record<string, unknown>

// ------------------------------------------------------------------ mentions

/** `@[Name](user:<id>)`: the display name is for reading, the id is what counts. */
export const MENTION_PATTERN = /@\[([^\]\n]{1,100})\]\(user:([A-Za-z0-9_.:-]{1,80})\)/g

/** The user ids mentioned in `text`, first mention first, each once. */
export function parseMentions(text: string): string[] {
  const ids: string[] = []
  for (const m of String(text).matchAll(MENTION_PATTERN))
    if (m[2] && !ids.includes(m[2])) ids.push(m[2])
  return ids
}

/** The token a mention picker inserts. Brackets in the name are dropped. */
export function mentionToken(id: string, name: string): string {
  return `@[${
    String(name)
      .replace(/[[\]\n]/g, "")
      .slice(0, 100) || id
  }](user:${id})`
}

// --------------------------------------------------------------------- types

/** A record, by its name in `records` and its primary key. */
export type RecordRef = { table: string; id: string }
/** The caller: the tenant and the signed-in user. */
export type Who = { orgId: string; userId: string }

export type Person = { id: string; name: string; email?: string | null; image?: string | null }
export type Actor = { type: string; id: string; name: string }

export type Comment = {
  id: string
  table: string
  rowId: string
  /** The thread's first comment; null when this is it. */
  parentId: string | null
  author: Person
  /** Empty once deleted. */
  body: string
  mentions: string[]
  createdAt: Date
  editedAt: Date | null
  deleted: boolean
}
export type Thread = Comment & { replies: Comment[] }

/** What `notify` gets for each newly mentioned person. */
export type Mention = {
  to: string
  by: string
  byName: string
  orgId: string
  table: string
  rowId: string
  commentId: string
  /** The comment's text with mentions shown as `@Name`, cut to 200 characters. */
  excerpt: string
  /** `mention:<commentId>:<to>`: pass as the notifier's idempotencyKey. */
  key: string
}

export type FieldChange = {
  field: string
  from: unknown
  to: unknown
  /** An encrypted field: it changed, its values are not shown. */
  hidden?: true
}

export type TimelineItem =
  | {
      kind: "change"
      id: string
      at: Date
      actor: Actor
      /** created | updated | deleted | restored | undone, or the audit action as written. */
      action: string
      changes: FieldChange[]
      summary: string
    }
  | { kind: "comment"; id: string; at: Date; actor: Actor; comment: Comment; summary: string }

/** A timeline item before `describe` adds its summary. */
export type TimelineDraft = {
  [K in TimelineItem["kind"]]: Omit<Extract<TimelineItem, { kind: K }>, "summary">
}[TimelineItem["kind"]]

export type RecordVersion = {
  version: number
  /** insert | update | delete | restore | undo */
  action: string
  actor: Actor
  at: Date
  /** What changed from the version before it. */
  changes: FieldChange[]
}

export type AccessCheck = Who & {
  table: string
  id: string
  need: "read" | "write"
  permissions: string[]
  row: Rec
}

export type CollabOptions = {
  tables: { comments: Table }
  /** The tables people can comment on and see history of, by name. Each needs an `orgId` column. */
  records: Record<string, Table>
  /** signet-db's `createOrgs(...)`, or anything with these two. */
  orgs: {
    membership(orgId: string, userId: string): Promise<{ permissions: string[] } | null>
    members(orgId: string): Promise<{ userId: string }[]>
  }
  /** Names (and email, image) for people by id. Default: the id is the name. */
  people?: (
    ids: string[],
  ) => Promise<
    Record<string, { name?: string | null; email?: string | null; image?: string | null }>
  >
  /** Tell a mentioned person. A throw is ignored. */
  notify?: (to: string, mention: Mention) => unknown
  /**
   * Who may read (and comment on) or write (restore, undo) a record, for a
   * member of its org. Default: read any member, write `<table>:write`.
   */
  access?: (check: AccessCheck) => boolean | Promise<boolean>
  /** The timeline's one-line text. Default `describeItem`. */
  describe?: (item: TimelineDraft) => string
  /** Clock, for tests. */
  now?: () => Date
}

// ------------------------------------------------------------------- helpers

const bad = (m: string) => new OrgError(400, "BAD_INPUT", m)
const notFound = (m = "No such record.") => new OrgError(404, "NOT_FOUND", m)
const forbidden = (m: string) => new OrgError(403, "FORBIDDEN", m)
const conflict = (m: string) => new OrgError(409, "CONFLICT", m)

const ACTIONS: Record<string, string> = {
  insert: "created",
  update: "updated",
  delete: "deleted",
  restore: "restored",
  undo: "undone",
}
/** Never diffed: keys and bookkeeping. */
const QUIET = new Set(["orgId", "userId", "createdAt", "updatedAt", "deletedAt"])
const MAX_BODY = 10_000
const MAX_MENTIONS = 20

const plain = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)))
const same = (a: unknown, b: unknown) => JSON.stringify(plain(a)) === JSON.stringify(plain(b))

/** "dueDate" → "due date". */
export const fieldLabel = (key: string) =>
  key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()

const valueText = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v)
  return s.length > 60 ? `${s.slice(0, 59)}…` : s
}

const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`

/** "Asha changed status to Done": the default one-line text of a timeline item. */
export function describeItem(item: TimelineDraft): string {
  const who = item.actor.name
  if (item.kind === "comment") return `${who} commented`
  if (item.action === "created") return `${who} created this`
  if (item.action === "deleted") return `${who} deleted this`
  if (item.action === "restored") return `${who} restored an earlier version`
  if (item.action === "undone") return `${who} undid the last change`
  const cs = item.changes
  if (cs.length === 0) return `${who} saved this`
  if (cs.length === 1) {
    const c = cs[0] as FieldChange
    const f = fieldLabel(c.field)
    if (c.hidden) return `${who} changed ${f}`
    if (c.to === null || c.to === "") return `${who} cleared ${f}`
    return `${who} changed ${f} to ${valueText(c.to)}`
  }
  const names = cs.map((c) => fieldLabel(c.field))
  return names.length > 3
    ? `${who} changed ${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
    : `${who} changed ${list(names)}`
}

/** Field-by-field changes from `before` to `after`, both stored rows of `table`. */
export function diffRows(table: Table, before: Rec | null, after: Rec | null): FieldChange[] {
  const pk = primaryKeyOf(table)
  const secret = new Set(encryptedKeys(table))
  const out: FieldChange[] = []
  for (const k of Object.keys(columnsOf(table))) {
    if (k === pk || QUIET.has(k)) continue
    const from = plain(before?.[k] ?? null)
    const to = plain(after?.[k] ?? null)
    if (same(from, to)) continue
    out.push(
      secret.has(k) ? { field: k, from: null, to: null, hidden: true } : { field: k, from, to },
    )
  }
  return out
}

// ------------------------------------------------------------------- engine

export function createCollab(db: SignetDb<unknown>, options: CollabOptions) {
  const o = db.orm as AnyOrm
  const C = options.tables.comments as unknown as Cols
  const commentsTable = options.tables.comments
  const now = options.now ?? (() => new Date())
  const describe = options.describe ?? describeItem
  const records = new Map<string, { table: Table; sqlName: string; pk: string }>()
  const bySqlName = new Map<string, string>()
  for (const [name, table] of Object.entries(options.records)) {
    const cols = columnsOf(table)
    const pk = primaryKeyOf(table)
    if (!cols.orgId || !pk)
      throw new SignetDbError(
        "BAD_CONFIG",
        `createCollab: records.${name} needs an orgId column and a primary key.`,
      )
    records.set(name, { table, sqlName: getTableName(table), pk })
    bySqlName.set(getTableName(table), name)
  }

  const people = async (ids: string[]): Promise<Map<string, Person>> => {
    const uniq = [...new Set(ids)]
    const found = uniq.length && options.people ? await options.people(uniq) : {}
    return new Map(
      uniq.map((id) => {
        const p = found[id]
        return [
          id,
          {
            id,
            name: p?.name || id,
            ...(p?.email !== undefined ? { email: p.email } : {}),
            ...(p?.image !== undefined ? { image: p.image } : {}),
          },
        ]
      }),
    )
  }

  const log = async (
    action: string,
    table: Table,
    rowId: string,
    who: Who,
    before: object | null,
    after: object | null,
  ) => {
    if (!db.audit) return
    await o.insert(db.audit).values({
      actorType: "user",
      actorId: who.userId,
      action,
      tableName: getTableName(table),
      rowId,
      before: before && plain(before),
      after: after && plain(after),
    })
  }

  /** The record, checked: it exists in the caller's org and the caller may `need` it. */
  const resolve = async (who: Who, ref: RecordRef, need: "read" | "write") => {
    if (!who?.orgId || !who.userId || !ref || typeof ref.id !== "string" || !ref.id)
      throw notFound()
    const rec = Object.hasOwn(options.records, ref.table) ? records.get(ref.table) : undefined
    if (!rec) throw notFound()
    const member = await options.orgs.membership(who.orgId, who.userId)
    if (!member) throw notFound()
    const T = rec.table as unknown as Cols
    const [row] = await o
      .select()
      .from(rec.table)
      .where(and(eq(T[rec.pk], ref.id), eq(T.orgId, who.orgId)))
      .limit(1)
    if (!row) throw notFound()
    const check: AccessCheck = { ...who, ...ref, need, permissions: member.permissions, row }
    const allowed = options.access
      ? await options.access(check)
      : need === "read" || hasPermission(member.permissions, `${ref.table}:write`)
    if (!allowed) {
      if (need === "read") throw notFound()
      throw forbidden("You cannot change this record.")
    }
    return { ...rec, name: ref.table, row: row as Rec, member }
  }

  const mentionsFor = async (who: Who, body: string) => {
    const ids = parseMentions(body).filter((id) => id !== who.userId)
    if (ids.length > MAX_MENTIONS) throw bad(`Mention at most ${MAX_MENTIONS} people at once.`)
    if (!ids.length) return []
    const members = new Set((await options.orgs.members(who.orgId)).map((m) => m.userId))
    return ids.filter((id) => members.has(id))
  }

  const cleanBody = (body: unknown) => {
    if (typeof body !== "string" || !body.trim()) throw bad("body is required.")
    if (body.length > MAX_BODY) throw bad(`body must be at most ${MAX_BODY} characters.`)
    return body.trim()
  }

  const toComment = (r: Cols, who: Map<string, Person>): Comment => ({
    id: r.id,
    table: bySqlName.get(r.tableName) ?? r.tableName,
    rowId: r.rowId,
    parentId: r.parentId ?? null,
    author: who.get(r.authorId) ?? { id: r.authorId, name: r.authorId },
    body: r.deletedAt ? "" : r.body,
    mentions: r.deletedAt ? [] : parseMentions(r.body),
    createdAt: r.createdAt,
    editedAt: r.editedAt ?? null,
    deleted: !!r.deletedAt,
  })

  const tell = async (who: Who, rec: { name: string }, row: Cols, to: string[]) => {
    if (!options.notify || !to.length) return
    const by = (await people([who.userId])).get(who.userId) as Person
    const names = await people(parseMentions(row.body))
    const excerpt = String(row.body)
      .replace(MENTION_PATTERN, (_, name: string, id: string) => `@${names.get(id)?.name ?? name}`)
      .slice(0, 200)
    for (const id of to) {
      try {
        await options.notify(id, {
          to: id,
          by: who.userId,
          byName: by.name,
          orgId: who.orgId,
          table: rec.name,
          rowId: row.rowId,
          commentId: row.id,
          excerpt,
          key: `mention:${row.id}:${id}`,
        })
      } catch {}
    }
  }

  /** A comment of the caller's org, with its record checked for read access. */
  const ownComment = async (who: Who, id: string) => {
    if (!who?.orgId || typeof id !== "string" || !id) throw notFound("No such comment.")
    const [row] = (await o
      .select()
      .from(commentsTable)
      .where(and(eq(C.id, id), eq(C.orgId, who.orgId)))
      .limit(1)) as Cols[]
    if (!row || row.deletedAt) throw notFound("No such comment.")
    const name = bySqlName.get(row.tableName)
    if (!name) throw notFound("No such comment.")
    const rec = await resolve(who, { table: name, id: row.rowId }, "read")
    return { row, rec }
  }

  // ------------------------------------------------------------- versions

  const V = () => {
    if (!db.versions)
      throw new SignetDbError(
        "BAD_CONFIG",
        "Version history needs createDb(..., { versions: { table: recordVersions, track: [...] } }).",
      )
    return db.versions.table as unknown as Cols
  }
  const versionRows = async (rec: { sqlName: string }, id: string, where?: SQL, limit = 50) =>
    (await o
      .select()
      .from(db.versions?.table)
      .where(and(eq(V().tableName, rec.sqlName), eq(V().rowId, id), where))
      .orderBy(desc(V().version))
      .limit(limit)) as Cols[]
  const actorsOf = async (rows: Cols[]) => {
    const names = await people(rows.filter((r) => r.actorType === "user").map((r) => r.actorId))
    return (r: Cols): Actor => ({
      type: r.actorType,
      id: r.actorId,
      name: names.get(r.actorId)?.name ?? r.actorId,
    })
  }

  /** Write `data` (a stored version) back over the record, then audit and snapshot it. */
  const writeBack = async (
    who: Who,
    rec: Awaited<ReturnType<typeof resolve>>,
    data: Rec,
    action: "restore" | "undo",
  ) => {
    if (!isTracked(db, rec.table))
      throw new SignetDbError("BAD_CONFIG", `${rec.name} is not in versions.track.`)
    const cols = columnsOf(rec.table)
    const values: Rec = {}
    for (const [k, col] of Object.entries(cols)) {
      if (k === rec.pk || k === "orgId" || k === "createdAt" || k === "updatedAt") continue
      if (!(k in data)) continue
      const v = data[k]
      values[k] = v != null && col.dataType === "date" ? new Date(v as string) : v
    }
    const T = rec.table as unknown as Cols
    const [raw] = await o
      .update(rec.table)
      .set(values)
      .where(and(eq(T[rec.pk], rec.row[rec.pk]), eq(T.orgId, who.orgId)))
      .returning()
    await log(action, rec.table, String(rec.row[rec.pk]), who, rec.row, raw)
    const [version] = await snapshot(db, rec.table, action, [raw], {
      type: "user",
      id: who.userId,
    })
    const [row] = await decryptRows(db, rec.table, [raw])
    return { version: version as number, row: row as Rec }
  }

  return {
    // ----------------------------------------------------------- comments

    /** Threads on a record, oldest first, each with its replies. Deleted comments with replies stay as placeholders. */
    async comments(who: Who, ref: RecordRef): Promise<Thread[]> {
      const rec = await resolve(who, ref, "read")
      // ponytail: one page of 1000 comments per record; paginate threads past that.
      const rows = (await o
        .select()
        .from(commentsTable)
        .where(and(eq(C.orgId, who.orgId), eq(C.tableName, rec.sqlName), eq(C.rowId, ref.id)))
        .orderBy(asc(C.createdAt), asc(C.id))
        .limit(1000)) as Cols[]
      const names = await people(rows.map((r) => r.authorId))
      const threads = new Map<string, Thread>()
      const replies: Comment[] = []
      for (const r of rows) {
        const c = toComment(r, names)
        if (c.parentId) replies.push(c)
        else threads.set(c.id, { ...c, replies: [] })
      }
      for (const c of replies) if (!c.deleted) threads.get(c.parentId as string)?.replies.push(c)
      return [...threads.values()].filter((t) => !t.deleted || t.replies.length > 0)
    },

    /** Comment on a record, or reply in a thread (`parentId`; a reply to a reply joins its thread). */
    async addComment(
      who: Who,
      ref: RecordRef,
      input: { body: string; parentId?: string | null },
    ): Promise<Comment> {
      const rec = await resolve(who, ref, "read")
      const body = cleanBody(input?.body)
      let parentId: string | null = null
      if (input.parentId) {
        const [p] = (await o
          .select()
          .from(commentsTable)
          .where(
            and(
              eq(C.id, input.parentId),
              eq(C.orgId, who.orgId),
              eq(C.tableName, rec.sqlName),
              eq(C.rowId, ref.id),
            ),
          )
          .limit(1)) as Cols[]
        if (!p) throw notFound("No such comment.")
        parentId = p.parentId ?? p.id
      }
      const mentions = await mentionsFor(who, body)
      const row = {
        id: newId(now().getTime()),
        orgId: who.orgId,
        tableName: rec.sqlName,
        rowId: ref.id,
        parentId,
        authorId: who.userId,
        body,
        notified: mentions,
        createdAt: now(),
      }
      await o.insert(commentsTable).values(row)
      await log("comment.create", commentsTable, row.id, who, null, {
        table: ref.table,
        rowId: ref.id,
        parentId,
        mentions,
      })
      await tell(who, rec, row, mentions)
      return toComment(row, await people([who.userId]))
    },

    /** Edit your own comment. People mentioned for the first time are notified; nobody twice. */
    async editComment(who: Who, id: string, input: { body: string }): Promise<Comment> {
      const { row, rec } = await ownComment(who, id)
      if (row.authorId !== who.userId) throw forbidden("Only its author can edit a comment.")
      const body = cleanBody(input?.body)
      const mentions = await mentionsFor(who, body)
      const before = (row.notified ?? []) as string[]
      const fresh = mentions.filter((m) => !before.includes(m))
      const set = { body, editedAt: now(), notified: [...before, ...fresh] }
      await o
        .update(commentsTable)
        .set(set)
        .where(and(eq(C.id, id), eq(C.orgId, who.orgId)))
      await log("comment.edit", commentsTable, id, who, { mentions: before }, { mentions })
      const next = { ...row, ...set }
      await tell(who, rec, next, fresh)
      return toComment(next, await people([row.authorId]))
    },

    /** Delete a comment (soft: its text is cleared). Its author, or `comments:moderate`. */
    async deleteComment(who: Who, id: string): Promise<void> {
      const { row, rec } = await ownComment(who, id)
      if (
        row.authorId !== who.userId &&
        !hasPermission(rec.member.permissions, "comments:moderate")
      )
        throw forbidden("Only its author or a moderator can delete a comment.")
      await o
        .update(commentsTable)
        .set({ body: "", deletedAt: now() })
        .where(and(eq(C.id, id), eq(C.orgId, who.orgId)))
      await log("comment.delete", commentsTable, id, who, { authorId: row.authorId }, null)
    },

    /** Org members to mention, matching `query` on name, email or id. Members only. */
    async mentionable(who: Who, query = "", limit = 8): Promise<Person[]> {
      if (!who?.orgId || !who.userId || !(await options.orgs.membership(who.orgId, who.userId)))
        throw notFound("Organisation not found.")
      const members = await options.orgs.members(who.orgId)
      const names = await people(members.map((m) => m.userId))
      const q = String(query).trim().toLowerCase()
      return [...names.values()]
        .filter(
          (p) =>
            !q ||
            p.name.toLowerCase().includes(q) ||
            p.id.toLowerCase().includes(q) ||
            !!p.email?.toLowerCase().includes(q),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, Math.max(1, Math.min(limit, 50)))
    },

    // ----------------------------------------------------------- timeline

    /**
     * What happened to a record, newest first: changes from the audit log and
     * comments. Pass `nextCursor` back as `before` for the next page.
     */
    async timeline(
      who: Who,
      ref: RecordRef,
      opts: { limit?: number; before?: string } = {},
    ): Promise<{ items: TimelineItem[]; nextCursor: string | null }> {
      const rec = await resolve(who, ref, "read")
      const limit = Math.max(1, Math.min(opts.limit ?? 20, 100))
      // Both sources are ordered by their ids, which are newId()s: time-ordered
      // strings, so the cursor is one exact id with no clock precision to lose.
      const cursor = opts.before
      if (cursor !== undefined && !/^[0-9A-Za-z]{1,64}$/.test(cursor))
        throw bad("before is not a cursor from this timeline.")
      const older = (id: AnyOrm) => (cursor ? lt(id, cursor) : undefined)

      const A = db.audit as unknown as Cols | undefined
      const changes = A
        ? ((await o
            .select()
            .from(db.audit)
            .where(and(eq(A.tableName, rec.sqlName), eq(A.rowId, ref.id), older(A.id)))
            .orderBy(desc(A.id))
            .limit(limit + 1)) as Cols[])
        : []
      // Deleted comments are left out here, not after, so a page is never short.
      const notes = (await o
        .select()
        .from(commentsTable)
        .where(
          and(
            eq(C.orgId, who.orgId),
            eq(C.tableName, rec.sqlName),
            eq(C.rowId, ref.id),
            isNull(C.deletedAt),
            older(C.id),
          ),
        )
        .orderBy(desc(C.id))
        .limit(limit + 1)) as Cols[]

      const merged: { at: Date; id: string; change?: Cols; note?: Cols }[] = [
        ...changes.map((r) => ({ at: r.at as Date, id: r.id as string, change: r })),
        ...notes.map((r) => ({ at: r.createdAt as Date, id: r.id as string, note: r })),
      ].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      const page = merged.slice(0, limit)
      const names = await people([
        ...changes.filter((r) => r.actorType === "user").map((r) => r.actorId),
        ...notes.map((r) => r.authorId),
      ])
      const actor = (type: string, id: string): Actor => ({
        type,
        id,
        name: type === "user" ? (names.get(id)?.name ?? id) : id,
      })
      const items: TimelineItem[] = page.map((x) => {
        if (x.note) {
          const comment = toComment(x.note, names)
          const item = {
            kind: "comment" as const,
            id: x.id,
            at: x.at,
            actor: actor("user", x.note.authorId),
            comment,
          }
          return { ...item, summary: describe(item) }
        }
        const r = x.change as Cols
        const item = {
          kind: "change" as const,
          id: x.id,
          at: x.at,
          actor: actor(r.actorType, r.actorId),
          action: ACTIONS[r.action] ?? r.action,
          changes: r.action === "update" ? diffRows(rec.table, r.before, r.after) : [],
        }
        return { ...item, summary: describe(item) }
      })
      const last = page[page.length - 1]
      return {
        items,
        nextCursor: merged.length > limit && last ? last.id : null,
      }
    },

    // ----------------------------------------------------------- versions

    /** A record's versions, newest first, each with what changed from the one before. `before` is a version number. */
    async versions(
      who: Who,
      ref: RecordRef,
      opts: { limit?: number; before?: number } = {},
    ): Promise<RecordVersion[]> {
      const rec = await resolve(who, ref, "read")
      const limit = Math.max(1, Math.min(opts.limit ?? 50, 200))
      const rows = await versionRows(
        rec,
        ref.id,
        opts.before ? lt(V().version, opts.before) : undefined,
        limit + 1,
      )
      const actor = await actorsOf(rows)
      return rows.slice(0, limit).map((r, i) => ({
        version: Number(r.version),
        action: r.action,
        actor: actor(r),
        at: r.at,
        changes: diffRows(rec.table, rows[i + 1]?.data ?? null, r.data),
      }))
    },

    /** Field-by-field changes from version `from` to version `to`. */
    async diff(
      who: Who,
      ref: RecordRef,
      from: number,
      to: number,
    ): Promise<{ from: number; to: number; changes: FieldChange[] }> {
      const rec = await resolve(who, ref, "read")
      const pick = async (n: number) => {
        const [r] = await versionRows(rec, ref.id, eq(V().version, Number(n)), 1)
        if (!r) throw notFound(`No version ${n} of this record.`)
        return r.data as Rec
      }
      return { from, to, changes: diffRows(rec.table, await pick(from), await pick(to)) }
    },

    /** Put version `n` back. Writes a new version and a `restore` audit entry. Needs write access. */
    async restore(who: Who, ref: RecordRef, n: number) {
      const rec = await resolve(who, ref, "write")
      const [r] = await versionRows(rec, ref.id, eq(V().version, Number(n)), 1)
      if (!r) throw notFound(`No version ${n} of this record.`)
      return writeBack(who, rec, r.data as Rec, "restore")
    },

    /**
     * Undo the record's last change by putting the version before it back.
     * 409 when `expected` (the version the caller saw) is not the latest, or
     * the record changed since its last version (a write that skipped history).
     */
    async undo(who: Who, ref: RecordRef, opts: { expected?: number } = {}) {
      const rec = await resolve(who, ref, "write")
      const [last, prev] = await versionRows(rec, ref.id, undefined, 2)
      if (!last) throw conflict("This record has no history to undo.")
      if (opts.expected !== undefined && Number(opts.expected) !== Number(last.version))
        throw conflict(
          `This record changed since you loaded it (now version ${last.version}). Reload and try again.`,
        )
      if (!prev) throw conflict("Nothing to undo: this is the first version.")
      const changed = Object.keys(columnsOf(rec.table)).some(
        (k) => k !== "updatedAt" && !same(rec.row[k] ?? null, (last.data as Rec)[k] ?? null),
      )
      if (changed)
        throw conflict(
          "This record changed outside its history. Reload and restore a version instead.",
        )
      return writeBack(who, rec, prev.data as Rec, "undo")
    },
  }
}

export type Collab = ReturnType<typeof createCollab>
