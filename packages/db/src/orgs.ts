/**
 * Organisations for multi-tenant apps: orgs with a slug, a custom domain and a
 * theme; memberships with a role; roles that map to permission sets, with
 * custom roles per org; and invitations with expiring tokens.
 *
 * ```ts
 * const orgs = createOrgs(db, { tables: { organizations, memberships, invitations, orgRoles } })
 * const org = await orgs.create({ name: "Acme", ownerId: userId })
 * const { token } = await orgs.invite({ orgId: org.id, email, role: "member", invitedBy: userId })
 * await orgs.acceptInvite(token, { userId: other, email })   // { ok: true, membership } | { ok: false, reason }
 * await orgs.can(org.id, other, "members:invite")           // false
 * const data = scoped(db, { orgId: org.id })                // this org's rows only
 * ```
 *
 * Safe by default:
 * - Roles are permission sets. `owner` holds `*`. Nobody can grant a role
 *   with a permission they do not hold themselves (`by`), and an org always
 *   keeps at least one owner.
 * - Invite tokens are 256 random bits, returned once; only their SHA-256 is
 *   stored. They expire (default 7 days), work once and can be revoked.
 * - Lookups by id are bound to the org: a member, invite or role of another
 *   org reads as not found.
 * - With an audit table (`createDb(..., { audit })`), every write leaves an
 *   entry: the actor (`by`, else the system), the action (`org.create`,
 *   `member.role`, `invite.accept`...), and before/after snapshots that carry
 *   the `orgId`. Invite tokens and their hashes are never logged.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableName,
  gt,
  inArray,
  isNull,
  type Table,
} from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError, type SignetDbErrorCode } from "./errors.js"
import { normalizeEmail } from "./growth.js"
import { newId } from "./id.js"

/** Permission strings. `*` is every permission; `members:*` every `members:` one. */
export type Permission = string
export type RoleMap = Readonly<Record<string, readonly Permission[]>>

/** The permissions signet's own routes and screens check. Apps add their own strings. */
export const ORG_PERMISSIONS = {
  /** Rename the org, set its domain and theme. */
  update: "org:update",
  readMembers: "members:read",
  invite: "members:invite",
  /** Change roles and remove members. */
  manageMembers: "members:manage",
  /** Create and edit custom roles. */
  manageRoles: "roles:manage",
  /** Use the org-scoped admin API. */
  admin: "admin:access",
} as const

/** owner: everything. admin: everything but roles. member: sees the member list. */
export const DEFAULT_ORG_ROLES = {
  owner: ["*"],
  admin: ["org:update", "members:read", "members:invite", "members:manage", "admin:access"],
  member: ["members:read"],
} as const satisfies RoleMap

/** Declare the app's roles. Throws for an empty name or a role without `owner`. */
export function defineRoles<const R extends RoleMap>(roles: R): R {
  for (const [name, perms] of Object.entries(roles)) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name))
      throw new SignetDbError(
        "BAD_CONFIG",
        `Role "${name}": use lower-case letters, digits, - and _.`,
      )
    if (!Array.isArray(perms))
      throw new SignetDbError("BAD_CONFIG", `Role "${name}": expected a list.`)
  }
  return roles
}

/** Whether a permission set grants `permission`. */
export function hasPermission(perms: readonly Permission[], permission: Permission): boolean {
  if (perms.includes("*") || perms.includes(permission)) return true
  const i = permission.indexOf(":")
  return i > 0 && perms.includes(`${permission.slice(0, i)}:*`)
}

/** Whether someone holding `mine` may hand out `theirs`: every permission in it must be one they hold. */
export function canGrant(mine: readonly Permission[], theirs: readonly Permission[]): boolean {
  return mine.includes("*") || theirs.every((p) => p !== "*" && hasPermission(mine, p))
}

export type OrgTables = {
  organizations: Table
  memberships: Table
  invitations: Table
  /** Optional: per-org custom roles. Without it only code roles exist. */
  orgRoles?: Table
}

export type OrgsOptions = {
  tables: OrgTables
  /** Code-defined roles. Default `DEFAULT_ORG_ROLES`. Must include `ownerRole`. */
  roles?: RoleMap
  /** The role an org's creator gets and that an org must always have one of. Default "owner". */
  ownerRole?: string
  /** How long an invite stays valid. Default 7 days. */
  inviteTtlMs?: number
  /** Clock, for tests. */
  now?: () => Date
}

export type Org = {
  id: string
  name: string
  slug: string
  domain: string | null
  theme: string | null
  brandColor: string | null
  personal: boolean
  createdAt: Date
  updatedAt: Date
}

export type OrgSettings = {
  name?: string
  slug?: string
  domain?: string | null
  theme?: string | null
  brandColor?: string | null
}

export type Membership = { orgId: string; userId: string; role: string; createdAt: Date }
export type MembershipWithPermissions = Membership & { permissions: Permission[] }

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired"
export type Invitation = {
  id: string
  orgId: string
  email: string | null
  role: string
  invitedBy: string
  createdAt: Date
  expiresAt: Date
  acceptedAt: Date | null
  acceptedBy: string | null
  revokedAt: Date | null
  status: InvitationStatus
}

export type AcceptInviteResult =
  | { ok: true; membership: Membership; org: Org; already: boolean }
  | { ok: false; reason: "not_found" | "expired" | "used" | "revoked" | "email_mismatch" }

/** Who is acting, for checks that a change does not exceed their own permissions. Omit for system jobs. */
export type By = { by?: string }

/**
 * A deliberate failure with an HTTP status, like admin's `AdminError`, so
 * signet-server's routes turn it into the error envelope.
 */
