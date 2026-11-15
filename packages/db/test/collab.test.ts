/**
 * Collab: comment threads with mentions, the record timeline, and version
 * history with diff, restore and undo, on every backend. Deny by default:
 * another org's record, a non-member, or a table not in `records` is 404.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { pgTable, text as pgText } from "drizzle-orm/pg-core"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import {
  createCollab,
  describeItem,
  type Mention,
  mentionToken,
  parseMentions,
} from "../src/collab"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { createOrgs } from "../src/orgs"
import { audited, scoped } from "../src/scoped"
import { backends, ddl, type Instance } from "./harness"

const sqliteTasks = () =>
  sqliteTable("tasks", {
    id: sqc.id(),
    orgId: text("org_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("Todo"),
    ...sqc.timestamps(),
    ...sqc.softDelete(),
  })
const pgTasks = () =>
  pgTable("tasks", {
    id: pgc.id(),
    orgId: pgText("org_id").notNull(),
    title: pgText("title").notNull(),
    status: pgText("status").notNull().default("Todo"),
    ...pgc.timestamps(),
    ...pgc.softDelete(),
  })

const fails = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as Error & { code?: string; status?: number }
  }
  throw new Error("expected a rejection")
}

test("parseMentions reads stable ids, not names", () => {
  const body = `Hi ${mentionToken("u_1", "Asha [ops]")} and @[Asha](user:u_2), again @[A](user:u_1). @Asha`
  expect(parseMentions(body)).toEqual(["u_1", "u_2"])
  expect(mentionToken("u_1", "Asha [ops]")).toBe("@[Asha ops](user:u_1)")
})

describe.each(backends)("collab on $name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  const setup = async () => {
    open = await backend.make({ audit: true })
    const pg = backend.name.startsWith("postgres")
    const ot = pg ? pgc.orgTables() : sqc.orgTables()
    const ct = (pg ? pgc.collabTables() : sqc.collabTables()) as ReturnType<typeof sqc.collabTables>
    const tasks = (pg ? pgTasks() : sqliteTasks()) as ReturnType<typeof sqliteTasks>
    for (const t of [...Object.values(ot), ...Object.values(ct), tasks]) await open.exec(ddl(t))
    const db = { ...open.db, versions: { table: ct.recordVersions, track: [tasks] } }
    const orgs = createOrgs(db, { tables: ot })
    const a = await orgs.create({ name: "Acme", ownerId: "alice" })
    const b = await orgs.create({ name: "Bolt", ownerId: "bob" })
    await orgs.addMember(a.id, "mo", "member")
    await orgs.addMember(a.id, "dev", "admin")
    const sent: Mention[] = []
    const names: Record<string, string> = { alice: "Alice", mo: "Mo", dev: "Dev", bob: "Bob" }
    const collab = createCollab(db, {
      tables: { comments: ct.comments },
      records: { tasks },
      orgs,
      people: async (ids) =>
        Object.fromEntries(ids.filter((i) => names[i]).map((i) => [i, { name: names[i] }])),
      notify: (_to, m) => sent.push(m),
    })
    const alice = { orgId: a.id, userId: "alice" }
    const mo = { orgId: a.id, userId: "mo" }
    const asAlice = audited(scoped(db, { orgId: a.id }), { actor: { type: "user", id: "alice" } })
    const [task] = await asAlice.insert(tasks, { title: "Ship it" })
    const ref = { table: "tasks", id: task?.id as string }
    return { db, orgs, a, b, collab, sent, alice, mo, tasks, asAlice, ref, ct }
  }

  test("threads, replies, edit marker, soft delete", async () => {
    const { collab, alice, mo, ref } = await setup()
    const root = await collab.addComment(alice, ref, { body: "First" })
    const reply = await collab.addComment(mo, ref, { body: "Reply", parentId: root.id })
    // A reply to a reply joins the thread.
    const deep = await collab.addComment(alice, ref, { body: "Deep", parentId: reply.id })
    expect(deep.parentId).toBe(root.id)
    const edited = await collab.editComment(mo, reply.id, { body: "Reply, edited" })
    expect(edited.editedAt).toBeInstanceOf(Date)
    // Only the author edits; a plain member cannot delete someone else's comment.
    expect((await fails(collab.editComment(alice, reply.id, { body: "x" }))).status).toBe(403)
    expect((await fails(collab.deleteComment(mo, root.id))).status).toBe(403)
    await collab.deleteComment(alice, root.id)
    const threads = await collab.comments(alice, ref)
    expect(threads.length).toBe(1)
    expect(threads[0]?.deleted).toBe(true)
    expect(threads[0]?.body).toBe("")
    expect(threads[0]?.replies.map((r) => [r.body, !!r.editedAt, r.author.name])).toEqual([
      ["Reply, edited", true, "Mo"],
      ["Deep", false, "Alice"],
    ])
    // A deleted comment can no longer be edited.
    expect((await fails(collab.editComment(alice, root.id, { body: "x" }))).status).toBe(404)
    expect((await fails(collab.addComment(alice, ref, { body: "  " }))).status).toBe(400)
  })

  test("deny by default: other orgs, non-members, unknown tables", async () => {
    const { collab, b, alice, ref, orgs, a } = await setup()
    const c = await collab.addComment(alice, ref, { body: "Mine" })
    const bob = { orgId: b.id, userId: "bob" }
    const outsider = { orgId: a.id, userId: "bob" }
    for (const p of [
      collab.comments(bob, ref),
      collab.comments(outsider, ref),
      collab.addComment(outsider, ref, { body: "hi" }),
      collab.timeline(bob, ref),
      collab.versions(outsider, ref),
      collab.comments(alice, { table: "memberships", id: ref.id }),
      collab.comments(alice, { table: "constructor", id: ref.id }),
      collab.editComment(bob, c.id, { body: "x" }),
      collab.deleteComment(bob, c.id),
      collab.mentionable(outsider),
      collab.restore(bob, ref, 1),
    ])
      expect((await fails(p)).status).toBe(404)
    // Someone who leaves loses access to what they wrote.
    await orgs.addMember(a.id, "zed", "member")
    const zed = { orgId: a.id, userId: "zed" }
    const z = await collab.addComment(zed, ref, { body: "bye" })
    await orgs.removeMember(a.id, "zed")
    expect((await fails(collab.editComment(zed, z.id, { body: "x" }))).status).toBe(404)
  })

  test("mentions: members only, notified once, never on re-edit", async () => {
    const { collab, sent, alice, mo, ref } = await setup()
    const body = `Can ${mentionToken("mo", "Mo")} and ${mentionToken("bob", "Bob")} look? ${mentionToken("alice", "me")}`
    const c = await collab.addComment(alice, ref, { body })
    // bob is not in this org; alice does not notify herself.
    expect(sent.map((m) => m.to)).toEqual(["mo"])
    expect(sent[0]).toMatchObject({
      by: "alice",
      byName: "Alice",
      table: "tasks",
      rowId: ref.id,
      commentId: c.id,
      key: `mention:${c.id}:mo`,
    })
    expect(sent[0]?.excerpt).toBe("Can @Mo and @Bob look? @Alice")
    await collab.editComment(alice, c.id, { body: `${body} now` })
    expect(sent.length).toBe(1)
    // Removing and re-adding a mention does not notify again; a new person is.
    await collab.editComment(alice, c.id, { body: "nobody" })
    await collab.editComment(alice, c.id, {
      body: `${mentionToken("mo", "Mo")} ${mentionToken("dev", "Dev")}`,
    })
    expect(sent.map((m) => m.to)).toEqual(["mo", "dev"])
    const people = await collab.mentionable(mo, "de")
    expect(people.map((p) => [p.id, p.name])).toEqual([["dev", "Dev"]])
    expect((await collab.mentionable(mo)).map((p) => p.id).sort()).toEqual(["alice", "dev", "mo"])
  })

  test("timeline: audit changes and comments, newest first, paginated", async () => {
    const { collab, alice, ref, asAlice, tasks } = await setup()
    await collab.addComment(alice, ref, { body: "Looks good" })
    await new Promise((r) => setTimeout(r, 5))
    await asAlice.update(tasks, { status: "Done" }, eq(tasks.id, ref.id))
    await new Promise((r) => setTimeout(r, 5))
    await asAlice.update(tasks, { status: "Doing", title: "Ship it now" }, eq(tasks.id, ref.id))
    const first = await collab.timeline(alice, ref, { limit: 2 })
    expect(first.items.map((i) => i.summary)).toEqual([
      "Alice changed title and status",
      "Alice changed status to Done",
    ])
    const change = first.items[1]
    expect(change?.kind === "change" && change.changes).toEqual([
      { field: "status", from: "Todo", to: "Done" },
    ])
    expect(first.nextCursor).toBeString()
    const rest = await collab.timeline(alice, ref, {
      limit: 2,
      before: first.nextCursor as string,
    })
    expect(rest.items.map((i) => i.summary)).toEqual(["Alice commented", "Alice created this"])
    expect(rest.nextCursor).toBeNull()
    expect((await fails(collab.timeline(alice, ref, { before: "nope" }))).status).toBe(400)
  })

  test("versions: snapshot on write, list, diff, restore", async () => {
    const { collab, alice, mo, ref, asAlice, tasks, db } = await setup()
    await asAlice.update(tasks, { status: "Doing" }, eq(tasks.id, ref.id))
    await asAlice.update(tasks, { status: "Done", title: "Shipped" }, eq(tasks.id, ref.id))
    const list = await collab.versions(alice, ref)
    expect(list.map((v) => [v.version, v.action, v.actor.name])).toEqual([
      [3, "update", "Alice"],
      [2, "update", "Alice"],
      [1, "insert", "Alice"],
    ])
    expect(list[0]?.changes).toEqual([
      { field: "title", from: "Ship it", to: "Shipped" },
      { field: "status", from: "Doing", to: "Done" },
    ])
    expect((await collab.diff(alice, ref, 1, 3)).changes).toEqual([
      { field: "title", from: "Ship it", to: "Shipped" },
      { field: "status", from: "Todo", to: "Done" },
    ])
    expect((await fails(collab.diff(alice, ref, 1, 9))).status).toBe(404)
    // A plain member cannot restore (no tasks:write); the owner can.
    expect((await fails(collab.restore(mo, ref, 1))).status).toBe(403)
    const r = await collab.restore(alice, ref, 1)
    expect(r.version).toBe(4)
    expect([r.row.title, r.row.status]).toEqual(["Ship it", "Todo"])
    expect(r.row.createdAt).toBeInstanceOf(Date)
    const [row] = await scoped(db, { orgId: alice.orgId }).select(tasks, eq(tasks.id, ref.id))
    expect(row?.title).toBe("Ship it")
    const items = (await collab.timeline(alice, ref)).items
    expect(items[0]?.summary).toBe("Alice restored an earlier version")
    expect((await collab.versions(alice, ref))[0]?.action).toBe("restore")
  })

  test("undo: last change, with conflict detection", async () => {
    const { collab, alice, ref, asAlice, tasks, db } = await setup()
    expect((await fails(collab.undo(alice, ref))).status).toBe(409) // first version only
    await asAlice.update(tasks, { status: "Done" }, eq(tasks.id, ref.id))
    // The caller saw version 1, but it is now 2.
    expect((await fails(collab.undo(alice, ref, { expected: 1 }))).status).toBe(409)
    const u = await collab.undo(alice, ref, { expected: 2 })
    expect([u.version, u.row.status]).toEqual([3, "Todo"])
    // A write that skipped history makes undo refuse rather than clobber it.
    await (db.orm as any).update(tasks).set({ status: "Blocked" }).where(eq(tasks.id, ref.id))
    const e = await fails(collab.undo(alice, ref))
    expect([e.status, e.message.includes("outside its history")]).toEqual([409, true])
    // Undoing a soft delete brings the record back.
    const fresh = await collab.restore(alice, ref, 3)
    await asAlice.delete(tasks, eq(tasks.id, ref.id))
    const back = await collab.undo(alice, ref, { expected: fresh.version + 1 })
    expect(back.row.deletedAt).toBeNull()
  })

  test("describeItem words a change", () => {
    const actor = { type: "user", id: "u", name: "Asha" }
    const base = { kind: "change" as const, id: "1", at: new Date(), actor, action: "updated" }
    expect(describeItem({ ...base, changes: [{ field: "dueDate", from: null, to: "" }] })).toBe(
      "Asha cleared due date",
    )
    expect(
      describeItem({
        ...base,
        changes: ["a", "b", "c", "d", "e"].map((f) => ({ field: f, from: 1, to: 2 })),
      }),
    ).toBe("Asha changed a, b, c and 2 more")
    expect(
      describeItem({ ...base, changes: [{ field: "secret", from: null, to: null, hidden: true }] }),
    ).toBe("Asha changed secret")
  })
})
