/**
 * Orgs: tenant scoping (scoped and defineAdmin), roles and permissions,
 * custom roles, invites with expiring tokens, and per-org settings, on every
 * backend. The deny-by-default checks are the point: org A must never read or
 * write org B's rows, whichever door it comes through.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { pgTable, text as pgText } from "drizzle-orm/pg-core"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { type AdminContext, AdminError, defineAdmin } from "../src/admin"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { isSignetDbError } from "../src/errors"
import { canGrant, createOrgs, hasPermission, type OrgError, slugify } from "../src/orgs"
import { scoped } from "../src/scoped"
import { backends, ddl, type Instance } from "./harness"

const sqliteProjects = () =>
  sqliteTable("projects", {
    id: sqc.id(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    ...sqc.timestamps(),
    ...sqc.softDelete(),
  })
const pgProjects = () =>
  pgTable("projects", {
    id: pgc.id(),
    orgId: pgText("org_id").notNull(),
    name: pgText("name").notNull(),
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

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })
  let clock = new Date("2026-11-15T10:00:00Z")
  const setup = async () => {
    open = await backend.make({ audit: true })
    const pg = backend.name.startsWith("postgres")
    const t = pg ? pgc.orgTables() : sqc.orgTables()
    const projects = (pg ? pgProjects() : sqliteProjects()) as ReturnType<typeof sqliteProjects>
    for (const table of [...Object.values(t), projects]) await open.exec(ddl(table))
    clock = new Date("2026-11-15T10:00:00Z")
    const orgs = createOrgs(open.db, { tables: t, now: () => clock })
    const a = await orgs.create({ name: "Acme Labs", ownerId: "alice" })
    const b = await orgs.create({ name: "Bolt", ownerId: "bob" })
    return { ...open, t, projects, orgs, a, b }
  }

  test("scoped({ orgId }) never reads or writes another org's rows", async () => {
    const { db, S, projects, a, b } = await setup()
    const A = scoped(db, { orgId: a.id })
    const B = scoped(db, { orgId: b.id })
    const [pa] = await A.insert(projects, { name: "Apollo" })
    const [pb] = await B.insert(projects, { name: "Borealis" })
    expect(pa?.orgId).toBe(a.id)
    expect((await A.select(projects)).map((r) => r.name)).toEqual(["Apollo"])
    expect(await A.select(projects, eq(projects.id, pb?.id as string))).toEqual([])
    expect(await A.update(projects, { name: "x" }, eq(projects.id, pb?.id as string))).toEqual([])
    expect(await A.delete(projects, eq(projects.id, pb?.id as string), { hard: true })).toEqual([])
    expect((await B.select(projects))[0]?.name).toBe("Borealis")

    const cross = await fails(A.insert(projects, { name: "x", orgId: b.id } as never))
    expect(isSignetDbError(cross, "CROSS_ORG_WRITE")).toBe(true)
    const move = await fails(
      A.update(projects, { orgId: b.id } as never, eq(projects.id, pa?.id as string)),
    )
    expect(isSignetDbError(move, "CROSS_ORG_WRITE")).toBe(true)
    // A table it cannot filter is refused, not read whole.
    expect(isSignetDbError(await fails(A.select(S.users)), "NOT_TENANT_TABLE")).toBe(true)
    expect(isSignetDbError(await fails(A.insert(S.users, { name: "x" })), "NOT_TENANT_TABLE")).toBe(
      true,
    )
    // A member scope may read its own user-owned rows; another user's stay hidden.
    await scoped(db, { userId: "u2" }).insert(S.tags, { label: "theirs" })
    const me = scoped(db, { userId: "u1", orgId: a.id })
    await me.insert(S.tags, { label: "mine" })
    expect((await me.select(S.tags)).map((r) => r.label)).toEqual(["mine"])
    expect(me.orgId).toBe(a.id)
    expect(
      isSignetDbError(
        await fails(Promise.resolve().then(() => scoped(db, { orgId: "" }))),
        "NO_ORG_ID",
      ),
    ).toBe(true)
  })

  test("defineAdmin with ctx.orgId is limited to that org", async () => {
    const { db, S, projects, a, b } = await setup()
    const admin = defineAdmin({ ...S, projects }, { authorize: () => true, tenant: true })
    const ctx = (orgId?: string): AdminContext => ({
      actor: { type: "user", id: "alice" },
      ...(orgId ? { orgId } : {}),
    })
    const [pb] = await scoped(db, { orgId: b.id }).insert(projects, { name: "Borealis" })
    const created = (await admin.create(db, ctx(a.id), "projects", {
      name: "Apollo",
      orgId: b.id, // ignored: lands in A
    })) as Record<string, unknown>
    expect(created.orgId).toBe(a.id)
    const list = await admin.list(db, ctx(a.id), "projects")
    expect(list.rows.map((r) => r.name)).toEqual(["Apollo"])

    const status = async (p: Promise<unknown>) => {
      const e = await fails(p)
      return e instanceof AdminError ? e.status : e
    }
    const other = pb?.id as string
    expect(await status(admin.get(db, ctx(a.id), "projects", other))).toBe(404)
    expect(await status(admin.update(db, ctx(a.id), "projects", other, { name: "x" }))).toBe(404)
    expect(await status(admin.delete(db, ctx(a.id), "projects", other))).toBe(404)
    expect(
      await status(
        admin.bulkDelete(db, ctx(a.id), "projects", [other]).then((r) => {
          if (r.ids.length) throw new Error("deleted another org's row")
          throw new AdminError(404, "NOT_FOUND", "none")
        }),
      ),
    ).toBe(404)
    expect(await status(admin.update(db, ctx(a.id), "projects", created.id, { orgId: b.id }))).toBe(
      403,
    )
    // A filter cannot reach across either.
    const filtered = await admin.list(db, ctx(a.id), "projects", {
      filter: { orgId: { eq: b.id } },
    })
    expect(filtered.rows).toEqual([])
    // Tables without orgId do not exist for a tenant caller.
    expect(await status(admin.list(db, ctx(a.id), "users"))).toBe(404)
    const meta = await admin.meta(ctx(a.id))
    expect(meta.tables.map((t) => t.name)).toContain("projects")
    expect(meta.tables.map((t) => t.name)).not.toContain("users")
    expect(meta.tables.map((t) => t.name)).not.toContain("audit_log")
    // tenant: true needs an org at all.
    expect(await status(admin.list(db, ctx(), "projects"))).toBe(403)
    expect((await admin.meta(ctx())).tables).toEqual([])
    const [row] = await db.orm.select().from(projects).where(eq(projects.id, other))
    expect(row?.name).toBe("Borealis")
  })

  test("orgs, settings and domains", async () => {
    const { orgs, a, b } = await setup()
    expect(a.slug).toBe("acme-labs")
    expect((await orgs.membership(a.id, "alice"))?.role).toBe("owner")
    const again = await orgs.create({ name: "Acme Labs", ownerId: "carol" })
    expect(again.slug).not.toBe(a.slug)
    expect(again.slug.startsWith("acme-labs-")).toBe(true)

    const updated = await orgs.update(a.id, {
      domain: "App.Acme.Example.",
      theme: "cinematic",
      brandColor: "#12833C",
    })
    expect(updated.domain).toBe("app.acme.example")
    expect(updated.brandColor).toBe("#12833c")
    expect((await orgs.byDomain("APP.acme.example:8443"))?.id).toBe(a.id)
    expect(await orgs.byDomain("nope.example")).toBeNull()
    expect((await orgs.bySlug("bolt"))?.id).toBe(b.id)
    expect((await fails(orgs.update(b.id, { domain: "app.acme.example" }))).code).toBe("CONFLICT")
    expect((await fails(orgs.update(b.id, { brandColor: "red" }))).code).toBe("BAD_INPUT")
    expect((await fails(orgs.update(b.id, { domain: "not a domain" }))).code).toBe("BAD_INPUT")
    expect((await fails(orgs.update(a.id, { name: "x" }, { by: "bob" }))).code).toBe("FORBIDDEN")
    expect((await orgs.listForUser("alice")).map((m) => m.org.id)).toEqual([a.id])
    expect(slugify("Ünïcode Café!")).toBe("unicode-cafe")
  })

  test("roles: permissions, no escalation, always an owner, custom roles", async () => {
    const { orgs, a, b } = await setup()
    expect(hasPermission(["members:*"], "members:invite")).toBe(true)
    expect(hasPermission(["members:read"], "members:invite")).toBe(false)
    expect(canGrant(["members:invite"], ["*"])).toBe(false)

    await orgs.addMember(a.id, "dev", "admin", { by: "alice" })
    await orgs.addMember(a.id, "mo", "member", { by: "alice" })
    expect(await orgs.can(a.id, "dev", "members:invite")).toBe(true)
    expect(await orgs.can(a.id, "mo", "members:invite")).toBe(false)
    // Membership in A means nothing in B.
    expect(await orgs.can(b.id, "dev", "members:read")).toBe(false)
    expect(await orgs.membership(b.id, "alice")).toBeNull()

    // An admin cannot make an owner, nor demote one.
    expect((await fails(orgs.setRole(a.id, "mo", "owner", { by: "dev" }))).code).toBe("FORBIDDEN")
    expect((await fails(orgs.setRole(a.id, "alice", "member", { by: "dev" }))).code).toBe(
      "FORBIDDEN",
    )
    expect((await fails(orgs.removeMember(a.id, "alice", { by: "dev" }))).code).toBe("FORBIDDEN")
    // A member cannot manage at all; Bob (B's owner) cannot touch A.
    expect((await fails(orgs.removeMember(a.id, "dev", { by: "mo" }))).code).toBe("FORBIDDEN")
    expect((await fails(orgs.removeMember(a.id, "mo", { by: "bob" }))).code).toBe("FORBIDDEN")
    // The last owner stays.
    const last = await fails(orgs.setRole(a.id, "alice", "member", { by: "alice" }))
    expect([last.code, (last as OrgError).status]).toEqual(["CONFLICT", 409])
    expect((await fails(orgs.removeMember(a.id, "alice", { by: "alice" }))).code).toBe("CONFLICT")
    // Leaving is always allowed for a non-last-owner.
    await orgs.removeMember(a.id, "mo", { by: "mo" })
    expect(await orgs.membership(a.id, "mo")).toBeNull()

    // Custom roles: per org, no escalation, unknown roles refused.
    await orgs.saveRole(a.id, "billing", ["billing:read", "billing:write"], { by: "alice" })
    expect((await fails(orgs.saveRole(a.id, "sneaky", ["*"], { by: "dev" }))).code).toBe(
      "FORBIDDEN",
    )
    expect((await fails(orgs.saveRole(a.id, "admin", ["x"]))).code).toBe("BAD_INPUT")
    await orgs.addMember(a.id, "fin", "billing")
    expect(await orgs.can(a.id, "fin", "billing:write")).toBe(true)
    expect((await fails(orgs.addMember(b.id, "fin", "billing"))).code).toBe("BAD_INPUT")
    expect((await orgs.roles(a.id)).billing).toEqual(["billing:read", "billing:write"])
    expect((await fails(orgs.deleteRole(a.id, "billing"))).code).toBe("CONFLICT")
  })

  test("invites: token once, expiry, revoke, email, cross-org", async () => {
    const { orgs, a, b } = await setup()
    await orgs.addMember(a.id, "dev", "admin")
    await orgs.addMember(a.id, "mo", "member")
    expect((await fails(orgs.invite({ orgId: a.id, role: "member", invitedBy: "mo" }))).code).toBe(
      "FORBIDDEN",
    )
    expect((await fails(orgs.invite({ orgId: a.id, role: "owner", invitedBy: "dev" }))).code).toBe(
      "FORBIDDEN",
    )
    expect((await fails(orgs.invite({ orgId: a.id, role: "member", invitedBy: "bob" }))).code).toBe(
      "FORBIDDEN",
    )

    const { token, invitation } = await orgs.invite({
      orgId: a.id,
      role: "member",
      invitedBy: "dev",
      email: "Zed@Example.com",
    })
    expect(invitation.status).toBe("pending")
    expect((await orgs.previewInvite(token))?.org.name).toBe("Acme Labs")
    expect(await orgs.previewInvite("nope")).toBeNull()
    expect(await orgs.acceptInvite(token, { userId: "zed", email: "other@example.com" })).toEqual({
      ok: false,
      reason: "email_mismatch",
    })
    const won = await orgs.acceptInvite(token, { userId: "zed", email: "zed@example.com" })
    expect(won.ok && won.membership.role).toBe("member")
    expect(won.ok && won.org.id).toBe(a.id)
    const twice = await orgs.acceptInvite(token, { userId: "zed", email: "zed@example.com" })
    expect(twice.ok && twice.already).toBe(true)
    expect(await orgs.acceptInvite(token, { userId: "eve", email: "zed@example.com" })).toEqual({
      ok: false,
      reason: "used",
    })
    expect(await orgs.membership(b.id, "zed")).toBeNull()

    const late = await orgs.invite({
      orgId: a.id,
      role: "member",
      invitedBy: "alice",
      ttlMs: 60_000,
    })
    clock = new Date(clock.getTime() + 61_000)
    expect(await orgs.acceptInvite(late.token, { userId: "eve" })).toEqual({
      ok: false,
      reason: "expired",
    })
    const gone = await orgs.invite({ orgId: a.id, role: "member", invitedBy: "alice" })
    // Another org cannot revoke it; this one can.
    expect(await orgs.revokeInvite(b.id, gone.invitation.id)).toBe(false)
    expect((await fails(orgs.revokeInvite(a.id, gone.invitation.id, { by: "bob" }))).code).toBe(
      "FORBIDDEN",
    )
    expect(await orgs.revokeInvite(a.id, gone.invitation.id, { by: "dev" })).toBe(true)
    expect(await orgs.acceptInvite(gone.token, { userId: "eve" })).toEqual({
      ok: false,
      reason: "revoked",
    })
    expect((await orgs.invitations(a.id, { pending: true })).length).toBe(0)
    expect((await orgs.invitations(b.id)).length).toBe(0)
    expect((await orgs.invitations(a.id)).map((i) => i.status).sort()).toEqual([
      "accepted",
      "expired",
      "revoked",
    ])
  })

  test("audit: every org write is logged with actor, org and before/after; no tokens", async () => {
    const { db, S, orgs, a } = await setup()
    await orgs.update(a.id, { name: "Acme 2" }, { by: "alice" })
    await orgs.addMember(a.id, "dev", "admin", { by: "alice" })
    await orgs.addMember(a.id, "mo", "member", { by: "alice" })
    await orgs.setRole(a.id, "mo", "admin", { by: "alice" })
    await orgs.removeMember(a.id, "mo", { by: "alice" })
    await orgs.removeMember(a.id, "dev", { by: "dev" })
    await orgs.saveRole(a.id, "billing", ["billing:read"], { by: "alice" })
    await orgs.saveRole(a.id, "billing", ["billing:read", "billing:write"], { by: "alice" })
    await orgs.deleteRole(a.id, "billing", { by: "alice" })
    const { token, invitation } = await orgs.invite({
      orgId: a.id,
      role: "member",
      invitedBy: "alice",
    })
    await orgs.acceptInvite(token, { userId: "zed" })
    const second = await orgs.invite({ orgId: a.id, role: "member", invitedBy: "alice" })
    await orgs.revokeInvite(a.id, second.invitation.id, { by: "alice" })

    const rows = (await db.orm.select().from(S.audit)) as Record<string, any>[]
    const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v)
    const entries = rows.map((r) => ({ ...r, before: parse(r.before), after: parse(r.after) }))
    const forA = entries.filter((e) => (e.after ?? e.before)?.orgId === a.id)
    expect(forA.map((e) => e.action)).toEqual([
      "org.create",
      "org.update",
      "member.add",
      "member.add",
      "member.role",
      "member.remove",
      "member.leave",
      "role.create",
      "role.update",
      "role.delete",
      "invite.create",
      "invite.accept",
      "invite.create",
      "invite.revoke",
    ])
    const by = (action: string) => forA.filter((e) => e.action === action)
    expect(by("org.update")[0]).toMatchObject({
      actorType: "user",
      actorId: "alice",
      tableName: "organizations",
      before: { name: "Acme Labs" },
      after: { name: "Acme 2" },
    })
    expect(by("member.role")[0]).toMatchObject({
      before: { role: "member" },
      after: { role: "admin" },
    })
    expect(by("member.leave")[0]).toMatchObject({ actorId: "dev", after: null })
    expect(by("role.update")[0]?.before.permissions).toEqual(["billing:read"])
    expect(by("invite.accept")[0]).toMatchObject({
      actorId: "zed",
      rowId: invitation.id,
      before: { status: "pending" },
      after: { status: "accepted", acceptedBy: "zed" },
    })
    expect(by("invite.revoke")[0]?.after.status).toBe("revoked")
    const text = JSON.stringify(entries)
    expect(text.includes(token)).toBe(false)
    expect(text.includes(second.token)).toBe(false)
    expect(/tokenHash|token_hash/.test(text)).toBe(false)
  })

  test("audit: skipped quietly without an audit table", async () => {
    open = await backend.make({})
    const pg = backend.name.startsWith("postgres")
    const t = pg ? pgc.orgTables() : sqc.orgTables()
    for (const table of Object.values(t)) await open.exec(ddl(table))
    const orgs = createOrgs(open.db, { tables: t })
    const org = await orgs.create({ name: "Quiet", ownerId: "q" })
    const { token } = await orgs.invite({ orgId: org.id, role: "member", invitedBy: "q" })
    expect((await orgs.acceptInvite(token, { userId: "r" })).ok).toBe(true)
    expect(await open.db.orm.select().from(open.S.audit)).toEqual([])
  })
})