export class OrgError extends SignetDbError {
  readonly status: 400 | 403 | 404 | 409
  constructor(status: OrgError["status"], code: SignetDbErrorCode, message: string) {
    super(code, message)
    this.status = status
  }
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: org columns are known by name
type Cols = Record<string, any>

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const COLOR = /^#[0-9a-f]{6}$/
const THEME = /^[a-z][a-z0-9-]{0,39}$/

const bad = (m: string) => new OrgError(400, "BAD_INPUT", m)
const notFound = (m: string) => new OrgError(404, "NOT_FOUND", m)
const forbidden = (m: string) => new OrgError(403, "FORBIDDEN", m)

/** "Acme Labs!" → "acme-labs". */
export function slugify(name: string): string {
  return (
    String(name)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "org"
  )
}

/** A host as stored and matched: lower-case, no port, no trailing dot. */
export function normalizeDomain(host: string): string {
  return String(host).trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("")
}

export function createOrgs(db: SignetDb<unknown>, options: OrgsOptions) {
  const o = db.orm as AnyOrm
  const T = options.tables
  const O = T.organizations as unknown as Cols
  const M = T.memberships as unknown as Cols
  const I = T.invitations as unknown as Cols
  const R = T.orgRoles as unknown as Cols | undefined
  const codeRoles: RoleMap = options.roles ?? DEFAULT_ORG_ROLES
  const owner = options.ownerRole ?? "owner"
  const now = options.now ?? (() => new Date())
  const ttl = options.inviteTtlMs ?? 7 * 86_400_000
  if (!Object.hasOwn(codeRoles, owner))
    throw new SignetDbError(
      "BAD_CONFIG",
      `createOrgs: roles must include the owner role "${owner}".`,
    )

  const toOrg = (r: Cols): Org => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    domain: r.domain ?? null,
    theme: r.theme ?? null,
    brandColor: r.brandColor ?? null,
    personal: !!r.personal,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })
  const toMember = (r: Cols): Membership => ({
    orgId: r.orgId,
    userId: r.userId,
    role: r.role,
    createdAt: r.createdAt,
  })
  const toInvite = (r: Cols): Invitation => ({
    id: r.id,
    orgId: r.orgId,
    email: r.email ?? null,
    role: r.role,
    invitedBy: r.invitedBy,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    acceptedAt: r.acceptedAt ?? null,
    acceptedBy: r.acceptedBy ?? null,
    revokedAt: r.revokedAt ?? null,
    status: r.acceptedAt
      ? "accepted"
      : r.revokedAt
        ? "revoked"
        : r.expiresAt.getTime() <= now().getTime()
          ? "expired"
          : "pending",
  })
  const need = (v: unknown, name: string) => {
    if (typeof v !== "string" || !v) throw bad(`${name} is required.`)
  }

  /** One audit entry, when the db has an audit table. Snapshots are tagged with the org. */
  const log = async (
    action: string,
    table: Table,
    rowId: string,
    orgId: string,
    actorId: string | undefined,
    before: object | null,
    after: object | null,
  ) => {
    if (!db.audit) return
    await o.insert(db.audit).values({
      actorType: actorId === undefined ? "system" : "user",
      actorId: actorId ?? "orgs",
      action,
      tableName: getTableName(table),
      rowId,
      before: before && { orgId, ...before },
      after: after && { orgId, ...after },
    })
  }
  const memberKey = (orgId: string, userId: string) => `${orgId}|${userId}`

  const first = async (table: Table, where: unknown): Promise<Cols | undefined> =>
    (await o.select().from(table).where(where).limit(1))[0]

  const get = async (id: string): Promise<Org | null> => {
    if (typeof id !== "string" || !id) return null
    const r = await first(T.organizations, eq(O.id, id))
    return r ? toOrg(r) : null
  }
  const mustGet = async (id: string) => {
    const org = await get(id)
    if (!org) throw notFound("No such organisation.")
    return org
  }

  // ---------------------------------------------------------------- roles

  /** Custom roles of one org, by name. */
  const customRoles = async (orgId: string): Promise<Record<string, Permission[]>> => {
    // No prototype: a role named `constructor` or `__proto__` must not resolve to an inherited member.
    const map: Record<string, Permission[]> = Object.create(null)
    if (!R) return map
    const rows: Cols[] = await o.select().from(T.orgRoles).where(eq(R.orgId, orgId))
    for (const r of rows) map[r.name] = (r.permissions ?? []) as Permission[]
    return map
  }
  /** A role's permissions in an org: code roles first, then the org's custom roles. Unknown roles get none. */
  const permissionsOf = async (orgId: string, role: string): Promise<Permission[] | null> => {
    if (Object.hasOwn(codeRoles, role)) return [...(codeRoles[role] ?? [])]
    const perms = (await customRoles(orgId))[role]
    return Array.isArray(perms) ? perms : null
  }
  const roleExists = async (orgId: string, role: string) => {
    if (typeof role !== "string" || !role) throw bad("role is required.")
    const perms = await permissionsOf(orgId, role)
    if (!perms) throw bad(`No role "${role}" in this organisation.`)
    return perms
  }

  const membership = async (
    orgId: string,
    userId: string,
  ): Promise<MembershipWithPermissions | null> => {
    if (!orgId || !userId) return null
    const r = await first(T.memberships, and(eq(M.orgId, orgId), eq(M.userId, userId)))
    if (!r) return null
    return { ...toMember(r), permissions: (await permissionsOf(orgId, r.role)) ?? [] }
  }

  /** Throws unless `by` (when given) is a member who may grant `role`'s permissions. */
  const mayGrant = async (
    orgId: string,
    by: string | undefined,
    perms: Permission[],
    need: Permission,
  ) => {
    if (by === undefined) return
    const me = await membership(orgId, by)
    if (!me || !hasPermission(me.permissions, need))
      throw forbidden("You do not have permission to do that in this organisation.")
    if (!canGrant(me.permissions, perms))
      throw forbidden("You cannot hand out a role with permissions you do not have.")
  }

  const owners = async (orgId: string) =>
    Number(
      (
        await o
          .select({ n: count() })
          .from(T.memberships)
          .where(and(eq(M.orgId, orgId), eq(M.role, owner)))
      )[0]?.n ?? 0,
    )

  // ------------------------------------------------------------- settings

  const cleanSettings = (s: OrgSettings): Cols => {
    const out: Cols = {}
    if (s.name !== undefined) {
      const name = String(s.name).trim()
      if (!name || name.length > 100) throw bad("name must be 1 to 100 characters.")
      out.name = name
    }
    if (s.slug !== undefined) {
      if (!SLUG.test(s.slug)) throw bad("slug: lower-case letters, digits and dashes, up to 48.")
      out.slug = s.slug
    }
    if (s.domain !== undefined) {
      const d = s.domain === null || s.domain === "" ? null : normalizeDomain(s.domain)
      if (d !== null && !DOMAIN.test(d)) throw bad(`"${s.domain}" is not a domain name.`)
      out.domain = d
    }
    if (s.theme !== undefined) {
      if (s.theme !== null && s.theme !== "" && !THEME.test(s.theme))
        throw bad("theme must be a theme name.")
      out.theme = s.theme || null
    }
    if (s.brandColor !== undefined) {
      const c = s.brandColor ? s.brandColor.trim().toLowerCase() : null
      if (c !== null && !COLOR.test(c)) throw bad("brandColor must be a colour like #12833c.")
      out.brandColor = c
    }
    return out
  }
  const assertFree = async (values: Cols, self?: string) => {
    for (const k of ["slug", "domain"] as const) {
      if (values[k] == null) continue
      const r = await first(T.organizations, eq(O[k], values[k]))
      if (r && r.id !== self) throw new OrgError(409, "CONFLICT", `That ${k} is taken.`)
    }
  }

  return {
    /** The role names and permissions code defines (custom roles: `roles(orgId)`). */
    codeRoles,
    ownerRole: owner,
    permissionsOf,

    // ----------------------------------------------------------- orgs

    /** A new org; `ownerId` becomes its owner. The slug comes from the name when not given, made unique. */
    async create(
      input: OrgSettings & { name: string; ownerId: string; personal?: boolean },
    ): Promise<Org> {
      need(input.ownerId, "ownerId")
      const values = cleanSettings({ ...input, slug: input.slug ?? slugify(input.name) })
      if (input.slug === undefined) {
        const base = values.slug as string
        while (await first(T.organizations, eq(O.slug, values.slug)))
          values.slug = `${base.slice(0, 40)}-${newId().slice(-5).toLowerCase()}`
      }
      await assertFree(values)
      const at = now()
      const row = {
        ...values,
        id: newId(),
        personal: !!input.personal,
        createdAt: at,
        updatedAt: at,
      }
      // One atomic group, so an org never exists without its owner.
      await db.batch([
        (tx) => (tx as AnyOrm).insert(T.organizations).values(row),
        (tx) =>
          (tx as AnyOrm)
            .insert(T.memberships)
            .values({ orgId: row.id, userId: input.ownerId, role: owner, createdAt: at }),
      ])
      const org = toOrg(row)
      await log("org.create", T.organizations, org.id, org.id, input.ownerId, null, org)
      return org
    },
    get,
    async bySlug(slug: string): Promise<Org | null> {
      if (typeof slug !== "string" || !SLUG.test(slug)) return null
      const r = await first(T.organizations, eq(O.slug, slug))
      return r ? toOrg(r) : null
    },
    /** The org whose custom domain is `host` (any case, port ignored). */
    async byDomain(host: string): Promise<Org | null> {
      if (typeof host !== "string" || !host) return null
      const r = await first(T.organizations, eq(O.domain, normalizeDomain(host)))
      return r ? toOrg(r) : null
    },
    /** Rename the org, change its slug, domain, theme or brand colour. `by` needs `org:update`. */
    async update(orgId: string, settings: OrgSettings, opts: By = {}): Promise<Org> {
      await mustGet(orgId)
      if (opts.by !== undefined) {
        const me = await membership(orgId, opts.by)
        if (!me || !hasPermission(me.permissions, ORG_PERMISSIONS.update))
          throw forbidden("You cannot change this organisation's settings.")
      }
      const values = cleanSettings(settings)
      if (Object.keys(values).length === 0) throw bad("Nothing to change.")
      await assertFree(values, orgId)
      const before = await mustGet(orgId)
      const [row] = await o.update(T.organizations).set(values).where(eq(O.id, orgId)).returning()
      const after = toOrg(row)
      await log("org.update", T.organizations, orgId, orgId, opts.by, before, after)
      return after
    },
    /** Every org the user belongs to, with their role, oldest membership first. */
    async listForUser(userId: string): Promise<{ org: Org; role: string }[]> {
      need(userId, "userId")
      const ms: Cols[] = await o
        .select()
        .from(T.memberships)
        .where(eq(M.userId, userId))
        .orderBy(asc(M.createdAt))
      if (ms.length === 0) return []
      const orgs: Cols[] = await o
        .select()
        .from(T.organizations)
        .where(
          inArray(
            O.id,
            ms.map((m) => m.orgId),
          ),
        )
      const byId = new Map(orgs.map((r) => [r.id, toOrg(r)]))
      return ms.flatMap((m) => {
        const org = byId.get(m.orgId)
        return org ? [{ org, role: m.role as string }] : []
      })
    },

    // ------------------------------------------------------- members

    membership,
    /** Whether the user is a member whose role grants `permission`. */
    async can(orgId: string, userId: string, permission: Permission): Promise<boolean> {
      const m = await membership(orgId, userId)
      return !!m && hasPermission(m.permissions, permission)
    },
    /** Members, oldest first. */
    async members(orgId: string): Promise<Membership[]> {
      const rows: Cols[] = await o
        .select()
        .from(T.memberships)
        .where(eq(M.orgId, orgId))
        .orderBy(asc(M.createdAt), asc(M.userId))
      return rows.map(toMember)
    },
    /** Add someone directly (no invite). `by` needs `members:manage` and every permission of `role`. */
    async addMember(
      orgId: string,
      userId: string,
      role: string,
      opts: By = {},
    ): Promise<Membership> {
      need(userId, "userId")
      await mustGet(orgId)
      await mayGrant(orgId, opts.by, await roleExists(orgId, role), ORG_PERMISSIONS.manageMembers)
      if (await membership(orgId, userId)) throw new OrgError(409, "CONFLICT", "Already a member.")
      const [row] = await o
        .insert(T.memberships)
        .values({ orgId, userId, role, createdAt: now() })
        .returning()
      const added = toMember(row)
      await log("member.add", T.memberships, memberKey(orgId, userId), orgId, opts.by, null, added)
      return added
    },
    /** Change a member's role. `by` needs `members:manage` and may not grant or remove more than they hold. */
    async setRole(orgId: string, userId: string, role: string, opts: By = {}): Promise<Membership> {
      const target = await membership(orgId, userId)
      if (!target) throw notFound("No such member.")
      const perms = await roleExists(orgId, role)
      await mayGrant(orgId, opts.by, perms, ORG_PERMISSIONS.manageMembers)
      await mayGrant(orgId, opts.by, target.permissions, ORG_PERMISSIONS.manageMembers)
      if (target.role === owner && role !== owner && (await owners(orgId)) <= 1)
        throw new OrgError(409, "CONFLICT", "An organisation needs at least one owner.")
      const [row] = await o
        .update(T.memberships)
        .set({ role })
        .where(and(eq(M.orgId, orgId), eq(M.userId, userId)))
        .returning()
      const after = toMember(row)
      const { permissions: _p, ...before } = target
      await log(
        "member.role",
        T.memberships,
        memberKey(orgId, userId),
        orgId,
        opts.by,
        before,
        after,
      )
      return after
    },
    /** Remove a member, or leave (`by` is the member). Others need `members:manage` and to outrank them. */
    async removeMember(orgId: string, userId: string, opts: By = {}): Promise<void> {
      const target = await membership(orgId, userId)
      if (!target) throw notFound("No such member.")
      if (opts.by !== userId)
        await mayGrant(orgId, opts.by, target.permissions, ORG_PERMISSIONS.manageMembers)
      if (target.role === owner && (await owners(orgId)) <= 1)
        throw new OrgError(409, "CONFLICT", "An organisation needs at least one owner.")
      await o.delete(T.memberships).where(and(eq(M.orgId, orgId), eq(M.userId, userId)))
      const { permissions: _p, ...before } = target
      const action = opts.by === userId ? "member.leave" : "member.remove"
      await log(action, T.memberships, memberKey(orgId, userId), orgId, opts.by, before, null)
    },

    // --------------------------------------------------- custom roles

    /** Code roles and the org's custom roles, name → permissions. */
    async roles(orgId: string): Promise<Record<string, Permission[]>> {
      return {
        ...(await customRoles(orgId)),
        ...Object.fromEntries(Object.entries(codeRoles).map(([k, v]) => [k, [...v]])),
      }
    },
    /** Create or replace a custom role. `by` needs `roles:manage` and every permission it grants. */
    async saveRole(
      orgId: string,
      name: string,
      permissions: Permission[],
      opts: By = {},
    ): Promise<void> {
      if (!R) throw new SignetDbError("BAD_CONFIG", "saveRole needs tables.orgRoles.")
      await mustGet(orgId)
      defineRoles({ [name]: permissions })
      if (Object.hasOwn(codeRoles, name)) throw bad(`"${name}" is a built-in role.`)
      if (!permissions.every((p) => typeof p === "string" && p.length > 0 && p.length <= 80))
        throw bad("permissions must be non-empty strings.")
      await mayGrant(orgId, opts.by, permissions, ORG_PERMISSIONS.manageRoles)
      const where = and(eq(R.orgId, orgId), eq(R.name, name))
      const old = await first(T.orgRoles as Table, where)
      if (old) await o.update(T.orgRoles).set({ permissions }).where(where)
      else await o.insert(T.orgRoles).values({ orgId, name, permissions })
      const before = old ? { name, permissions: old.permissions } : null
      const action = old ? "role.update" : "role.create"
      await log(action, T.orgRoles as Table, `${orgId}|${name}`, orgId, opts.by, before, {
        name,
        permissions,
      })
    },
    /** Delete a custom role nobody holds. */
    async deleteRole(orgId: string, name: string, opts: By = {}): Promise<boolean> {
      if (!R) return false
      const perms = (await customRoles(orgId))[name]
      if (!perms) return false
      await mayGrant(orgId, opts.by, perms, ORG_PERMISSIONS.manageRoles)
      const held = await first(T.memberships, and(eq(M.orgId, orgId), eq(M.role, name)))
      if (held) throw new OrgError(409, "CONFLICT", "Move members off this role first.")
      await o.delete(T.orgRoles).where(and(eq(R.orgId, orgId), eq(R.name, name)))
      const before = { name, permissions: perms }
      await log(
        "role.delete",
        T.orgRoles as Table,
        `${orgId}|${name}`,
        orgId,
        opts.by,
        before,
        null,
      )
      return true
    },

    // -------------------------------------------------------- invites

    /** A new invite and its token. Send the token in a link; it is not stored and cannot be shown again. */
    async invite(input: {
      orgId: string
      role: string
      invitedBy: string
      email?: string
      ttlMs?: number
    }): Promise<{ invitation: Invitation; token: string }> {
      need(input.invitedBy, "invitedBy")
      await mustGet(input.orgId)
      const perms = await roleExists(input.orgId, input.role)
      await mayGrant(input.orgId, input.invitedBy, perms, ORG_PERMISSIONS.invite)
      const life = input.ttlMs ?? ttl
      if (!(life > 0)) throw bad("ttlMs must be positive.")
      const token = base64url(crypto.getRandomValues(new Uint8Array(32)))
      const at = now()
      const [row] = await o
        .insert(T.invitations)
        .values({
          orgId: input.orgId,
          tokenHash: await sha256Hex(token),
          email: input.email ? normalizeEmail(input.email) : null,
          role: input.role,
          invitedBy: input.invitedBy,
          createdAt: at,
          expiresAt: new Date(at.getTime() + life),
        })
        .returning()
      const invitation = toInvite(row)
      await log(
        "invite.create",
        T.invitations,
        invitation.id,
        input.orgId,
        input.invitedBy,
        null,
        invitation,
      )
      return { invitation, token }
    },
    /** The invite a token is for, with its org, to show before accepting. Null if unknown. */
    async previewInvite(token: string): Promise<{ invitation: Invitation; org: Org } | null> {
      if (typeof token !== "string" || !token) return null
      const r = await first(T.invitations, eq(I.tokenHash, await sha256Hex(token)))
      const org = r ? await get(r.orgId) : null
      return r && org ? { invitation: toInvite(r), org } : null
    },
    /**
     * Accept an invite once and join its org with its role. The same user
     * accepting again gets `already: true`. When the invite names an email,
     * `email` must match it (pass the account's verified address).
     */
    async acceptInvite(
      token: string,
      who: { userId: string; email?: string },
    ): Promise<AcceptInviteResult> {
      need(who.userId, "userId")
      if (typeof token !== "string" || !token) return { ok: false, reason: "not_found" }
      const hash = await sha256Hex(token)
      const find = () => first(T.invitations, eq(I.tokenHash, hash))
      const done = async (r: Cols, already: boolean): Promise<AcceptInviteResult> => {
        const m = await membership(r.orgId, who.userId)
        const org = await get(r.orgId)
        if (!m || !org) return { ok: false, reason: "not_found" }
        const { permissions: _p, ...membership_ } = m
        return { ok: true, membership: membership_, org, already }
      }
      const classify = async (r: Cols): Promise<AcceptInviteResult | null> => {
        if (r.acceptedAt)
          return r.acceptedBy === who.userId ? done(r, true) : { ok: false, reason: "used" }
        if (r.revokedAt) return { ok: false, reason: "revoked" }
        if (r.expiresAt.getTime() <= now().getTime()) return { ok: false, reason: "expired" }
        return null
      }
      const row = await find()
      if (!row) return { ok: false, reason: "not_found" }
      const early = await classify(row)
      if (early) return early
      if (row.email) {
        let e: string | null = null
        try {
          e = who.email ? normalizeEmail(who.email) : null
        } catch {}
        if (e !== row.email) return { ok: false, reason: "email_mismatch" }
      }
      const [won] = await o
        .update(T.invitations)
        .set({ acceptedAt: now(), acceptedBy: who.userId })
        .where(
          and(eq(I.id, row.id), isNull(I.acceptedAt), isNull(I.revokedAt), gt(I.expiresAt, now())),
        )
        .returning()
      if (!won) return (await classify((await find()) as Cols)) ?? { ok: false, reason: "used" }
      const existing = await membership(won.orgId, who.userId)
      if (!existing)
        await o
          .insert(T.memberships)
          .values({ orgId: won.orgId, userId: who.userId, role: won.role, createdAt: now() })
      await log(
        "invite.accept",
        T.invitations,
        won.id,
        won.orgId,
        who.userId,
        toInvite(row),
        toInvite(won),
      )
      return done(won, !!existing)
    },
    /** Revoke a pending invite of this org. `by` needs `members:invite`. Returns whether one was revoked. */
    async revokeInvite(orgId: string, id: string, opts: By = {}): Promise<boolean> {
      if (opts.by !== undefined) {
        const me = await membership(orgId, opts.by)
        if (!me || !hasPermission(me.permissions, ORG_PERMISSIONS.invite))
          throw forbidden("You cannot manage invites in this organisation.")
      }
      const rows = await o
        .update(T.invitations)
        .set({ revokedAt: now() })
        .where(and(eq(I.id, id), eq(I.orgId, orgId), isNull(I.acceptedAt), isNull(I.revokedAt)))
        .returning()
      if (rows[0]) {
        const after = toInvite(rows[0])
        const before = { ...after, revokedAt: null, status: "pending" }
        await log("invite.revoke", T.invitations, id, orgId, opts.by, before, after)
      }
      return rows.length > 0
    },
    /** This org's invites, newest first. `pending: true` leaves out used, revoked and expired ones. */
    async invitations(orgId: string, opts: { pending?: boolean } = {}): Promise<Invitation[]> {
      const rows: Cols[] = await o
        .select()
        .from(T.invitations)
        .where(
          opts.pending
            ? and(
                eq(I.orgId, orgId),
                isNull(I.acceptedAt),
                isNull(I.revokedAt),
                gt(I.expiresAt, now()),
              )
            : eq(I.orgId, orgId),
        )
        .orderBy(desc(I.createdAt), desc(I.id))
        .limit(500)
      return rows.map(toInvite)
    },
  }
}

