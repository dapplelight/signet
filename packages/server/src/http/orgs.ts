/**
 * Multi-tenant Hono pieces on signet-db's `createOrgs` (typed structurally, so
 * this package does not depend on signet-db): resolve the tenant from the
 * request, guard routes by role or permission, and mount org routes for
 * switching, settings, members and invites.
 *
 * ```ts
 * const orgs = createOrgs(db, { tables })
 * const userId = (c: Context) => c.get("session")?.sub
 * app.use("/api/*", tenant({ orgs, rootDomain: "app.example" }))   // c.get("tenant")
 * const { requirePermission } = orgGuards({ orgs, userId })
 * app.get("/api/projects", requirePermission("projects:read"), (c) =>
 *   c.json(scoped(db, { orgId: currentTenant(c).id }).select(projects)))
 * app.route("/api/orgs", orgRoutes({ orgs, userId, email: (c) => c.get("session")?.email }))
 * ```
 *
 * The tenant says which org a request is for; it is not permission. Every
 * guard and route checks the caller's membership in that org, so a header,
 * cookie or path pointing at someone else's org gets 404, never its data.
 */

import { type Context, Hono, type MiddlewareHandler } from "hono"
import { type ApiErrorStatus, ApiException } from "./errors.js"

/** The org fields these pieces read; signet-db's `Org`. */
export type TenantOrg = {
  id: string
  name: string
  slug: string
  domain: string | null
  theme: string | null
  brandColor: string | null
}

export type TenantMembership = {
  orgId: string
  userId: string
  role: string
  permissions: string[]
}

/** What `tenant()` needs: signet-db's `createOrgs(...)` has it. */
export type TenantLookup<O extends TenantOrg = TenantOrg> = {
  get(id: string): Promise<O | null>
  bySlug(slug: string): Promise<O | null>
  byDomain(host: string): Promise<O | null>
}

/** What `orgGuards` needs. */
export type MembershipLookup = {
  membership(orgId: string, userId: string): Promise<TenantMembership | null>
}

type Member = { orgId: string; userId: string; role: string; createdAt: Date }
type Invitation = {
  id: string
  orgId: string
  email: string | null
  role: string
  invitedBy: string
  createdAt: Date
  expiresAt: Date
  status: string
}

/** What `orgRoutes` needs: signet-db's `createOrgs(...)`, as it is. */
export type OrgStore<O extends TenantOrg = TenantOrg> = TenantLookup<O> &
  MembershipLookup & {
    create(input: { name: string; ownerId: string; slug?: string }): Promise<O>
    update(
      orgId: string,
      settings: Partial<Pick<O, "name" | "slug" | "domain" | "theme" | "brandColor">>,
      opts: { by?: string },
    ): Promise<O>
    listForUser(userId: string): Promise<{ org: O; role: string }[]>
    members(orgId: string): Promise<Member[]>
    roles(orgId: string): Promise<Record<string, string[]>>
    setRole(orgId: string, userId: string, role: string, opts: { by?: string }): Promise<Member>
    removeMember(orgId: string, userId: string, opts: { by?: string }): Promise<void>
    invite(input: {
      orgId: string
      role: string
      invitedBy: string
      email?: string
    }): Promise<{ invitation: Invitation; token: string }>
    invitations(orgId: string, opts?: { pending?: boolean }): Promise<Invitation[]>
    revokeInvite(orgId: string, id: string, opts: { by?: string }): Promise<boolean>
    previewInvite(token: string): Promise<{ invitation: Invitation; org: O } | null>
    acceptInvite(
      token: string,
      who: { userId: string; email?: string },
    ): Promise<
      { ok: true; membership: Member; org: O; already: boolean } | { ok: false; reason: string }
    >
  }

/** The tenant `tenant()` resolved. Throws 404 if there is none. */
export function currentTenant<O extends TenantOrg = TenantOrg>(c: Context): O {
  const t = c.get("tenant" as never) as O | undefined
  if (!t) throw new ApiException(404, "Organisation not found.", "NOT_FOUND")
  return t
}

/** The caller's membership a guard checked. */
export function currentMembership(c: Context): TenantMembership {
  const m = c.get("membership" as never) as TenantMembership | undefined
  if (!m) throw new ApiException(403, "Not a member of this organisation.", "FORBIDDEN")
  return m
}

/** Whether a permission set grants `p`: `*`, the exact string, or `prefix:*`. Same rule as signet-db. */
export function grants(perms: readonly string[], p: string): boolean {
  if (perms.includes("*") || perms.includes(p)) return true
  const i = p.indexOf(":")
  return i > 0 && perms.includes(`${p.slice(0, i)}:*`)
}

