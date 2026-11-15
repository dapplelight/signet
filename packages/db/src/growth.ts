/**
 * Growth basics every app rebuilds, on the tables from `growthTables()`:
 * waitlist, invites, referrals, onboarding progress, changelog "what's new"
 * and feedback.
 *
 * ```ts
 * const growth = createGrowth(db, { tables: growthTables() })
 * await growth.joinWaitlist("a@example.com", { referralCode })  // { email, position, joined }
 * const { token } = await growth.createInvite({ invitedBy: userId, scope: orgId, role: "member" })
 * await growth.acceptInvite(token, { userId, email })            // { ok: true, invite } | { ok: false, reason }
 * await growth.refer(code, newUserId)                            // later: convertReferral(newUserId)
 * await growth.onboarding(userId, ["profile", "first-project"])  // { done, next, complete, percent }
 * await growth.sendFeedback({ subject: userId, kind: "bug", message })
 * ```
 *
 * Invite tokens are 256 random bits, returned once; only their SHA-256 is
 * stored. These writes are not audited: they are the user's own actions.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  like,
  lt,
  or,
  type Table,
} from "drizzle-orm"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"

export { type GrowthToolsOptions, growthTools } from "./growth-tools.js"

export type GrowthTables = {
  waitlist: Table
  invites: Table
  referralCodes: Table
  referrals: Table
  marks: Table
  feedback: Table
}

export const DEFAULT_FEEDBACK_KINDS = ["bug", "idea", "praise", "other"] as const

export type GrowthOptions = {
  tables: GrowthTables
  /** How long an invite stays valid. Default 7 days. */
  inviteTtlMs?: number
  /** Allowed feedback kinds. Default `DEFAULT_FEEDBACK_KINDS`. */
  feedbackKinds?: readonly string[]
  /** Clock, for tests. */
  now?: () => Date
}

export type WaitlistEntry = {
  email: string
  source: string | null
  referralCode: string | null
  createdAt: Date
  invitedAt: Date | null
}

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired"

export type Invite = {
  id: string
  email: string | null
  invitedBy: string
  scope: string | null
  role: string | null
  createdAt: Date
  expiresAt: Date
  acceptedAt: Date | null
  acceptedBy: string | null
  revokedAt: Date | null
  status: InviteStatus
}

export type AcceptResult =
  | { ok: true; invite: Invite; already: boolean }
  | { ok: false; reason: "not_found" | "expired" | "used" | "revoked" | "email_mismatch" }

export type Referral = {
  referee: string
  referrer: string
  code: string
  createdAt: Date
  convertedAt: Date | null
  rewardedAt: Date | null
}

export type ReferResult =
  | { ok: true; referral: Referral }
  | { ok: false; reason: "unknown_code" | "self" | "already_referred" }

export type Feedback = {
  id: string
  subject: string | null
  kind: string
  message: string
  rating: number | null
  page: string | null
  meta: unknown
  status: FeedbackStatus
  createdAt: Date
}
export type FeedbackStatus = "new" | "seen" | "done"
const FEEDBACK_STATUSES: readonly FeedbackStatus[] = ["new", "seen", "done"]

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: growth columns are known by name
type Cols = Record<string, any>

const bad = (msg: string) => new SignetDbError("BAD_INPUT", msg)

/** Lower-cased, trimmed; throws BAD_INPUT unless it looks like an address. */
export function normalizeEmail(email: string): string {
  const e = String(email ?? "")
    .trim()
    .toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254)
    throw bad(`"${email}" is not an email address.`)
  return e
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const randomCode = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => CROCKFORD[b & 31]).join("")

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("")
}