export type Orgs = ReturnType<typeof createOrgs>
/**
 * Organisations for multi-tenant apps: orgs with a slug, a custom domain and a
 * theme; memberships with a role; roles that map to permission sets, with
 * custom roles per org; and invitations with expiring tokens.
 *
 * ```ts
 * const orgs = createOrgs(db, { tables: { organizations, memberships, invitations, orgRoles } })
 * const org = await orgs.create({ name: "Acme", ownerId: userId })
 * const { token } = await orgs.invite({ orgId: org.id, email, role: "member", invitedBy: userId })
 * await orgs.acceptInvite(token, { userId: other, email })   // { ok: true, membership } | { ok: false, reason }
 * await orgs.can(org.id, other, "members:invite")           // false
 * const data = scoped(db, { orgId: org.id })                // this org's rows only
 * ```
 *
 * Safe by default:
 * - Roles are permission sets. `owner` holds `*`. Nobody can grant a role
 *   with a permission they do not hold themselves (`by`), and an org always
 *   keeps at least one owner.
 * - Invite tokens are 256 random bits, returned once; only their SHA-256 is
 *   stored. They expire (default 7 days), work once and can be revoked.
 * - Lookups by id are bound to the org: a member, invite or role of another
 *   org reads as not found.
 */

import { and, asc, count, desc, eq, gt, inArray, isNull, type Table } from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError, type SignetDbErrorCode } from "./errors.js"
import { normalizeEmail } from "./growth.js"
import { newId } from "./id.js"