export type TenantOptions<O extends TenantOrg = TenantOrg> = {
  orgs: TenantLookup<O>
  /**
   * The app's own domain, e.g. "app.example": `acme.app.example` resolves the
   * org with slug `acme`, and hosts outside it are looked up as custom domains.
   * Without it every host is tried as a custom domain.
   */
  rootDomain?: string
  /** A route param holding the org's slug or id, for `/:org/...` routes. */
  param?: string
  /** A header holding the org's slug or id. Default "x-org"; false turns it off. */
  header?: string | false
  /** The cookie `orgRoutes`' switch sets. Default "signet_org"; false turns it off. */
  cookie?: string | false
  /** The request's host. Default the URL's hostname; behind a proxy, read X-Forwarded-Host yourself. */
  host?: (c: Context) => string | undefined
  /** 404 when no org resolves. Default false: routes that need one call `currentTenant(c)`. */
  required?: boolean
}

const readCookie = (header: string | undefined, name: string) => {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=")
    if (i > 0 && part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim())
  }
  return undefined
}

/**
 * Resolve the tenant and set `tenant` in the context. First match wins: the
 * custom domain, the subdomain of `rootDomain`, the route param, the header,
 * the switch cookie.
 */
export function tenant<O extends TenantOrg>(opts: TenantOptions<O>): MiddlewareHandler {
  const root = opts.rootDomain?.toLowerCase().replace(/^\.|\.$/g, "")
  const header = opts.header === undefined ? "x-org" : opts.header
  const cookie = opts.cookie === undefined ? "signet_org" : opts.cookie
  const bySlugOrId = async (v: string | undefined) =>
    v ? ((await opts.orgs.bySlug(v)) ?? (await opts.orgs.get(v))) : null
  return async (c, next) => {
    const host = (opts.host ? opts.host(c) : new URL(c.req.url).hostname)?.toLowerCase()
    let org: O | null = null
    if (host) {
      if (root && host.endsWith(`.${root}`)) {
        const sub = host.slice(0, -root.length - 1)
        if (!sub.includes(".")) org = await opts.orgs.bySlug(sub)
      } else if (host !== root) org = await opts.orgs.byDomain(host)
    }
    if (!org && opts.param) org = await bySlugOrId(c.req.param(opts.param))
    if (!org && header) org = await bySlugOrId(c.req.header(header))
    if (!org && cookie) org = await bySlugOrId(readCookie(c.req.header("cookie"), cookie))
    if (!org && opts.required) throw new ApiException(404, "Organisation not found.", "NOT_FOUND")
    if (org) c.set("tenant" as never, org as never)
    await next()
  }
}

export type OrgGuardOptions = {
  orgs: MembershipLookup
  /** The signed-in user's id, e.g. `(c) => c.get("session")?.sub`. Undefined is 401. */
  userId: (c: Context) => string | null | undefined | Promise<string | null | undefined>
}

/**
 * Route guards on the tenant's membership. Each sets `membership` in the
 * context. 401 signed out; 404 when there is no tenant or the caller is not a
 * member (an outsider learns nothing); 403 for a member without the role or
 * permission.
 */
export function orgGuards(opts: OrgGuardOptions) {
  const check =
    (allow: (m: TenantMembership) => boolean): MiddlewareHandler =>
    async (c, next) => {
      const userId = await opts.userId(c)
      if (!userId) throw new ApiException(401, "Sign in first.", "UNAUTHORIZED")
      const org = currentTenant(c)
      const m = await opts.orgs.membership(org.id, userId)
      if (!m) throw new ApiException(404, "Organisation not found.", "NOT_FOUND")
      if (!allow(m))
        throw new ApiException(403, "You do not have permission to do that.", "FORBIDDEN")
      c.set("membership" as never, m as never)
      await next()
    }
  return {
    /** Any member. */
    requireMember: () => check(() => true),
    /** A member whose role is one of `roles`. */
    requireRole: (...roles: string[]) => check((m) => roles.includes(m.role)),
    /** A member whose role grants every one of `permissions`. */
    requirePermission: (...permissions: string[]) =>
      check((m) => permissions.every((p) => grants(m.permissions, p))),
  }
}

