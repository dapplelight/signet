/**
 * tenant(), orgGuards() and orgRoutes(): the tenant resolves from domain,
 * subdomain, param, header and cookie; guards answer 401/404/403; and org A's
 * members can never read or change org B through any route (deny by default).
 * The store is an in-memory stand-in shaped like signet-db's createOrgs; the
 * real store's own isolation is tested in signet-db.
 */
import { Hono } from "hono"
import { errorHandler } from "../src/http/errors"
import {
  currentTenant,
  grants,
  type OrgStore,
  orgGuards,
  orgRoutes,
  type TenantOrg,
  tenant,
} from "../src/http/orgs"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

/** Like signet-db's OrgError: a SignetDbError with an HTTP status. */
class FakeOrgError extends Error {
  readonly name = "SignetDbError"
  constructor(
    readonly status: 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const ROLES: Record<string, string[]> = {
  owner: ["*"],
  admin: ["org:update", "members:read", "members:invite", "members:manage"],
  member: ["members:read"],
}
const orgsById = new Map<string, TenantOrg>()
const members: { orgId: string; userId: string; role: string; createdAt: Date }[] = []
const invites: {
  id: string
  orgId: string
  token: string
  email: string | null
  role: string
  invitedBy: string
  createdAt: Date
  expiresAt: Date
  status: string
}[] = []
const mk = (id: string, slug: string, domain: string | null = null) =>
  orgsById.set(id, { id, name: slug.toUpperCase(), slug, domain, theme: null, brandColor: null })
mk("org_a", "acme", "app.acme.example")
mk("org_b", "bolt")
const join = (orgId: string, userId: string, role: string) =>
  members.push({ orgId, userId, role, createdAt: new Date() })
join("org_a", "alice", "owner")
join("org_a", "dev", "admin")
join("org_a", "mo", "member")
join("org_b", "bob", "owner")

const membership = async (orgId: string, userId: string) => {
  const m = members.find((x) => x.orgId === orgId && x.userId === userId)
  return m ? { ...m, permissions: ROLES[m.role] ?? [] } : null
}
const mustManage = async (orgId: string, by: string | undefined, perm: string) => {
  const m = by ? await membership(orgId, by) : null
  if (!m || !grants(m.permissions, perm)) throw new FakeOrgError(403, "FORBIDDEN", "No.")
}
const store: OrgStore = {
  get: async (id) => orgsById.get(id) ?? null,
  bySlug: async (s) => [...orgsById.values()].find((o) => o.slug === s) ?? null,
  byDomain: async (h) => [...orgsById.values()].find((o) => o.domain === h) ?? null,
  membership,
  create: async ({ name, ownerId }) => {
    const id = `org_${orgsById.size + 1}`
    mk(id, name.toLowerCase())
    join(id, ownerId, "owner")
    return orgsById.get(id) as TenantOrg
  },
  update: async (orgId, s, { by }) => {
    await mustManage(orgId, by, "org:update")
    const o = { ...(orgsById.get(orgId) as TenantOrg), ...s } as TenantOrg
    orgsById.set(orgId, o)
    return o
  },
  listForUser: async (u) =>
    members
      .filter((m) => m.userId === u)
      .map((m) => ({ org: orgsById.get(m.orgId) as TenantOrg, role: m.role })),
  members: async (orgId) => members.filter((m) => m.orgId === orgId),
  roles: async () => ROLES,
  setRole: async (orgId, userId, role, { by }) => {
    const t = members.find((m) => m.orgId === orgId && m.userId === userId)
    if (!t) throw new FakeOrgError(404, "NOT_FOUND", "No such member.")
    await mustManage(orgId, by, "members:manage")
    t.role = role
    return t
  },
  removeMember: async (orgId, userId, { by }) => {
    const i = members.findIndex((m) => m.orgId === orgId && m.userId === userId)
    if (i < 0) throw new FakeOrgError(404, "NOT_FOUND", "No such member.")
    if (by !== userId) await mustManage(orgId, by, "members:manage")
    members.splice(i, 1)
  },
  invite: async ({ orgId, role, invitedBy, email }) => {
    await mustManage(orgId, invitedBy, "members:invite")
    const inv = {
      id: `inv_${invites.length + 1}`,
      orgId,
      token: `tok_${invites.length + 1}`,
      email: email ?? null,
      role,
      invitedBy,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "pending",
    }
    invites.push(inv)
    const { token, ...invitation } = inv
    return { invitation, token }
  },
  invitations: async (orgId) => invites.filter((i) => i.orgId === orgId && i.status === "pending"),
  revokeInvite: async (orgId, id, { by }) => {
    await mustManage(orgId, by, "members:invite")
    const i = invites.find((x) => x.id === id && x.orgId === orgId && x.status === "pending")
    if (i) i.status = "revoked"
    return !!i
  },
  previewInvite: async (token) => {
    const i = invites.find((x) => x.token === token)
    return i ? { invitation: i, org: orgsById.get(i.orgId) as TenantOrg } : null
  },
  acceptInvite: async (token, { userId, email }) => {
    const i = invites.find((x) => x.token === token)
    if (!i) return { ok: false, reason: "not_found" }
    if (i.status !== "pending")
      return { ok: false, reason: i.status === "revoked" ? "revoked" : "used" }
    if (i.email && i.email !== email) return { ok: false, reason: "email_mismatch" }
    i.status = "accepted"
    join(i.orgId, userId, i.role)
    return {
      ok: true,
      membership: members[members.length - 1] as (typeof members)[number],
      org: orgsById.get(i.orgId) as TenantOrg,
      already: false,
    }
  },
}

const userId = (c: { req: { header(n: string): string | undefined } }) => c.req.header("x-user")
const app = new Hono()
app.onError(errorHandler({ isProduction: () => true }))
app.use("*", tenant({ orgs: store, rootDomain: "app.example" }))
app.route(
  "/api/orgs",
  orgRoutes({
    orgs: store,
    userId,
    email: (c) => c.req.header("x-email"),
    cookieOptions: { secure: false },
  }),
)
const { requirePermission, requireRole } = orgGuards({ orgs: store, userId })
app.get("/api/whoami", (c) => c.json({ org: currentTenant(c).id }))
app.get("/api/secret", requireRole("owner"), (c) => c.json({ org: currentTenant(c).id }))
app.get("/api/team", requirePermission("members:read"), (c) => c.json({ org: currentTenant(c).id }))
app.use("/t/:org/*", tenant({ orgs: store, param: "org", header: false, cookie: false }))
app.get("/t/:org/where", (c) => c.json({ org: currentTenant(c).id }))

type Opts = { user?: string; org?: string; host?: string; cookie?: string; email?: string }
const call = (path: string, o: Opts = {}, init: RequestInit = {}) =>
  app.request(`http://${o.host ?? "app.example"}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(o.user ? { "x-user": o.user } : {}),
      ...(o.org ? { "x-org": o.org } : {}),
      ...(o.cookie ? { cookie: o.cookie } : {}),
      ...(o.email ? { "x-email": o.email } : {}),
      ...(init.headers as Record<string, string>),
    },
  })
const j = async (r: Response) => (await r.json()) as Record<string, any>
const send = (method: string, body?: unknown) => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
})

// --- tenant resolution
ok(
  "custom domain",
  (await j(await call("/api/whoami", { host: "app.acme.example" }))).org === "org_a",
)
ok("subdomain", (await j(await call("/api/whoami", { host: "bolt.app.example" }))).org === "org_b")
ok("header by slug", (await j(await call("/api/whoami", { org: "acme" }))).org === "org_a")
ok("header by id", (await j(await call("/api/whoami", { org: "org_b" }))).org === "org_b")
ok("cookie", (await j(await call("/api/whoami", { cookie: "signet_org=org_b" }))).org === "org_b")
ok("path param", (await j(await call("/t/bolt/where"))).org === "org_b")
ok(
  "domain beats header",
  (await j(await call("/api/whoami", { host: "app.acme.example", org: "bolt" }))).org === "org_a",
)
// No rootDomain: a request host is never looked up as a custom domain.
{
  const bare = new Hono()
  bare.use("*", tenant({ orgs: store }))
  bare.get("/who", (c) =>
    c.json({ org: (c.get("tenant" as never) as TenantOrg | undefined)?.id ?? null }),
  )
  const who = async (host: string, headers: Record<string, string> = {}) =>
    (await j(await bare.request(`http://${host}/who`, { headers }))).org
  ok("no rootDomain: host is not a domain lookup", (await who("app.acme.example")) === null)
  ok(
    "no rootDomain: header still resolves",
    (await who("app.acme.example", { "x-org": "bolt" })) === "org_b",
  )
}
const none = await call("/api/whoami")
ok("no tenant: currentTenant is 404", none.status === 404, none.status)
ok("unknown org: 404", (await call("/api/whoami", { org: "nope" })).status === 404)

// --- guards
ok("signed out: 401", (await call("/api/team", { org: "acme" })).status === 401)
ok("member: allowed", (await call("/api/team", { org: "acme", user: "mo" })).status === 200)
ok(
  "member without role: 403",
  (await call("/api/secret", { org: "acme", user: "mo" })).status === 403,
)
ok("owner: allowed", (await call("/api/secret", { org: "acme", user: "alice" })).status === 200)
ok(
  "outsider pointing at another org: 404",
  (await call("/api/team", { org: "acme", user: "bob" })).status === 404,
)
ok(
  "outsider on its custom domain: 404",
  (await call("/api/team", { host: "app.acme.example", user: "bob" })).status === 404,
)

// --- deny by default: Bob (owner of B) against org A, through every route
const asBobOnA = { user: "bob", org: "acme" }
const denied: [string, string, unknown?][] = [
  ["GET", "/api/orgs/current"],
  ["PATCH", "/api/orgs/current", { name: "pwned" }],
  ["GET", "/api/orgs/current/members"],
  ["PATCH", "/api/orgs/current/members/mo", { role: "owner" }],
  ["DELETE", "/api/orgs/current/members/mo"],
  ["GET", "/api/orgs/current/invites"],
  ["POST", "/api/orgs/current/invites", { role: "owner" }],
  ["DELETE", "/api/orgs/current/invites/inv_1"],
]
for (const [m, p, b] of denied) {
  const r = await call(p, asBobOnA, send(m, b))
  ok(`outsider ${m} ${p}: 404`, r.status === 404, r.status)
}
ok("A unchanged", orgsById.get("org_a")?.name === "ACME" && members.some((m) => m.userId === "mo"))
const sw = await call("/api/orgs/switch", { user: "bob" }, send("POST", { orgId: "org_a" }))
ok("cannot switch into an org you are not in", sw.status === 404 && !sw.headers.get("set-cookie"))

// --- members within the org
const mine = await j(await call("/api/orgs", { user: "alice" }))
ok("my orgs", mine.orgs.length === 1 && mine.orgs[0].org.id === "org_a")
const cur = await j(await call("/api/orgs/current", { user: "dev", org: "acme" }))
ok(
  "current: role and permissions",
  cur.role === "admin" && cur.permissions.includes("members:invite"),
)
ok(
  "member cannot change settings: 403",
  (await call("/api/orgs/current", { user: "mo", org: "acme" }, send("PATCH", { name: "x" })))
    .status === 403,
)
const upd = await call(
  "/api/orgs/current",
  { user: "dev", org: "acme" },
  send("PATCH", { name: "Acme 2", junk: 1 }),
)
ok("admin changes settings", upd.status === 200 && (await j(upd)).org.name === "Acme 2")
ok(
  "member cannot remove others: 403",
  (await call("/api/orgs/current/members/dev", { user: "mo", org: "acme" }, send("DELETE")))
    .status === 403,
)
const list = await j(await call("/api/orgs/current/members", { user: "mo", org: "acme" }))
ok(
  "member list is this org only",
  list.members.every((m: { orgId: string }) => m.orgId === "org_a") && list.members.length === 3,
)
ok(
  "store errors become the envelope",
  (
    await call(
      "/api/orgs/current/members/ghost",
      { user: "dev", org: "acme" },
      send("PATCH", { role: "member" }),
    )
  ).status === 404,
)
ok(
  "bad JSON: 400",
  (
    await call(
      "/api/orgs/current/invites",
      { user: "dev", org: "acme" },
      { method: "POST", body: "{" },
    )
  ).status === 400,
)

// --- invites
const made = await call(
  "/api/orgs/current/invites",
  { user: "dev", org: "acme" },
  send("POST", { role: "member", email: "zed@example.com" }),
)
const { token, invitation } = await j(made)
ok(
  "invite created",
  made.status === 201 && typeof token === "string" && invitation.orgId === "org_a",
)
ok(
  "member cannot invite: 403",
  (
    await call(
      "/api/orgs/current/invites",
      { user: "mo", org: "acme" },
      send("POST", { role: "member" }),
    )
  ).status === 403,
)
const preview = await j(await call(`/api/orgs/invites/${token}`))
ok("preview", preview.org.name === "Acme 2" && preview.role === "member" && !("token" in preview))
ok(
  "accept needs sign-in",
  (await call(`/api/orgs/invites/${token}/accept`, {}, send("POST"))).status === 401,
)
const wrong = await call(
  `/api/orgs/invites/${token}/accept`,
  { user: "zed", email: "x@example.com" },
  send("POST"),
)
ok(
  "email mismatch: 400 with reason",
  wrong.status === 400 && (await j(wrong)).code === "INVITE_EMAIL_MISMATCH",
)
const acc = await call(
  `/api/orgs/invites/${token}/accept`,
  { user: "zed", email: "zed@example.com" },
  send("POST"),
)
ok(
  "accept joins and switches",
  acc.status === 200 && (acc.headers.get("set-cookie") ?? "").includes("signet_org=org_a"),
)
ok("zed is in A only", !!(await membership("org_a", "zed")) && !(await membership("org_b", "zed")))
const inv2 = await j(
  await call(
    "/api/orgs/current/invites",
    { user: "alice", org: "acme" },
    send("POST", { role: "member" }),
  ),
)
ok(
  "B's owner cannot revoke A's invite",
  (
    await call(
      `/api/orgs/current/invites/${inv2.invitation.id}`,
      { user: "bob", org: "bolt" },
      send("DELETE"),
    )
  ).status === 404,
)
ok(
  "A's admin revokes",
  (
    await call(
      `/api/orgs/current/invites/${inv2.invitation.id}`,
      { user: "dev", org: "acme" },
      send("DELETE"),
    )
  ).status === 200,
)

// --- switch, create, leave
const s2 = await call("/api/orgs/switch", { user: "alice" }, send("POST", { orgId: "org_a" }))
ok(
  "switch sets the cookie",
  s2.status === 200 &&
    /signet_org=org_a; Path=\/; HttpOnly; SameSite=Lax/.test(s2.headers.get("set-cookie") ?? ""),
)
const created = await call("/api/orgs", { user: "zed" }, send("POST", { name: "Zeta" }))
ok("create org", created.status === 201 && (await j(created)).role === "owner")
ok(
  "create needs a name",
  (await call("/api/orgs", { user: "zed" }, send("POST", {}))).status === 400,
)
ok(
  "a member may leave",
  (await call("/api/orgs/current/members/zed", { user: "zed", org: "acme" }, send("DELETE")))
    .status === 200,
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
/**
 * tenant(), orgGuards() and orgRoutes(): the tenant resolves from domain,
 * subdomain, param, header and cookie; guards answer 401/404/403; and org A's
 * members can never read or change org B through any route (deny by default).
 * The store is an in-memory stand-in shaped like signet-db's createOrgs; the
 * real store's own isolation is tested in signet-db.
 */
import { Hono } from "hono"
import { errorHandler } from "../src/http/errors"
import {
  currentTenant,
  grants,
  type OrgStore,
  orgGuards,
  orgRoutes,
  type TenantOrg,
  tenant,
} from "../src/http/orgs"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

/** Like signet-db's OrgError: a SignetDbError with an HTTP status. */
class FakeOrgError extends Error {
  readonly name = "SignetDbError"
  constructor(
    readonly status: 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const ROLES: Record<string, string[]> = {
  owner: ["*"],
  admin: ["org:update", "members:read", "members:invite", "members:manage"],
  member: ["members:read"],
}
const orgsById = new Map<string, TenantOrg>()
const members: { orgId: string; userId: string; role: string; createdAt: Date }[] = []
const invites: {
  id: string
  orgId: string
  token: string
  email: string | null
  role: string
  invitedBy: string
  createdAt: Date
  expiresAt: Date
  status: string
}[] = []
const mk = (id: string, slug: string, domain: string | null = null) =>
  orgsById.set(id, { id, name: slug.toUpperCase(), slug, domain, theme: null, brandColor: null })
mk("org_a", "acme", "app.acme.example")
mk("org_b", "bolt")
const join = (orgId: string, userId: string, role: string) =>
  members.push({ orgId, userId, role, createdAt: new Date() })
join("org_a", "alice", "owner")
join("org_a", "dev", "admin")
join("org_a", "mo", "member")
join("org_b", "bob", "owner")

const membership = async (orgId: string, userId: string) => {
  const m = members.find((x) => x.orgId === orgId && x.userId === userId)
  return m ? { ...m, permissions: ROLES[m.role] ?? [] } : null
}
const mustManage = async (orgId: string, by: string | undefined, perm: string) => {
  const m = by ? await membership(orgId, by) : null
  if (!m || !grants(m.permissions, perm)) throw new FakeOrgError(403, "FORBIDDEN", "No.")
}
const store: OrgStore = {
  get: async (id) => orgsById.get(id) ?? null,
  bySlug: async (s) => [...orgsById.values()].find((o) => o.slug === s) ?? null,
  byDomain: async (h) => [...orgsById.values()].find((o) => o.domain === h) ?? null,
  membership,
  create: async ({ name, ownerId }) => {
    const id = `org_${orgsById.size + 1}`
    mk(id, name.toLowerCase())
    join(id, ownerId, "owner")
    return orgsById.get(id) as TenantOrg
  },
  update: async (orgId, s, { by }) => {
    await mustManage(orgId, by, "org:update")
    const o = { ...(orgsById.get(orgId) as TenantOrg), ...s } as TenantOrg
    orgsById.set(orgId, o)
    return o
  },
  listForUser: async (u) =>
    members
      .filter((m) => m.userId === u)
      .map((m) => ({ org: orgsById.get(m.orgId) as TenantOrg, role: m.role })),
  members: async (orgId) => members.filter((m) => m.orgId === orgId),
  roles: async () => ROLES,
  setRole: async (orgId, userId, role, { by }) => {
    const t = members.find((m) => m.orgId === orgId && m.userId === userId)
    if (!t) throw new FakeOrgError(404, "NOT_FOUND", "No such member.")
    await mustManage(orgId, by, "members:manage")
    t.role = role
    return t
  },
  removeMember: async (orgId, userId, { by }) => {
    const i = members.findIndex((m) => m.orgId === orgId && m.userId === userId)
    if (i < 0) throw new FakeOrgError(404, "NOT_FOUND", "No such member.")
    if (by !== userId) await mustManage(orgId, by, "members:manage")
    members.splice(i, 1)
  },
  invite: async ({ orgId, role, invitedBy, email }) => {
    await mustManage(orgId, invitedBy, "members:invite")
    const inv = {
      id: `inv_${invites.length + 1}`,
      orgId,
      token: `tok_${invites.length + 1}`,
      email: email ?? null,
      role,
      invitedBy,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "pending",
    }
    invites.push(inv)
    const { token, ...invitation } = inv
    return { invitation, token }
  },
  invitations: async (orgId) => invites.filter((i) => i.orgId === orgId && i.status === "pending"),
  revokeInvite: async (orgId, id, { by }) => {
    await mustManage(orgId, by, "members:invite")
    const i = invites.find((x) => x.id === id && x.orgId === orgId && x.status === "pending")
    if (i) i.status = "revoked"
    return !!i
  },
  previewInvite: async (token) => {
    const i = invites.find((x) => x.token === token)
    return i ? { invitation: i, org: orgsById.get(i.orgId) as TenantOrg } : null
  },
  acceptInvite: async (token, { userId, email }) => {
    const i = invites.find((x) => x.token === token)
    if (!i) return { ok: false, reason: "not_found" }
    if (i.status !== "pending")
      return { ok: false, reason: i.status === "revoked" ? "revoked" : "used" }
    if (i.email && i.email !== email) return { ok: false, reason: "email_mismatch" }
    i.status = "accepted"
    join(i.orgId, userId, i.role)
    return {
      ok: true,
      membership: members[members.length - 1] as (typeof members)[number],
      org: orgsById.get(i.orgId) as TenantOrg,
      already: false,
    }
  },
}

const userId = (c: { req: { header(n: string): string | undefined } }) => c.req.header("x-user")
const app = new Hono()
app.onError(errorHandler({ isProduction: () => true }))
app.use("*", tenant({ orgs: store, rootDomain: "app.example" }))
app.route(
  "/api/orgs",
  orgRoutes({
    orgs: store,
    userId,
    email: (c) => c.req.header("x-email"),
    cookieOptions: { secure: false },
  }),
)
const { requirePermission, requireRole } = orgGuards({ orgs: store, userId })
app.get("/api/whoami", (c) => c.json({ org: currentTenant(c).id }))
app.get("/api/secret", requireRole("owner"), (c) => c.json({ org: currentTenant(c).id }))
app.get("/api/team", requirePermission("members:read"), (c) => c.json({ org: currentTenant(c).id }))
app.use("/t/:org/*", tenant({ orgs: store, param: "org", header: false, cookie: false }))
app.get("/t/:org/where", (c) => c.json({ org: currentTenant(c).id }))

type Opts = { user?: string; org?: string; host?: string; cookie?: string; email?: string }
const call = (path: string, o: Opts = {}, init: RequestInit = {}) =>
  app.request(`http://${o.host ?? "app.example"}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(o.user ? { "x-user": o.user } : {}),
      ...(o.org ? { "x-org": o.org } : {}),
      ...(o.cookie ? { cookie: o.cookie } : {}),
      ...(o.email ? { "x-email": o.email } : {}),
      ...(init.headers as Record<string, string>),
    },
  })
const j = async (r: Response) => (await r.json()) as Record<string, any>
const send = (method: string, body?: unknown) => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
})

// --- tenant resolution
ok(
  "custom domain",
  (await j(await call("/api/whoami", { host: "app.acme.example" }))).org === "org_a",
)
ok("subdomain", (await j(await call("/api/whoami", { host: "bolt.app.example" }))).org === "org_b")
ok("header by slug", (await j(await call("/api/whoami", { org: "acme" }))).org === "org_a")
ok("header by id", (await j(await call("/api/whoami", { org: "org_b" }))).org === "org_b")
ok("cookie", (await j(await call("/api/whoami", { cookie: "signet_org=org_b" }))).org === "org_b")
ok("path param", (await j(await call("/t/bolt/where"))).org === "org_b")
ok(
  "domain beats header",
  (await j(await call("/api/whoami", { host: "app.acme.example", org: "bolt" }))).org === "org_a",
)
const none = await call("/api/whoami")
ok("no tenant: currentTenant is 404", none.status === 404, none.status)
ok("unknown org: 404", (await call("/api/whoami", { org: "nope" })).status === 404)

// --- guards
ok("signed out: 401", (await call("/api/team", { org: "acme" })).status === 401)
ok("member: allowed", (await call("/api/team", { org: "acme", user: "mo" })).status === 200)
ok(
  "member without role: 403",
  (await call("/api/secret", { org: "acme", user: "mo" })).status === 403,
)
ok("owner: allowed", (await call("/api/secret", { org: "acme", user: "alice" })).status === 200)
ok(
  "outsider pointing at another org: 404",
  (await call("/api/team", { org: "acme", user: "bob" })).status === 404,
)
ok(
  "outsider on its custom domain: 404",
  (await call("/api/team", { host: "app.acme.example", user: "bob" })).status === 404,
)

// --- deny by default: Bob (owner of B) against org A, through every route
const asBobOnA = { user: "bob", org: "acme" }
const denied: [string, string, unknown?][] = [
  ["GET", "/api/orgs/current"],
  ["PATCH", "/api/orgs/current", { name: "pwned" }],
  ["GET", "/api/orgs/current/members"],
  ["PATCH", "/api/orgs/current/members/mo", { role: "owner" }],
  ["DELETE", "/api/orgs/current/members/mo"],
  ["GET", "/api/orgs/current/invites"],
  ["POST", "/api/orgs/current/invites", { role: "owner" }],
  ["DELETE", "/api/orgs/current/invites/inv_1"],
]
for (const [m, p, b] of denied) {
  const r = await call(p, asBobOnA, send(m, b))
  ok(`outsider ${m} ${p}: 404`, r.status === 404, r.status)
}
ok("A unchanged", orgsById.get("org_a")?.name === "ACME" && members.some((m) => m.userId === "mo"))
const sw = await call("/api/orgs/switch", { user: "bob" }, send("POST", { orgId: "org_a" }))
ok("cannot switch into an org you are not in", sw.status === 404 && !sw.headers.get("set-cookie"))

// --- members within the org
const mine = await j(await call("/api/orgs", { user: "alice" }))
ok("my orgs", mine.orgs.length === 1 && mine.orgs[0].org.id === "org_a")
const cur = await j(await call("/api/orgs/current", { user: "dev", org: "acme" }))
ok(
  "current: role and permissions",
  cur.role === "admin" && cur.permissions.includes("members:invite"),
)
ok(
  "member cannot change settings: 403",
  (await call("/api/orgs/current", { user: "mo", org: "acme" }, send("PATCH", { name: "x" })))
    .status === 403,
)
const upd = await call(
  "/api/orgs/current",
  { user: "dev", org: "acme" },
  send("PATCH", { name: "Acme 2", junk: 1 }),
)
ok("admin changes settings", upd.status === 200 && (await j(upd)).org.name === "Acme 2")
const hijack = await call(
  "/api/orgs/current",
  { user: "dev", org: "acme" },
  send("PATCH", { name: "Acme 2", domain: "app.example" }),
)
ok(
  "PATCH /current ignores domain",
  hijack.status === 200 && (await j(hijack)).org.domain === orgsById.get("org_a")?.domain,
)
ok("no org claimed the host", ![...orgsById.values()].some((o) => o.domain === "app.example"))
ok(
  "member cannot remove others: 403",
  (await call("/api/orgs/current/members/dev", { user: "mo", org: "acme" }, send("DELETE")))
    .status === 403,
)
const list = await j(await call("/api/orgs/current/members", { user: "mo", org: "acme" }))
ok(
  "member list is this org only",
  list.members.every((m: { orgId: string }) => m.orgId === "org_a") && list.members.length === 3,
)
ok(
  "store errors become the envelope",
  (
    await call(
      "/api/orgs/current/members/ghost",
      { user: "dev", org: "acme" },
      send("PATCH", { role: "member" }),
    )
  ).status === 404,
)
ok(
  "bad JSON: 400",
  (
    await call(
      "/api/orgs/current/invites",
      { user: "dev", org: "acme" },
      { method: "POST", body: "{" },
    )
  ).status === 400,
)

// --- invites
const made = await call(
  "/api/orgs/current/invites",
  { user: "dev", org: "acme" },
  send("POST", { role: "member", email: "zed@example.com" }),
)
const { token, invitation } = await j(made)
ok(
  "invite created",
  made.status === 201 && typeof token === "string" && invitation.orgId === "org_a",
)
ok(
  "member cannot invite: 403",
  (
    await call(
      "/api/orgs/current/invites",
      { user: "mo", org: "acme" },
      send("POST", { role: "member" }),
    )
  ).status === 403,
)
const preview = await j(await call(`/api/orgs/invites/${token}`))
ok("preview", preview.org.name === "Acme 2" && preview.role === "member" && !("token" in preview))
ok(
  "accept needs sign-in",
  (await call(`/api/orgs/invites/${token}/accept`, {}, send("POST"))).status === 401,
)
const wrong = await call(
  `/api/orgs/invites/${token}/accept`,
  { user: "zed", email: "x@example.com" },
  send("POST"),
)
ok(
  "email mismatch: 400 with reason",
  wrong.status === 400 && (await j(wrong)).reason === "email_mismatch",
)
const acc = await call(
  `/api/orgs/invites/${token}/accept`,
  { user: "zed", email: "zed@example.com" },
  send("POST"),
)
ok(
  "accept joins and switches",
  acc.status === 200 && (acc.headers.get("set-cookie") ?? "").includes("signet_org=org_a"),
)
ok("zed is in A only", !!(await membership("org_a", "zed")) && !(await membership("org_b", "zed")))
const inv2 = await j(
  await call(
    "/api/orgs/current/invites",
    { user: "alice", org: "acme" },
    send("POST", { role: "member" }),
  ),
)
ok(
  "B's owner cannot revoke A's invite",
  (
    await call(
      `/api/orgs/current/invites/${inv2.invitation.id}`,
      { user: "bob", org: "bolt" },
      send("DELETE"),
    )
  ).status === 404,
)
ok(
  "A's admin revokes",
  (
    await call(
      `/api/orgs/current/invites/${inv2.invitation.id}`,
      { user: "dev", org: "acme" },
      send("DELETE"),
    )
  ).status === 200,
)

// --- switch, create, leave
const s2 = await call("/api/orgs/switch", { user: "alice" }, send("POST", { orgId: "org_a" }))
ok(
  "switch sets the cookie",
  s2.status === 200 &&
    /signet_org=org_a; Path=\/; HttpOnly; SameSite=Lax/.test(s2.headers.get("set-cookie") ?? ""),
)
const created = await call("/api/orgs", { user: "zed" }, send("POST", { name: "Zeta" }))
ok("create org", created.status === 201 && (await j(created)).role === "owner")
ok(
  "create needs a name",
  (await call("/api/orgs", { user: "zed" }, send("POST", {}))).status === 400,
)
ok(
  "a member may leave",
  (await call("/api/orgs/current/members/zed", { user: "zed", org: "acme" }, send("DELETE")))
    .status === 200,
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