/** Permission strings. `*` is every permission; `members:*` every `members:` one. */
export type Permission = string
export type RoleMap = Readonly<Record<string, readonly Permission[]>>

/** The permissions signet's own routes and screens check. Apps add their own strings. */
export const ORG_PERMISSIONS = {
  /** Rename the org, set its domain and theme. */
  update: "org:update",
  readMembers: "members:read",
  invite: "members:invite",
  /** Change roles and remove members. */
  manageMembers: "members:manage",
  /** Create and edit custom roles. */
  manageRoles: "roles:manage",
  /** Use the org-scoped admin API. */
  admin: "admin:access",
} as const

/** owner: everything. admin: everything but roles. member: sees the member list. */
export const DEFAULT_ORG_ROLES = {
  owner: ["*"],
  admin: ["org:update", "members:read", "members:invite", "members:manage", "admin:access"],
  member: ["members:read"],
} as const satisfies RoleMap

/** Declare the app's roles. Throws for an empty name or a role without `owner`. */
export function defineRoles<const R extends RoleMap>(roles: R): R {
  for (const [name, perms] of Object.entries(roles)) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name))
      throw new SignetDbError(
        "BAD_CONFIG",
        `Role "${name}": use lower-case letters, digits, - and _.`,
      )
    if (!Array.isArray(perms))
      throw new SignetDbError("BAD_CONFIG", `Role "${name}": expected a list.`)
  }
  return roles
}