export type OrgRoutesOptions<O extends TenantOrg = TenantOrg> = OrgGuardOptions & {
  orgs: OrgStore<O>
  /** The signed-in user's verified email, checked against an invite's address. */
  email?: (c: Context) => string | null | undefined | Promise<string | null | undefined>
  /** Names and avatars for the member list. Default: ids only. */
  users?: (
    ids: string[],
  ) => Promise<
    Record<string, { name?: string | null; email?: string | null; image?: string | null }>
  >
  /** Send the invite (email, chat). Without it the token is only in the response, for a copy-link UI. */
  onInvite?: (
    c: Context,
    invite: { invitation: Invitation; token: string; org: O },
  ) => Promise<void>
  /** The switch cookie. Must match `tenant({ cookie })`. Default "signet_org". */
  cookie?: string
  /** Cookie attributes. `secure` defaults to true. */
  cookieOptions?: { secure?: boolean; sameSite?: "Strict" | "Lax" | "None"; domain?: string }
}

/** Write signet-db's OrgError (by shape) as the error envelope. */
const isStatusError = (e: unknown): e is Error & { status: ApiErrorStatus; code: string } =>
  e instanceof Error &&
  e.name === "SignetDbError" &&
  typeof (e as { status?: unknown }).status === "number" &&
  typeof (e as { code?: unknown }).code === "string"

const str = (v: unknown, name: string, max = 200) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new ApiException(400, `${name} is required.`, "VALIDATION_FAILED", {
      formErrors: [],
      fieldErrors: { [name]: ["Required"] },
    })
  return v.trim()
}

/**
 * Org routes. Mount with `app.route("/api/orgs", orgRoutes(opts))`, after
 * `tenant()`. All need a signed-in user; `/current/*` act on the tenant and
 * check the caller's membership and permissions there.
 *
 *   GET    /                         my orgs: { orgs: [{ org, role }] }
 *   POST   /                         create one, me as owner: { name, slug? }
 *   POST   /switch                   { orgId }: sets the switch cookie (members only)
 *   GET    /current                  { org, role, permissions, roles }
 *   PATCH  /current                  settings (org:update): { name?, slug?, theme?, brandColor? }
 *                                    "domain" is ignored: whoever holds a host decides the tenant
 *                                    for every request to it, so set it through an operator or
 *                                    verified-DNS flow with `orgs.update`, never from a member.
 *   GET    /current/members          members:read
 *   PATCH  /current/members/:userId  { role } (members:manage, no escalation)
 *   DELETE /current/members/:userId  members:manage, or yourself to leave
 *   GET    /current/invites          pending invites (members:invite)
 *   POST   /current/invites          { email?, role } (members:invite): { invitation, token }
 *   DELETE /current/invites/:id      revoke (members:invite)
 *   GET    /invites/:token           what the invite is for, to show before accepting
 *   POST   /invites/:token/accept    join; sets the switch cookie
 *
 * These are cookie-authenticated writes: put `csrfMiddleware` in front when
 * the session cookie is `SameSite=None`.
 */