export function createGrowth(db: SignetDb<unknown>, options: GrowthOptions) {
  const o = db.orm as AnyOrm
  const T = options.tables
  const W = T.waitlist as unknown as Cols
  const I = T.invites as unknown as Cols
  const RC = T.referralCodes as unknown as Cols
  const R = T.referrals as unknown as Cols
  const M = T.marks as unknown as Cols
  const F = T.feedback as unknown as Cols
  const now = options.now ?? (() => new Date())
  const ttl = options.inviteTtlMs ?? 7 * 86_400_000
  const kinds = options.feedbackKinds ?? DEFAULT_FEEDBACK_KINDS

  const toInvite = (r: Cols): Invite => ({
    id: r.id,
    email: r.email ?? null,
    invitedBy: r.invitedBy,
    scope: r.scope ?? null,
    role: r.role ?? null,
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
  const toReferral = (r: Cols): Referral => ({
    referee: r.referee,
    referrer: r.referrer,
    code: r.code,
    createdAt: r.createdAt,
    convertedAt: r.convertedAt ?? null,
    rewardedAt: r.rewardedAt ?? null,
  })
  const toFeedback = (r: Cols): Feedback => ({
    id: r.id,
    subject: r.subject ?? null,
    kind: r.kind,
    message: r.message,
    rating: r.rating ?? null,
    page: r.page ?? null,
    meta: r.meta ?? null,
    status: r.status,
    createdAt: r.createdAt,
  })
  const page = (p: { limit?: number; offset?: number }) => ({
    limit: Math.min(Math.max(Math.trunc(p.limit ?? 50), 1), 500),
    offset: Math.max(Math.trunc(p.offset ?? 0), 0),
  })
  const need = (v: string, what: string) => {
    if (typeof v !== "string" || !v) throw bad(`${what} is required.`)
    return v
  }

  // ---------------------------------------------------------------- waitlist

  /** People still waiting ahead of `email`, plus one; 0 once invited; null if not on the list. */
  async function waitlistPosition(email: string): Promise<number | null> {
    const e = normalizeEmail(email)
    const [me] = await o.select().from(T.waitlist).where(eq(W.email, e))
    if (!me) return null
    if (me.invitedAt) return 0
    const [row] = await o
      .select({ n: count() })
      .from(T.waitlist)
      .where(
        and(
          isNull(W.invitedAt),
          or(lt(W.createdAt, me.createdAt), and(eq(W.createdAt, me.createdAt), lt(W.email, e))),
        ),
      )
    return Number(row?.n ?? 0) + 1
  }

  // ---------------------------------------------------------------- marks

  async function mark(subject: string, key: string): Promise<void> {
    need(subject, "subject")
    need(key, "key")
    const at = now()
    await o
      .insert(T.marks)
      .values({ subject, key, at })
      .onConflictDoUpdate({ target: [M.subject, M.key], set: { at } })
  }
  async function marksOf(subject: string, prefix = ""): Promise<Record<string, Date>> {
    const where = prefix
      ? and(eq(M.subject, subject), like(M.key, `${prefix.replace(/[%_]/g, "")}%`))
      : eq(M.subject, subject)
    const rows: Cols[] = await o.select().from(T.marks).where(where)
    return Object.fromEntries(rows.map((r) => [r.key, r.at]))
  }

  return {
    tables: T,
    feedbackKinds: kinds,

    /** Add an email (idempotent). `joined` is false when it was already there. */
    async joinWaitlist(
      email: string,
      opts: { source?: string; referralCode?: string } = {},
    ): Promise<{ email: string; position: number; joined: boolean }> {
      const e = normalizeEmail(email)
      const inserted = await o
        .insert(T.waitlist)
        .values({
          email: e,
          source: opts.source ?? null,
          referralCode: opts.referralCode?.trim().toUpperCase() || null,
          createdAt: now(),
        })
        .onConflictDoNothing()
        .returning()
      return {
        email: e,
        position: (await waitlistPosition(e)) as number,
        joined: inserted.length > 0,
      }
    },
    waitlistPosition,
    /** Oldest first. `pending: true` leaves out people already invited. */
    async listWaitlist(
      opts: { pending?: boolean; limit?: number; offset?: number } = {},
    ): Promise<WaitlistEntry[]> {
      const { limit, offset } = page(opts)
      const q = o.select().from(T.waitlist)
      const rows: Cols[] = await (opts.pending ? q.where(isNull(W.invitedAt)) : q)
        .orderBy(asc(W.createdAt), asc(W.email))
        .limit(limit)
        .offset(offset)
      return rows.map((r) => ({
        email: r.email,
        source: r.source ?? null,
        referralCode: r.referralCode ?? null,
        createdAt: r.createdAt,
        invitedAt: r.invitedAt ?? null,
      }))
    },
    async waitlistStats(): Promise<{ total: number; pending: number; invited: number }> {
      const [all] = await o.select({ n: count() }).from(T.waitlist)
      const [inv] = await o.select({ n: count() }).from(T.waitlist).where(isNotNull(W.invitedAt))
      const total = Number(all?.n ?? 0)
      const invited = Number(inv?.n ?? 0)
      return { total, pending: total - invited, invited }
    },
    /** Mark people as let in (send them an invite yourself). Returns how many changed. */
    async markInvited(emails: readonly string[]): Promise<number> {
      let n = 0
      for (const email of emails) {
        const rows = await o
          .update(T.waitlist)
          .set({ invitedAt: now() })
          .where(and(eq(W.email, normalizeEmail(email)), isNull(W.invitedAt)))
          .returning()
        n += rows.length
      }
      return n
    },

    // -------------------------------------------------------------- invites

    /** A new invite and its token. Send the token in a link; it is not stored and cannot be shown again. */
    async createInvite(input: {
      invitedBy: string
      email?: string
      scope?: string
      role?: string
      ttlMs?: number
    }): Promise<{ invite: Invite; token: string }> {
      need(input.invitedBy, "invitedBy")
      const life = input.ttlMs ?? ttl
      if (!(life > 0)) throw bad("ttlMs must be positive.")
      const token = base64url(crypto.getRandomValues(new Uint8Array(32)))
      const at = now()
      const [row] = await o
        .insert(T.invites)
        .values({
          tokenHash: await sha256Hex(token),
          email: input.email ? normalizeEmail(input.email) : null,
          invitedBy: input.invitedBy,
          scope: input.scope ?? null,
          role: input.role ?? null,
          createdAt: at,
          expiresAt: new Date(at.getTime() + life),
        })
        .returning()
      return { invite: toInvite(row), token }
    },
    /**
     * Accept an invite once. The same user accepting again gets `already: true`.
     * When the invite names an email, `email` must match it.
     */
    async acceptInvite(
      token: string,
      who: { userId: string; email?: string },
    ): Promise<AcceptResult> {
      need(who.userId, "userId")
      if (typeof token !== "string" || !token) return { ok: false, reason: "not_found" }
      const hash = await sha256Hex(token)
      const find = async () => (await o.select().from(T.invites).where(eq(I.tokenHash, hash)))[0]
      const classify = (r: Cols): AcceptResult | null => {
        if (r.acceptedAt)
          return r.acceptedBy === who.userId
            ? { ok: true, invite: toInvite(r), already: true }
            : { ok: false, reason: "used" }
        if (r.revokedAt) return { ok: false, reason: "revoked" }
        if (r.expiresAt.getTime() <= now().getTime()) return { ok: false, reason: "expired" }
        return null
      }
      const row = await find()
      if (!row) return { ok: false, reason: "not_found" }
      const early = classify(row)
      if (early) return early
      if (row.email) {
        let e: string | null = null
        try {
          e = who.email ? normalizeEmail(who.email) : null
        } catch {}
        if (e !== row.email) return { ok: false, reason: "email_mismatch" }
      }
      const [won] = await o
        .update(T.invites)
        .set({ acceptedAt: now(), acceptedBy: who.userId })
        .where(
          and(eq(I.id, row.id), isNull(I.acceptedAt), isNull(I.revokedAt), gt(I.expiresAt, now())),
        )
        .returning()
      if (won) return { ok: true, invite: toInvite(won), already: false }
      return classify(await find()) ?? { ok: false, reason: "used" } // lost a race
    },
    /** Revoke a pending invite. Returns whether one was revoked. */
    async revokeInvite(id: string): Promise<boolean> {
      const rows = await o
        .update(T.invites)
        .set({ revokedAt: now() })
        .where(and(eq(I.id, id), isNull(I.acceptedAt), isNull(I.revokedAt)))
        .returning()
      return rows.length > 0
    },
    /** Newest first, filtered by who sent them or what they are to. */
    async listInvites(
      opts: { invitedBy?: string; scope?: string; limit?: number; offset?: number } = {},
    ): Promise<Invite[]> {
      const { limit, offset } = page(opts)
      const conds = [
        opts.invitedBy !== undefined ? eq(I.invitedBy, opts.invitedBy) : undefined,
        opts.scope !== undefined ? eq(I.scope, opts.scope) : undefined,
      ].filter(Boolean)
      const rows: Cols[] = await o
        .select()
        .from(T.invites)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(I.createdAt), desc(I.id))
        .limit(limit)
        .offset(offset)
      return rows.map(toInvite)
    },

    // ------------------------------------------------------------ referrals

    /** The subject's referral code: 8 Crockford base32 characters, made on first call. */
    async referralCode(subject: string): Promise<string> {
      need(subject, "subject")
      const get = async () =>
        (await o.select().from(T.referralCodes).where(eq(RC.subject, subject)))[0]?.code as
          | string
          | undefined
      for (let i = 0; i < 3; i++) {
        const have = await get()
        if (have) return have
        try {
          await o
            .insert(T.referralCodes)
            .values({ subject, code: randomCode(8), createdAt: now() })
            .onConflictDoNothing({ target: RC.subject })
        } catch {} // the code collided with another subject's; try a new one
      }
      const have = await get()
      if (!have) throw new SignetDbError("BAD_VALUE", "Could not allocate a referral code.")
      return have
    },
    /** Record that `referee` signed up with `code`. One referrer per person; no self-referral. */
    async refer(code: string, referee: string): Promise<ReferResult> {
      need(referee, "referee")
      const c = String(code ?? "")
        .trim()
        .toUpperCase()
      const [owner] = c ? await o.select().from(T.referralCodes).where(eq(RC.code, c)) : []
      if (!owner) return { ok: false, reason: "unknown_code" }
      if (owner.subject === referee) return { ok: false, reason: "self" }
      const rows = await o
        .insert(T.referrals)
        .values({ referee, referrer: owner.subject, code: c, createdAt: now() })
        .onConflictDoNothing()
        .returning()
      if (!rows[0]) return { ok: false, reason: "already_referred" }
      return { ok: true, referral: toReferral(rows[0]) }
    },
    /**
     * Mark the referee as converted (paid, activated: your call). `first` is
     * true only the first time, so reward the referrer when it is.
     */
    async convertReferral(referee: string): Promise<{ referral: Referral; first: boolean } | null> {
      const [won] = await o
        .update(T.referrals)
        .set({ convertedAt: now() })
        .where(and(eq(R.referee, referee), isNull(R.convertedAt)))
        .returning()
      if (won) return { referral: toReferral(won), first: true }
      const [row] = await o.select().from(T.referrals).where(eq(R.referee, referee))
      return row ? { referral: toReferral(row), first: false } : null
    },
    /** Mark a converted referral's reward as given. Returns whether it changed (false if already rewarded). */
    async markRewarded(referee: string): Promise<boolean> {
      const rows = await o
        .update(T.referrals)
        .set({ rewardedAt: now() })
        .where(and(eq(R.referee, referee), isNotNull(R.convertedAt), isNull(R.rewardedAt)))
        .returning()
      return rows.length > 0
    },
    async referralStats(
      subject: string,
    ): Promise<{ code: string | null; referred: number; converted: number; rewarded: number }> {
      const [rc] = await o.select().from(T.referralCodes).where(eq(RC.subject, subject))
      const rows: Cols[] = await o.select().from(T.referrals).where(eq(R.referrer, subject))
      return {
        code: rc?.code ?? null,
        referred: rows.length,
        converted: rows.filter((r) => r.convertedAt).length,
        rewarded: rows.filter((r) => r.rewardedAt).length,
      }
    },
    async referralsBy(subject: string): Promise<Referral[]> {
      const rows: Cols[] = await o
        .select()
        .from(T.referrals)
        .where(eq(R.referrer, subject))
        .orderBy(desc(R.createdAt))
      return rows.map(toReferral)
    },

    // ------------------------------------------------- marks and onboarding

    /** Record that `subject` did `key` now (an upsert: the time moves forward). */
    mark,
    /** Every mark of `subject`, or those whose key starts with `prefix`. */
    marksOf,
    async unmark(subject: string, key: string): Promise<boolean> {
      const rows = await o
        .delete(T.marks)
        .where(and(eq(M.subject, subject), eq(M.key, key)))
        .returning()
      return rows.length > 0
    },
    completeStep: (subject: string, step: string) => mark(subject, `onboarding:${step}`),
    /** Progress through `steps`, in order: which are done, the first not done, percent. */
    async onboarding(
      subject: string,
      steps: readonly string[],
    ): Promise<{ done: string[]; next: string | null; complete: boolean; percent: number }> {
      const have = await marksOf(subject, "onboarding:")
      const done = steps.filter((s) => have[`onboarding:${s}`])
      const next = steps.find((s) => !have[`onboarding:${s}`]) ?? null
      return {
        done,
        next,
        complete: next === null,
        percent: steps.length ? Math.round((done.length / steps.length) * 100) : 100,
      }
    },

    // ------------------------------------------------------------ changelog

    /** Entries newer than the subject last looked (all of them on a first visit), in the order given. */
    async unseenChangelog<E extends { date: Date | string }>(
      subject: string,
      entries: readonly E[],
    ): Promise<{ entries: E[]; seenAt: Date | null }> {
      const seenAt = (await marksOf(subject, "changelog:seen"))["changelog:seen"] ?? null
      return {
        entries: entries.filter((e) => !seenAt || new Date(e.date).getTime() > seenAt.getTime()),
        seenAt,
      }
    },
    markChangelogSeen: (subject: string) => mark(subject, "changelog:seen"),

    // ------------------------------------------------------------- feedback

    async sendFeedback(input: {
      subject?: string | null
      kind: string
      message: string
      rating?: number
      page?: string
      meta?: unknown
    }): Promise<Feedback> {
      if (!kinds.includes(input.kind))
        throw bad(`Unknown feedback kind "${input.kind}". One of: ${kinds.join(", ")}.`)
      const message = String(input.message ?? "").trim()
      if (!message || message.length > 5000) throw bad("message is 1 to 5000 characters.")
      const r = input.rating
      if (r !== undefined && !(Number.isInteger(r) && r >= 1 && r <= 5))
        throw bad("rating is a whole number from 1 to 5.")
      const [row] = await o
        .insert(T.feedback)
        .values({
          subject: input.subject ?? null,
          kind: input.kind,
          message,
          rating: r ?? null,
          page: input.page ?? null,
          meta: input.meta ?? null,
          status: "new",
          createdAt: now(),
        })
        .returning()
      return toFeedback(row)
    },
    /** Newest first. */
    async listFeedback(
      opts: { status?: FeedbackStatus; kind?: string; limit?: number; offset?: number } = {},
    ): Promise<Feedback[]> {
      const { limit, offset } = page(opts)
      const conds = [
        opts.status ? eq(F.status, opts.status) : undefined,
        opts.kind ? eq(F.kind, opts.kind) : undefined,
      ].filter(Boolean)
      const rows: Cols[] = await o
        .select()
        .from(T.feedback)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(F.createdAt), desc(F.id))
        .limit(limit)
        .offset(offset)
      return rows.map(toFeedback)
    },
    async setFeedbackStatus(id: string, status: FeedbackStatus): Promise<boolean> {
      if (!FEEDBACK_STATUSES.includes(status))
        throw bad(`status is one of ${FEEDBACK_STATUSES.join(", ")}.`)
      const rows = await o.update(T.feedback).set({ status }).where(eq(F.id, id)).returning()
      return rows.length > 0
    },
  }
}

export type Growth = ReturnType<typeof createGrowth>