/** Whether a permission set grants `permission`. */
export function hasPermission(perms: readonly Permission[], permission: Permission): boolean {
  if (perms.includes("*") || perms.includes(permission)) return true
  const i = permission.indexOf(":")
  return i > 0 && perms.includes(`${permission.slice(0, i)}:*`)
}

/** Whether someone holding `mine` may hand out `theirs`: every permission in it must be one they hold. */
export function canGrant(mine: readonly Permission[], theirs: readonly Permission[]): boolean {
  return mine.includes("*") || theirs.every((p) => p !== "*" && hasPermission(mine, p))
}

export type OrgTables = {
  organizations: Table
  memberships: Table
  invitations: Table
  /** Optional: per-org custom roles. Without it only code roles exist. */
  orgRoles?: Table
}

export type OrgsOptions = {
  tables: OrgTables
  /** Code-defined roles. Default `DEFAULT_ORG_ROLES`. Must include `ownerRole`. */
  roles?: RoleMap
  /** The role an org's creator gets and that an org must always have one of. Default "owner". */
  ownerRole?: string
  /** How long an invite stays valid. Default 7 days. */
  inviteTtlMs?: number
  /** Clock, for tests. */
  now?: () => Date
}

export type Org = {
  id: string
  name: string
  slug: string
  domain: string | null
  theme: string | null
  brandColor: string | null
  personal: boolean
  createdAt: Date
  updatedAt: Date
}

export type OrgSettings = {
  name?: string
  slug?: string
  domain?: string | null
  theme?: string | null
  brandColor?: string | null
}

export type Membership = { orgId: string; userId: string; role: string; createdAt: Date }
export type MembershipWithPermissions = Membership & { permissions: Permission[] }

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired"
export type Invitation = {
  id: string
  orgId: string
  email: string | null
  role: string
  invitedBy: string
  createdAt: Date
  expiresAt: Date
  acceptedAt: Date | null
  acceptedBy: string | null
  revokedAt: Date | null
  status: InvitationStatus
}

export type AcceptInviteResult =
  | { ok: true; membership: Membership; org: Org; already: boolean }
  | { ok: false; reason: "not_found" | "expired" | "used" | "revoked" | "email_mismatch" }

/** Who is acting, for checks that a change does not exceed their own permissions. Omit for system jobs. */
export type By = { by?: string }

/**
 * A deliberate failure with an HTTP status, like admin's `AdminError`, so
 * signet-server's routes turn it into the error envelope.
 */