export function orgRoutes<O extends TenantOrg>(opts: OrgRoutesOptions<O>) {
  const { orgs } = opts
  const guards = orgGuards(opts)
  const cookieName = opts.cookie ?? "signet_org"
  const setOrgCookie = (c: Context, orgId: string) => {
    const o = opts.cookieOptions ?? {}
    const attrs = [
      `${cookieName}=${encodeURIComponent(orgId)}`,
      "Path=/",
      "HttpOnly",
      `SameSite=${o.sameSite ?? "Lax"}`,
      `Max-Age=${60 * 60 * 24 * 365}`,
      ...(o.secure === false ? [] : ["Secure"]),
      ...(o.domain ? [`Domain=${o.domain}`] : []),
    ]
    c.header("Set-Cookie", attrs.join("; "), { append: true })
  }
  const me = async (c: Context) => {
    const id = await opts.userId(c)
    if (!id) throw new ApiException(401, "Sign in first.", "UNAUTHORIZED")
    return id
  }
  const body = async (c: Context): Promise<Record<string, unknown>> => {
    try {
      const v = await c.req.json()
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
    } catch {
      throw new ApiException(400, "Invalid JSON body", "INVALID_JSON")
    }
  }

  const app = new Hono()
  app.onError((e) => {
    if (isStatusError(e)) throw new ApiException(e.status, e.message, e.code)
    throw e
  })
  return app
    .get("/", async (c) => c.json({ orgs: await orgs.listForUser(await me(c)) }))
    .post("/", async (c) => {
      const b = await body(c)
      const org = await orgs.create({
        name: str(b.name, "name", 100),
        ownerId: await me(c),
        ...(typeof b.slug === "string" && b.slug ? { slug: b.slug } : {}),
      })
      return c.json({ org, role: "owner" }, 201)
    })
    .post("/switch", async (c) => {
      const userId = await me(c)
      const orgId = str((await body(c)).orgId, "orgId")
      const m = await orgs.membership(orgId, userId)
      const org = m ? await orgs.get(orgId) : null
      if (!m || !org) throw new ApiException(404, "Organisation not found.", "NOT_FOUND")
      setOrgCookie(c, org.id)
      return c.json({ org, role: m.role, permissions: m.permissions })
    })
    .get("/current", guards.requireMember(), async (c) => {
      const org = currentTenant<O>(c)
      const m = currentMembership(c)
      return c.json({
        org,
        role: m.role,
        permissions: m.permissions,
        roles: await orgs.roles(org.id),
      })
    })
    .patch("/current", guards.requirePermission("org:update"), async (c) => {
      const b = await body(c)
      const pick = Object.fromEntries(
        (["name", "slug", "theme", "brandColor"] as const)
          .filter((k) => b[k] !== undefined)
          .map((k) => [k, b[k]]),
      )
      const org = await orgs.update(currentTenant(c).id, pick, { by: await me(c) })
      return c.json({ org })
    })
    .get("/current/members", guards.requirePermission("members:read"), async (c) => {
      const list = await orgs.members(currentTenant(c).id)
      const users = opts.users ? await opts.users(list.map((m) => m.userId)) : {}
      return c.json({
        members: list.map((m) => ({ ...m, user: users[m.userId] ?? null })),
      })
    })
    .patch("/current/members/:userId", guards.requirePermission("members:manage"), async (c) => {
      const role = str((await body(c)).role, "role", 40)
      const member = await orgs.setRole(currentTenant(c).id, c.req.param("userId"), role, {
        by: await me(c),
      })
      return c.json({ member })
    })
    .delete("/current/members/:userId", guards.requireMember(), async (c) => {
      const target = c.req.param("userId")
      const by = await me(c)
      if (target !== by && !grants(currentMembership(c).permissions, "members:manage"))
        throw new ApiException(403, "You do not have permission to do that.", "FORBIDDEN")
      await orgs.removeMember(currentTenant(c).id, target, { by })
      return c.json({ removed: 1 })
    })
    .get("/current/invites", guards.requirePermission("members:invite"), async (c) =>
      c.json({ invitations: await orgs.invitations(currentTenant(c).id, { pending: true }) }),
    )
    .post("/current/invites", guards.requirePermission("members:invite"), async (c) => {
      const b = await body(c)
      const org = currentTenant<O>(c)
      const made = await orgs.invite({
        orgId: org.id,
        role: str(b.role, "role", 40),
        invitedBy: await me(c),
        ...(typeof b.email === "string" && b.email.trim() ? { email: b.email } : {}),
      })
      if (opts.onInvite) await opts.onInvite(c, { ...made, org })
      return c.json(made, 201)
    })
    .delete("/current/invites/:id", guards.requirePermission("members:invite"), async (c) => {
      const ok = await orgs.revokeInvite(currentTenant(c).id, c.req.param("id"), {
        by: await me(c),
      })
      if (!ok) throw new ApiException(404, "No such pending invite.", "NOT_FOUND")
      return c.json({ revoked: 1 })
    })
    .get("/invites/:token", async (c) => {
      const p = await orgs.previewInvite(c.req.param("token"))
      if (!p) throw new ApiException(404, "This invite link doesn't work.", "NOT_FOUND")
      const { invitation: i, org } = p
      return c.json({
        org: { id: org.id, name: org.name, slug: org.slug },
        role: i.role,
        email: i.email,
        invitedBy: i.invitedBy,
        expiresAt: i.expiresAt,
        status: i.status,
      })
    })
    .post("/invites/:token/accept", async (c) => {
      const userId = await me(c)
      const email = opts.email ? await opts.email(c) : undefined
      const r = await orgs.acceptInvite(c.req.param("token"), {
        userId,
        ...(email ? { email } : {}),
      })
      if (!r.ok) return c.json({ ok: false as const, reason: r.reason }, 400)
      setOrgCookie(c, r.org.id)
      return c.json({ ok: true as const, org: r.org, role: r.membership.role, already: r.already })
    })
}

/** For `hc<OrgRoutes>`: import it with `import type`, so no server code reaches the browser. */
export type OrgRoutes = ReturnType<typeof orgRoutes>
