import { afterEach, describe, expect, test } from "bun:test"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { createGrowth, growthTools, normalizeEmail } from "../src/growth"
import { backends, ddl, type Instance } from "./harness"

const DAY = 86_400_000

test("normalizeEmail", () => {
  expect(normalizeEmail("  A@Example.COM ")).toBe("a@example.com")
  expect(() => normalizeEmail("nope")).toThrow(/not an email/)
})

for (const backend of backends) {
  describe(`growth on ${backend.name}`, () => {
    let open: Instance | undefined
    afterEach(async () => {
      await open?.close()
      open = undefined
    })
    let clock = new Date("2026-11-01T00:00:00Z")
    const advance = (ms: number) => {
      clock = new Date(clock.getTime() + ms)
    }

    async function make() {
      clock = new Date("2026-11-01T00:00:00Z")
      open = await backend.make({})
      const i = open
      const tables =
        i.db.dialect === "pg"
          ? (pgc.growthTables() as unknown as ReturnType<typeof sqc.growthTables>)
          : sqc.growthTables()
      for (const t of Object.values(tables)) await i.exec(ddl(t))
      return createGrowth(i.db, { tables, now: () => clock })
    }

    test("waitlist: idempotent join, position, invited", async () => {
      const g = await make()
      expect(await g.joinWaitlist("a@x.io", { source: "hn" })).toEqual({
        email: "a@x.io",
        position: 1,
        joined: true,
      })
      advance(1)
      expect((await g.joinWaitlist("B@x.io", { referralCode: "abc" })).position).toBe(2)
      advance(1)
      await g.joinWaitlist("c@x.io")
      expect((await g.joinWaitlist(" A@X.io ")).joined).toBe(false)
      expect(await g.markInvited(["a@x.io", "a@x.io"])).toBe(1)
      expect(await g.waitlistPosition("a@x.io")).toBe(0)
      expect(await g.waitlistPosition("c@x.io")).toBe(2)
      expect(await g.waitlistPosition("z@x.io")).toBeNull()
      expect(await g.waitlistStats()).toEqual({ total: 3, pending: 2, invited: 1 })
      const pending = await g.listWaitlist({ pending: true })
      expect(pending.map((e) => e.email)).toEqual(["b@x.io", "c@x.io"])
      expect(pending[0]?.referralCode).toBe("ABC")
    })

    test("invites: token hashed, accept once, expiry, revoke, email lock", async () => {
      const g = await make()
      const { invite, token } = await g.createInvite({
        invitedBy: "u1",
        scope: "org1",
        role: "member",
      })
      expect(token.length).toBeGreaterThanOrEqual(43)
      expect(invite.status).toBe("pending")
      expect(JSON.stringify(invite)).not.toContain(token)

      expect(await g.acceptInvite("wrong", { userId: "u2" })).toEqual({
        ok: false,
        reason: "not_found",
      })
      const ok = await g.acceptInvite(token, { userId: "u2" })
      expect(ok.ok && ok.invite.acceptedBy).toBe("u2")
      expect(ok.ok && ok.already).toBe(false)
      const again = await g.acceptInvite(token, { userId: "u2" })
      expect(again.ok && again.already).toBe(true)
      expect(await g.acceptInvite(token, { userId: "u3" })).toEqual({ ok: false, reason: "used" })

      const locked = await g.createInvite({ invitedBy: "u1", email: "Bob@x.io" })
      expect(await g.acceptInvite(locked.token, { userId: "u4", email: "eve@x.io" })).toEqual({
        ok: false,
        reason: "email_mismatch",
      })
      expect(await g.acceptInvite(locked.token, { userId: "u4" })).toEqual({
        ok: false,
        reason: "email_mismatch",
      })
      expect((await g.acceptInvite(locked.token, { userId: "u4", email: "bob@X.io" })).ok).toBe(
        true,
      )

      const gone = await g.createInvite({ invitedBy: "u1" })
      expect(await g.revokeInvite(gone.invite.id)).toBe(true)
      expect(await g.revokeInvite(gone.invite.id)).toBe(false)
      expect(await g.acceptInvite(gone.token, { userId: "u5" })).toEqual({
        ok: false,
        reason: "revoked",
      })

      const old = await g.createInvite({ invitedBy: "u1", ttlMs: DAY })
      advance(DAY)
      expect(await g.acceptInvite(old.token, { userId: "u6" })).toEqual({
        ok: false,
        reason: "expired",
      })

      const list = await g.listInvites({ invitedBy: "u1" })
      expect(list.map((i) => i.status).sort()).toEqual([
        "accepted",
        "accepted",
        "expired",
        "revoked",
      ])
      expect((await g.listInvites({ scope: "org1" })).length).toBe(1)
    })

    test("referrals: stable code, no self or double referral, convert once", async () => {
      const g = await make()
      const code = await g.referralCode("alice")
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
      expect(await g.referralCode("alice")).toBe(code)
      expect(await g.refer("NOPE1234", "bob")).toEqual({ ok: false, reason: "unknown_code" })
      expect(await g.refer(code, "alice")).toEqual({ ok: false, reason: "self" })
      const r = await g.refer(code.toLowerCase(), "bob")
      expect(r.ok && r.referral.referrer).toBe("alice")
      expect(await g.refer(code, "bob")).toEqual({ ok: false, reason: "already_referred" })
      await g.refer(code, "carol")

      expect(await g.markRewarded("bob")).toBe(false) // not converted yet
      expect((await g.convertReferral("bob"))?.first).toBe(true)
      expect((await g.convertReferral("bob"))?.first).toBe(false)
      expect(await g.convertReferral("dave")).toBeNull()
      expect(await g.markRewarded("bob")).toBe(true)
      expect(await g.markRewarded("bob")).toBe(false)
      expect(await g.referralStats("alice")).toEqual({
        code,
        referred: 2,
        converted: 1,
        rewarded: 1,
      })
      expect((await g.referralsBy("alice")).length).toBe(2)
    })

    test("onboarding and changelog marks", async () => {
      const g = await make()
      const steps = ["profile", "invite", "first-project"]
      expect(await g.onboarding("u1", steps)).toEqual({
        done: [],
        next: "profile",
        complete: false,
        percent: 0,
      })
      await g.completeStep("u1", "invite")
      await g.completeStep("u1", "invite")
      expect(await g.onboarding("u1", steps)).toMatchObject({
        done: ["invite"],
        next: "profile",
        percent: 33,
      })
      await g.completeStep("u1", "profile")
      await g.completeStep("u1", "first-project")
      expect((await g.onboarding("u1", steps)).complete).toBe(true)
      expect((await g.onboarding("u2", steps)).done).toEqual([])

      const entries = [
        { id: "b", date: "2026-11-10" },
        { id: "a", date: "2026-10-01" },
      ]
      expect((await g.unseenChangelog("u1", entries)).entries.length).toBe(2)
      await g.markChangelogSeen("u1") // clock: 2026-11-01
      const { entries: unseen, seenAt } = await g.unseenChangelog("u1", entries)
      expect(unseen.map((e) => e.id)).toEqual(["b"])
      expect(seenAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z")
      expect(await g.unmark("u1", "changelog:seen")).toBe(true)
      expect(Object.keys(await g.marksOf("u1")).length).toBe(3)
    })

    test("feedback: validated, listed newest first, status", async () => {
      const g = await make()
      await expect(g.sendFeedback({ kind: "rant", message: "x" })).rejects.toThrow(
        /Unknown feedback kind/,
      )
      await expect(g.sendFeedback({ kind: "bug", message: "  " })).rejects.toThrow(/1 to 5000/)
      await expect(g.sendFeedback({ kind: "bug", message: "x", rating: 6 })).rejects.toThrow(
        /rating/,
      )
      const a = await g.sendFeedback({
        subject: "u1",
        kind: "bug",
        message: "broken",
        page: "/x",
        meta: { v: 1 },
      })
      advance(1)
      await g.sendFeedback({ kind: "idea", message: "dark mode", rating: 5 })
      expect(a).toMatchObject({ status: "new", meta: { v: 1 }, page: "/x" })
      expect((await g.listFeedback()).map((f) => f.kind)).toEqual(["idea", "bug"])
      expect(await g.setFeedbackStatus(a.id, "done")).toBe(true)
      expect((await g.listFeedback({ status: "done" })).map((f) => f.id)).toEqual([a.id])
      expect((await g.listFeedback({ kind: "idea" })).length).toBe(1)
    })

    test("tools: reads, and writes gated on approval", async () => {
      const g = await make()
      await g.joinWaitlist("a@x.io")
      const read = growthTools({ growth: g })
      expect(read.map((t) => t.name)).toEqual([
        "waitlist_stats",
        "list_waitlist",
        "list_feedback",
        "referral_stats",
        "list_invites",
      ])
      const stats = read.find((t) => t.name === "waitlist_stats")
      expect(await stats?.run({})).toEqual({ total: 1, pending: 1, invited: 0 })

      const noGate = growthTools({ growth: g, allowWrites: true })
      const r = (await noGate
        .find((t) => t.name === "create_invite")
        ?.run({ email: "a@x.io" })) as {
        structuredContent: { code: string }
      }
      expect(r.structuredContent.code).toBe("APPROVAL_REQUIRED")
      expect(await g.listInvites()).toEqual([])

      const asked: string[] = []
      const yes = growthTools({
        growth: g,
        allowWrites: true,
        invitedBy: "ops",
        approve: (_ctx, req) => {
          asked.push(req.summary)
          return undefined
        },
      })
      const made = (await yes
        .find((t) => t.name === "create_invite")
        ?.run({ email: "a@x.io", days: 3 })) as {
        token: string
        invite: { id: string; invitedBy: string }
      }
      expect(made.invite.invitedBy).toBe("ops")
      expect(asked[0]).toBe("Invite a@x.io")
      expect(
        await yes.find((t) => t.name === "revoke_invite")?.run({ id: made.invite.id }),
      ).toEqual({ revoked: true })
    })
  })
}