export class OrgError extends SignetDbError {
  readonly status: 400 | 403 | 404 | 409
  constructor(status: OrgError["status"], code: SignetDbErrorCode, message: string) {
    super(code, message)
    this.status = status
  }
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: org columns are known by name
type Cols = Record<string, any>

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const COLOR = /^#[0-9a-f]{6}$/
const THEME = /^[a-z][a-z0-9-]{0,39}$/

const bad = (m: string) => new OrgError(400, "BAD_INPUT", m)
const notFound = (m: string) => new OrgError(404, "NOT_FOUND", m)
const forbidden = (m: string) => new OrgError(403, "FORBIDDEN", m)

/** "Acme Labs!" → "acme-labs". */
export function slugify(name: string): string {
  return (
    String(name)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "org"
  )
}

/** A host as stored and matched: lower-case, no port, no trailing dot. */
export function normalizeDomain(host: string): string {
  return String(host).trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("")
}

export function createOrgs(db: SignetDb<unknown>, options: OrgsOptions) {
  const o = db.orm as AnyOrm
  const T = options.tables
  const O = T.organizations as unknown as Cols
  const M = T.memberships as unknown as Cols
  const I = T.invitations as unknown as Cols
  const R = T.orgRoles as unknown as Cols | undefined
  const codeRoles: RoleMap = options.roles ?? DEFAULT_ORG_ROLES
  const owner = options.ownerRole ?? "owner"
  const now = options.now ?? (() => new Date())
  const ttl = options.inviteTtlMs ?? 7 * 86_400_000
  if (!Object.hasOwn(codeRoles, owner))
    throw new SignetDbError(
      "BAD_CONFIG",
      `createOrgs: roles must include the owner role "${owner}".`,
    )

  const toOrg = (r: Cols): Org => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    domain: r.domain ?? null,
    theme: r.theme ?? null,
    brandColor: r.brandColor ?? null,
    personal: !!r.personal,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })
  const toMember = (r: Cols): Membership => ({
    orgId: r.orgId,
    userId: r.userId,
    role: r.role,
    createdAt: r.createdAt,
  })
  const toInvite = (r: Cols): Invitation => ({
    id: r.id,
    orgId: r.orgId,
    email: r.email ?? null,
    role: r.role,
    invitedBy: r.invitedBy,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    acceptedAt: r.acceptedAt ?? null,
    acceptedBy: r.acceptedBy ?? null,
    revokedAt: r.revokedAt ?? null,
    status: r.acceptedAt
      ? "accepted"
      : r.revokedAt
        ? "revoked"
        : r.expiresAt.getTime() <= now().getTime()
          ? "expired"
          : "pending",
  })
  const need = (v: unknown, name: string) => {
    if (typeof v !== "string" || !v) throw bad(`${name} is required.`)
  }

  const first = async (table: Table, where: unknown): Promise<Cols | undefined> =>
    (await o.select().from(table).where(where).limit(1))[0]

  const get = async (id: string): Promise<Org | null> => {
    if (typeof id !== "string" || !id) return null
    const r = await first(T.organizations, eq(O.id, id))
    return r ? toOrg(r) : null
  }
  const mustGet = async (id: string) => {
    const org = await get(id)
    if (!org) throw notFound("No such organisation.")
    return org
  }

  // ---------------------------------------------------------------- roles

  /** Custom roles of one org, by name. */
  const customRoles = async (orgId: string): Promise<Record<string, Permission[]>> => {
    if (!R) return {}
    const rows: Cols[] = await o.select().from(T.orgRoles).where(eq(R.orgId, orgId))
    return Object.fromEntries(rows.map((r) => [r.name, (r.permissions ?? []) as Permission[]]))
  }
  /** A role's permissions in an org: code roles first, then the org's custom roles. Unknown roles get none. */
  const permissionsOf = async (orgId: string, role: string): Promise<Permission[] | null> => {
    if (Object.hasOwn(codeRoles, role)) return [...(codeRoles[role] ?? [])]
    return (await customRoles(orgId))[role] ?? null
  }
  const roleExists = async (orgId: string, role: string) => {
    if (typeof role !== "string" || !role) throw bad("role is required.")
    const perms = await permissionsOf(orgId, role)
    if (!perms) throw bad(`No role "${role}" in this organisation.`)
    return perms
  }

  const membership = async (
    orgId: string,
    userId: string,
  ): Promise<MembershipWithPermissions | null> => {
    if (!orgId || !userId) return null
    const r = await first(T.memberships, and(eq(M.orgId, orgId), eq(M.userId, userId)))
    if (!r) return null
    return { ...toMember(r), permissions: (await permissionsOf(orgId, r.role)) ?? [] }
  }

  /** Throws unless `by` (when given) is a member who may grant `role`'s permissions. */
  const mayGrant = async (
    orgId: string,
    by: string | undefined,
    perms: Permission[],
    need: Permission,
  ) => {
    if (by === undefined) return
    const me = await membership(orgId, by)
    if (!me || !hasPermission(me.permissions, need))
      throw forbidden("You do not have permission to do that in this organisation.")
    if (!canGrant(me.permissions, perms))
      throw forbidden("You cannot hand out a role with permissions you do not have.")
  }

  const owners = async (orgId: string) =>
    Number(
      (
        await o
          .select({ n: count() })
          .from(T.memberships)
          .where(and(eq(M.orgId, orgId), eq(M.role, owner)))
      )[0]?.n ?? 0,
    )

  // ------------------------------------------------------------- settings

  const cleanSettings = (s: OrgSettings): Cols => {
    const out: Cols = {}
    if (s.name !== undefined) {
      const name = String(s.name).trim()
      if (!name || name.length > 100) throw bad("name must be 1 to 100 characters.")
      out.name = name
    }
    if (s.slug !== undefined) {
      if (!SLUG.test(s.slug)) throw bad("slug: lower-case letters, digits and dashes, up to 48.")
      out.slug = s.slug
    }
    if (s.domain !== undefined) {
      const d = s.domain === null || s.domain === "" ? null : normalizeDomain(s.domain)
      if (d !== null && !DOMAIN.test(d)) throw bad(`"${s.domain}" is not a domain name.`)
      out.domain = d
    }
    if (s.theme !== undefined) {
      if (s.theme !== null && s.theme !== "" && !THEME.test(s.theme))
        throw bad("theme must be a theme name.")
      out.theme = s.theme || null
    }
    if (s.brandColor !== undefined) {
      const c = s.brandColor ? s.brandColor.trim().toLowerCase() : null
      if (c !== null && !COLOR.test(c)) throw bad("brandColor must be a colour like #12833c.")
      out.brandColor = c
    }
    return out
  }
  const assertFree = async (values: Cols, self?: string) => {
    for (const k of ["slug", "domain"] as const) {
      if (values[k] == null) continue
      const r = await first(T.organizations, eq(O[k], values[k]))
      if (r && r.id !== self) throw new OrgError(409, "CONFLICT", `That ${k} is taken.`)
    }
  }

  return {
    /** The role names and permissions code defines (custom roles: `roles(orgId)`). */
    codeRoles,
    ownerRole: owner,
    permissionsOf,

    // ----------------------------------------------------------- orgs

    /** A new org; `ownerId` becomes its owner. The slug comes from the name when not given, made unique. */
    async create(
      input: OrgSettings & { name: string; ownerId: string; personal?: boolean },
    ): Promise<Org> {
      need(input.ownerId, "ownerId")
      const values = cleanSettings({ ...input, slug: input.slug ?? slugify(input.name) })
      if (input.slug === undefined) {
        const base = values.slug as string
        while (await first(T.organizations, eq(O.slug, values.slug)))
          values.slug = `${base.slice(0, 40)}-${newId().slice(-5).toLowerCase()}`
      }
      await assertFree(values)
      const at = now()
      const row = {
        ...values,
        id: newId(),
        personal: !!input.personal,
        createdAt: at,
        updatedAt: at,
      }
      // One atomic group, so an org never exists without its owner.
      await db.batch([
        (tx) => (tx as AnyOrm).insert(T.organizations).values(row),
        (tx) =>
          (tx as AnyOrm)
            .insert(T.memberships)
            .values({ orgId: row.id, userId: input.ownerId, role: owner, createdAt: at }),
      ])
      return toOrg(row)
    },
    get,
    async bySlug(slug: string): Promise<Org | null> {
      if (typeof slug !== "string" || !SLUG.test(slug)) return null
      const r = await first(T.organizations, eq(O.slug, slug))
      return r ? toOrg(r) : null
    },
    /** The org whose custom domain is `host` (any case, port ignored). */
    async byDomain(host: string): Promise<Org | null> {
      if (typeof host !== "string" || !host) return null
      const r = await first(T.organizations, eq(O.domain, normalizeDomain(host)))
      return r ? toOrg(r) : null
    },
    /** Rename the org, change its slug, domain, theme or brand colour. `by` needs `org:update`. */
    async update(orgId: string, settings: OrgSettings, opts: By = {}): Promise<Org> {
      await mustGet(orgId)
      if (opts.by !== undefined) {
        const me = await membership(orgId, opts.by)
        if (!me || !hasPermission(me.permissions, ORG_PERMISSIONS.update))
          throw forbidden("You cannot change this organisation's settings.")
      }
      const values = cleanSettings(settings)
      if (Object.keys(values).length === 0) throw bad("Nothing to change.")
      await assertFree(values, orgId)
      const [row] = await o.update(T.organizations).set(values).where(eq(O.id, orgId)).returning()
      return toOrg(row)
    },
    /** Every org the user belongs to, with their role, oldest membership first. */
    async listForUser(userId: string): Promise<{ org: Org; role: string }[]> {
      need(userId, "userId")
      const ms: Cols[] = await o
        .select()
        .from(T.memberships)
        .where(eq(M.userId, userId))
        .orderBy(asc(M.createdAt))
      if (ms.length === 0) return []
      const orgs: Cols[] = await o
        .select()
        .from(T.organizations)
        .where(
          inArray(
            O.id,
            ms.map((m) => m.orgId),
          ),
        )
      const byId = new Map(orgs.map((r) => [r.id, toOrg(r)]))
      return ms.flatMap((m) => {
        const org = byId.get(m.orgId)
        return org ? [{ org, role: m.role as string }] : []
      })
    },

    // ------------------------------------------------------- members

    membership,
    /** Whether the user is a member whose role grants `permission`. */
    async can(orgId: string, userId: string, permission: Permission): Promise<boolean> {
      const m = await membership(orgId, userId)
      return !!m && hasPermission(m.permissions, permission)
    },
    /** Members, oldest first. */
    async members(orgId: string): Promise<Membership[]> {
      const rows: Cols[] = await o
        .select()
        .from(T.memberships)
        .where(eq(M.orgId, orgId))
        .orderBy(asc(M.createdAt), asc(M.userId))
      return rows.map(toMember)
    },
    /** Add someone directly (no invite). `by` needs `members:manage` and every permission of `role`. */
    async addMember(
      orgId: string,
      userId: string,
      role: string,
      opts: By = {},
    ): Promise<Membership> {
      need(userId, "userId")
      await mustGet(orgId)
      await mayGrant(orgId, opts.by, await roleExists(orgId, role), ORG_PERMISSIONS.manageMembers)
      if (await membership(orgId, userId)) throw new OrgError(409, "CONFLICT", "Already a member.")
      const [row] = await o
        .insert(T.memberships)
        .values({ orgId, userId, role, createdAt: now() })
        .returning()
      return toMember(row)
    },
    /** Change a member's role. `by` needs `members:manage` and may not grant or remove more than they hold. */
    async setRole(orgId: string, userId: string, role: string, opts: By = {}): Promise<Membership> {
      const target = await membership(orgId, userId)
      if (!target) throw notFound("No such member.")
      const perms = await roleExists(orgId, role)
      await mayGrant(orgId, opts.by, perms, ORG_PERMISSIONS.manageMembers)
      await mayGrant(orgId, opts.by, target.permissions, ORG_PERMISSIONS.manageMembers)
      if (target.role === owner && role !== owner && (await owners(orgId)) <= 1)
        throw new OrgError(409, "CONFLICT", "An organisation needs at least one owner.")
      const [row] = await o
        .update(T.memberships)
        .set({ role })
        .where(and(eq(M.orgId, orgId), eq(M.userId, userId)))
        .returning()
      return toMember(row)
    },
    /** Remove a member, or leave (`by` is the member). Others need `members:manage` and to outrank them. */
    async removeMember(orgId: string, userId: string, opts: By = {}): Promise<void> {
      const target = await membership(orgId, userId)
      if (!target) throw notFound("No such member.")
      if (opts.by !== userId)
        await mayGrant(orgId, opts.by, target.permissions, ORG_PERMISSIONS.manageMembers)
      if (target.role === owner && (await owners(orgId)) <= 1)
        throw new OrgError(409, "CONFLICT", "An organisation needs at least one owner.")
      await o.delete(T.memberships).where(and(eq(M.orgId, orgId), eq(M.userId, userId)))
    },

    // --------------------------------------------------- custom roles

    /** Code roles and the org's custom roles, name → permissions. */
    async roles(orgId: string): Promise<Record<string, Permission[]>> {
      return {
        ...(await customRoles(orgId)),
        ...Object.fromEntries(Object.entries(codeRoles).map(([k, v]) => [k, [...v]])),
      }
    },
    /** Create or replace a custom role. `by` needs `roles:manage` and every permission it grants. */
    async saveRole(
      orgId: string,
      name: string,
      permissions: Permission[],
      opts: By = {},
    ): Promise<void> {
      if (!R) throw new SignetDbError("BAD_CONFIG", "saveRole needs tables.orgRoles.")
      await mustGet(orgId)
      defineRoles({ [name]: permissions })
      if (Object.hasOwn(codeRoles, name)) throw bad(`"${name}" is a built-in role.`)
      if (!permissions.every((p) => typeof p === "string" && p.length > 0 && p.length <= 80))
        throw bad("permissions must be non-empty strings.")
      await mayGrant(orgId, opts.by, permissions, ORG_PERMISSIONS.manageRoles)
      const where = and(eq(R.orgId, orgId), eq(R.name, name))
      if (await first(T.orgRoles as Table, where))
        await o.update(T.orgRoles).set({ permissions }).where(where)
      else await o.insert(T.orgRoles).values({ orgId, name, permissions })
    },
    /** Delete a custom role nobody holds. */
    async deleteRole(orgId: string, name: string, opts: By = {}): Promise<boolean> {
      if (!R) return false
      const perms = (await customRoles(orgId))[name]
      if (!perms) return false
      await mayGrant(orgId, opts.by, perms, ORG_PERMISSIONS.manageRoles)
      const held = await first(T.memberships, and(eq(M.orgId, orgId), eq(M.role, name)))
      if (held) throw new OrgError(409, "CONFLICT", "Move members off this role first.")
      await o.delete(T.orgRoles).where(and(eq(R.orgId, orgId), eq(R.name, name)))
      return true
    },

    // -------------------------------------------------------- invites

    /** A new invite and its token. Send the token in a link; it is not stored and cannot be shown again. */
    async invite(input: {
      orgId: string
      role: string
      invitedBy: string
      email?: string
      ttlMs?: number
    }): Promise<{ invitation: Invitation; token: string }> {
      need(input.invitedBy, "invitedBy")
      await mustGet(input.orgId)
      const perms = await roleExists(input.orgId, input.role)
      await mayGrant(input.orgId, input.invitedBy, perms, ORG_PERMISSIONS.invite)
      const life = input.ttlMs ?? ttl
      if (!(life > 0)) throw bad("ttlMs must be positive.")
      const token = base64url(crypto.getRandomValues(new Uint8Array(32)))
      const at = now()
      const [row] = await o
        .insert(T.invitations)
        .values({
          orgId: input.orgId,
          tokenHash: await sha256Hex(token),
          email: input.email ? normalizeEmail(input.email) : null,
          role: input.role,
          invitedBy: input.invitedBy,
          createdAt: at,
          expiresAt: new Date(at.getTime() + life),
        })
        .returning()
      return { invitation: toInvite(row), token }
    },
    /** The invite a token is for, with its org, to show before accepting. Null if unknown. */
    async previewInvite(token: string): Promise<{ invitation: Invitation; org: Org } | null> {
      if (typeof token !== "string" || !token) return null
      const r = await first(T.invitations, eq(I.tokenHash, await sha256Hex(token)))
      const org = r ? await get(r.orgId) : null
      return r && org ? { invitation: toInvite(r), org } : null
    },
    /**
     * Accept an invite once and join its org with its role. The same user
     * accepting again gets `already: true`. When the invite names an email,
     * `email` must match it (pass the account's verified address).
     */
    async acceptInvite(
      token: string,
      who: { userId: string; email?: string },
    ): Promise<AcceptInviteResult> {
      need(who.userId, "userId")
      if (typeof token !== "string" || !token) return { ok: false, reason: "not_found" }
      const hash = await sha256Hex(token)
      const find = () => first(T.invitations, eq(I.tokenHash, hash))
      const done = async (r: Cols, already: boolean): Promise<AcceptInviteResult> => {
        const m = await membership(r.orgId, who.userId)
        const org = await get(r.orgId)
        if (!m || !org) return { ok: false, reason: "not_found" }
        const { permissions: _p, ...membership_ } = m
        return { ok: true, membership: membership_, org, already }
      }
      const classify = async (r: Cols): Promise<AcceptInviteResult | null> => {
        if (r.acceptedAt)
          return r.acceptedBy === who.userId ? done(r, true) : { ok: false, reason: "used" }
        if (r.revokedAt) return { ok: false, reason: "revoked" }
        if (r.expiresAt.getTime() <= now().getTime()) return { ok: false, reason: "expired" }
        return null
      }
      const row = await find()
      if (!row) return { ok: false, reason: "not_found" }
      const early = await classify(row)
      if (early) return early
      if (row.email) {
        let e: string | null = null
        try {
          e = who.email ? normalizeEmail(who.email) : null
        } catch {}
        if (e !== row.email) return { ok: false, reason: "email_mismatch" }
      }
      const [won] = await o
        .update(T.invitations)
        .set({ acceptedAt: now(), acceptedBy: who.userId })
        .where(
          and(eq(I.id, row.id), isNull(I.acceptedAt), isNull(I.revokedAt), gt(I.expiresAt, now())),
        )
        .returning()
      if (!won) return (await classify((await find()) as Cols)) ?? { ok: false, reason: "used" }
      const existing = await membership(won.orgId, who.userId)
      if (!existing)
        await o
          .insert(T.memberships)
          .values({ orgId: won.orgId, userId: who.userId, role: won.role, createdAt: now() })
      return done(won, !!existing)
    },
    /** Revoke a pending invite of this org. `by` needs `members:invite`. Returns whether one was revoked. */
    async revokeInvite(orgId: string, id: string, opts: By = {}): Promise<boolean> {
      if (opts.by !== undefined) {
        const me = await membership(orgId, opts.by)
        if (!me || !hasPermission(me.permissions, ORG_PERMISSIONS.invite))
          throw forbidden("You cannot manage invites in this organisation.")
      }
      const rows = await o
        .update(T.invitations)
        .set({ revokedAt: now() })
        .where(and(eq(I.id, id), eq(I.orgId, orgId), isNull(I.acceptedAt), isNull(I.revokedAt)))
        .returning()
      return rows.length > 0
    },
    /** This org's invites, newest first. `pending: true` leaves out used, revoked and expired ones. */
    async invitations(orgId: string, opts: { pending?: boolean } = {}): Promise<Invitation[]> {
      const rows: Cols[] = await o
        .select()
        .from(T.invitations)
        .where(
          opts.pending
            ? and(
                eq(I.orgId, orgId),
                isNull(I.acceptedAt),
                isNull(I.revokedAt),
                gt(I.expiresAt, now()),
              )
            : eq(I.orgId, orgId),
        )
        .orderBy(desc(I.createdAt), desc(I.id))
        .limit(500)
      return rows.map(toInvite)
    },
  }
}

export type Orgs = ReturnType<typeof createOrgs>
