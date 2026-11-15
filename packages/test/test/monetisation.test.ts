// Monetisation end to end on the fakes: App Store, Google Play and Stripe
// through the real adapters, signet-payments' inbox and ledger, signet-db's
// entitlements, offerings and customers over SQLite, signet-server's routes
// and notifier. Identity merge under repeats and races, the customer
// timeline, and the Customer Center, with no double grants anywhere.
import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import * as sqc from "@dapplelight/signet-db/columns/sqlite"
import { createCustomers } from "@dapplelight/signet-db/customers"
import { createEntitlements, definePlans } from "@dapplelight/signet-db/entitlements"
import { createOfferings, plansFromProducts } from "@dapplelight/signet-db/offerings"
import { createDb } from "@dapplelight/signet-db/sqlite"
import { createPayments, type Event, memoryStore } from "@dapplelight/signet-payments"
import { appstore } from "@dapplelight/signet-payments/appstore"
import { googleplay } from "@dapplelight/signet-payments/googleplay"
import { monetisationRoutes } from "@dapplelight/signet-server/http/monetisation"
import { createNotifier, defineTemplates } from "@dapplelight/signet-server/notify/notifier"
import { z } from "zod"
import { DAY, fakeClock } from "../src/clock"
import { fakeNotifyStore, fakeSenders } from "../src/notify"
import { fakeGateway } from "../src/payments"
import { fakeAppStore, fakeGooglePlay } from "../src/stores"
import { ddl } from "./harness"

const plans = definePlans({ free: { features: [] }, pro: { features: ["sso"] } })
const PRODUCTS = [
  { id: "pro.monthly", store: "appstore", plan: "pro" as const, interval: "month" as const },
  { id: "pro.monthly", store: "googleplay", plan: "pro" as const, interval: "month" as const },
  {
    id: "price_pro",
    store: "web",
    plan: "pro" as const,
    interval: "month" as const,
    price: { amount: 1999, currency: "USD" },
  },
]
const admin = { type: "user" as const, id: "admin-1" }
type Any = any

function world() {
  const clock = fakeClock("2026-11-01T10:00:00Z")
  const sqlite = new Database(":memory:")
  const ent = sqc.entitlementTables()
  const mon = sqc.monetisationTables()
  const audit = sqc.auditLog()
  const idempotency = sqc.idempotencyKeys()
  for (const t of [...Object.values(ent), ...Object.values(mon), audit, idempotency])
    sqlite.run(ddl(t))
  const db = createDb(sqlite, { audit, idempotency })
  const entitlements = createEntitlements(db, {
    plans,
    default: "free",
    tables: ent,
    now: () => clock.date(),
    billing: { plans: plansFromProducts(PRODUCTS), graceMs: 0 },
  })
  const offerings = createOfferings(db, { tables: mon, plans })

  const apple = fakeAppStore({ now: clock.now })
  const play = fakeGooglePlay({ now: clock.now })
  const stripe = fakeGateway("stripe", { now: clock.now })
  const store = memoryStore()

  const { outbox, senders } = fakeSenders()
  const notifier = createNotifier({
    channels: senders,
    store: fakeNotifyStore(),
    recipients: async () => ({ email: "team@example.test" }),
    templates: defineTemplates({
      "customer.request": {
        category: "account",
        data: z.object({ kind: z.string(), text: z.string() }),
        en: { email: { subject: (d) => `[${d.kind}] ${d.text}`, html: (d) => `<p>${d.text}</p>` } },
      },
    }),
  })
  const notices: string[] = []
  const retentionApplied: string[] = []
  const customers = createCustomers(db, {
    tables: { ...ent, ...mon },
    entitlements,
    payments: store,
    now: () => clock.date(),
    googlePlayPackage: "com.example.app",
    notify: async (n) => {
      notices.push(n.kind)
      await notifier.notify("team", "customer.request", { kind: n.kind, text: n.text })
    },
    cancel: (s) =>
      payments.gateway(s.gateway).cancelSubscription(s.subscriptionId, { atPeriodEnd: true }),
    retention: {
      offer: { kind: "discount", percent: 50, months: 3 },
      apply: ({ subject, source }) => {
        retentionApplied.push(`${subject}:${source.subscriptionId}`)
      },
    },
  })

  // Who an event is for: the app set the anonymous id (App Store appAccountToken,
  // Play obfuscatedExternalAccountId, Stripe metadata) at purchase. Resolved
  // through merges, so later renewals land on the account.
  const ownerOf = async (e: Event): Promise<string | undefined> => {
    const r = e.raw as Any
    const tag =
      (r?.transaction?.appAccountToken && `anon_${r.transaction.appAccountToken}`) ??
      r?.subscription?.externalAccountIdentifiers?.obfuscatedExternalAccountId ??
      r?.data?.object?.metadata?.userId
    return tag ? customers.resolve(tag) : undefined
  }
  const applied: unknown[] = []
  const payments = createPayments({
    gateways: [
      appstore({ ...apple.config, now: clock.now }),
      googleplay({ ...play.config, now: clock.now }),
      stripe,
    ],
    db: store,
    onEvent: async (event) => {
      const subject = await ownerOf(event)
      applied.push(await entitlements.applyBillingEvent(event, subject ? { subject } : {}))
      await customers.record(event, subject ? { subject } : {})
    },
  })
  const deliver = async (gateway: string, ...reqs: Request[]) => {
    for (const r of reqs) {
      const res = await payments.handleWebhook(gateway, r)
      expect(res.status).toBe(200)
    }
  }
  const sub = async (subject: string) => entitlements.get(subject)
  return {
    clock,
    db,
    entitlements,
    offerings,
    customers,
    apple,
    play,
    stripe,
    store,
    payments,
    deliver,
    sub,
    outbox,
    notices,
    retentionApplied,
    applied,
  }
}

describe("identity merge, end to end", () => {
  test("anonymous App Store buyer signs in: one grant, on the account, through renewals and replays", async () => {
    const w = world()
    const anon = await w.customers.anonymousId()
    const { originalTransactionId: otid, notification } = w.apple.subscribe({
      appAccountToken: anon.slice(5),
    })
    await w.deliver("appstore", notification.clone())
    expect((await w.sub(anon)).plan).toBe("pro")
    // The app verifies the purchase as the anonymous user (claims the payment).
    const [first] = await w.store.listPayments({ gateway: "appstore", limit: 10 })
    await w.payments.verifyPurchase({
      gateway: "appstore",
      id: first?.gatewayId as string,
      userId: anon,
    })
    expect((await w.store.listPayments({ userId: anon, limit: 10 })).length).toBe(1)

    // Sign in; the app retries the merge, and a second device races it.
    const runs = await Promise.all([
      w.customers.merge({ anonymousId: anon, userId: "u1" }),
      w.customers.merge({ anonymousId: anon, userId: "u1" }),
      w.customers.merge({ anonymousId: anon, userId: "u1" }),
    ])
    expect(runs.every((r) => r.merged)).toBe(true)
    const moved = runs.reduce(
      (n, r) =>
        r.merged ? { subs: n.subs + r.moved.subscriptions, pays: n.pays + r.moved.payments } : n,
      { subs: 0, pays: 0 },
    )
    expect(moved).toEqual({ subs: 1, pays: 1 })
    expect((await w.customers.merge({ anonymousId: anon, userId: "u2" })).merged).toBe(false)

    const u1 = await w.sub("u1")
    expect(u1.plan).toBe("pro")
    expect(u1.entitlements.find((e) => e.plan === "pro")?.sources.length).toBe(1)
    expect((await w.sub(anon)).plan).toBe("free")
    expect((await w.sub("u2")).plan).toBe("free")
    expect((await w.store.listPayments({ userId: "u1", limit: 10 })).length).toBe(1)

    // The old receipt cannot be claimed again by the anonymous id or anyone else.
    for (const who of [anon, "u2"])
      await expect(
        w.payments.verifyPurchase({
          gateway: "appstore",
          id: first?.gatewayId as string,
          userId: who,
        }),
      ).rejects.toMatchObject({ code: "BAD_INPUT" })
    await w.payments.verifyPurchase({
      gateway: "appstore",
      id: first?.gatewayId as string,
      userId: "u1",
    })

    // A renewal after the merge (still tagged with the anonymous token) lands on u1;
    // replaying every notification changes nothing and books revenue once each.
    w.clock.advance(30 * DAY)
    const renewal = w.apple.renew(otid)
    await w.deliver("appstore", renewal.clone(), renewal.clone(), notification.clone())
    expect((await w.sub("u1")).entitlements.find((e) => e.plan === "pro")?.sources.length).toBe(1)
    expect((await w.sub("u1")).currentPeriodEnd?.getTime()).toBe(w.clock.now() + 30 * DAY)
    expect(await w.store.balance("revenue", "USD")).toBe(-998)
    expect(w.applied.some((r) => (r as Any).reason === "other_subject")).toBe(false)

    const tl = await w.customers.timeline("u1")
    expect(tl.entries.map((e) => e.kind)).toEqual(["renewal", "purchase"])
    // Both periods were paid by u1: the renewal links to the claimed purchase.
    expect(tl.totals).toEqual([{ currency: "USD", paid: 998, refunded: 0, approximate: true }])
    expect((await w.customers.timeline(anon)).entries).toEqual([])
  })

  test("a Play purchase merges into one account only; another org's anonymous id never merges", async () => {
    const w = world()
    const anon = await w.customers.anonymousId({ orgId: "org_a" })
    w.play.subscribe("tok-1", { accountId: anon })
    await w.deliver("googleplay", w.play.notification(4, "tok-1"))
    expect((await w.sub(anon)).plan).toBe("pro")
    expect(await w.customers.merge({ anonymousId: anon, userId: "u1", orgId: "org_b" })).toEqual({
      merged: false,
      reason: "other_org",
    })
    const [a, b] = await Promise.all([
      w.customers.merge({ anonymousId: anon, userId: "ua", orgId: "org_a" }),
      w.customers.merge({ anonymousId: anon, userId: "ub", orgId: "org_a" }),
    ])
    expect([a, b].filter((r) => r.merged).length).toBe(1)
    const winner = a.merged ? "ua" : "ub"
    const loser = a.merged ? "ub" : "ua"
    expect((await w.sub(winner)).plan).toBe("pro")
    expect((await w.sub(loser)).plan).toBe("free")
    // A renewal follows the winner.
    w.clock.advance(30 * DAY)
    await w.deliver("googleplay", w.play.renew("tok-1"))
    expect((await w.customers.timeline(winner)).entries.map((e) => e.kind)).toEqual([
      "renewal",
      "purchase",
    ])
    expect((await w.customers.timeline(loser)).entries).toEqual([])
  })
})

describe("customer timeline", () => {
  test("App Store and Google Play: purchases, grace periods, billing issues, cancellations, refunds", async () => {
    const w = world()
    const a = await w.customers.anonymousId()
    await w.customers.merge({ anonymousId: a, userId: "u1" })
    // Both stores tag the account id now that the user is signed in.
    const { originalTransactionId: otid, notification } = w.apple.subscribe({
      appAccountToken: a.slice(5),
    })
    await w.deliver("appstore", notification)
    const order = w.play.subscribe("tok-9", { accountId: "u1" })
    await w.deliver("googleplay", w.play.notification(4, "tok-9"))
    await w.payments.verifyPurchase({ gateway: "googleplay", id: order, userId: "u1" })
    w.clock.advance(30 * DAY)
    await w.deliver("appstore", w.apple.failRenewal(otid, { graceDays: 6 }))
    await w.deliver("googleplay", w.play.failRenewal("tok-9"))
    w.clock.advance(DAY)
    await w.deliver("appstore", w.apple.cancelRenewal(otid))
    await w.deliver("googleplay", ...w.play.refund("tok-9"))

    const { entries } = await w.customers.timeline("u1")
    const seen = entries.map((e) => `${e.gateway}:${e.kind}`)
    for (const want of [
      "appstore:purchase",
      "googleplay:purchase",
      "appstore:grace_period",
      "googleplay:billing_issue",
      "appstore:cancellation",
      "googleplay:refund",
      "googleplay:expiration",
    ])
      expect(seen).toContain(want)
    expect(entries.every((e, i) => i === 0 || entries[i - 1]!.occurredAt >= e.occurredAt)).toBe(
      true,
    )
    // Recording is idempotent: the inbox replays, the timeline does not grow.
    const n = entries.length
    await w.deliver("appstore", w.apple.renew(otid))
    await w.payments.replay(
      "googleplay",
      entries.find((e) => e.gateway === "googleplay")!.id.split("|")[1]!,
    )
    expect((await w.customers.timeline("u1")).entries.length).toBe(n + 1)
  })
})

describe("customer center", () => {
  async function webSubscriber(w: ReturnType<typeof world>) {
    const s = await w.stripe.subscribe({
      plan: "price_pro",
      amount: 1999,
      currency: "USD",
      notes: { userId: "u1" },
    })
    await w.deliver("stripe", ...s.webhooks)
    return s.id
  }

  test("web: overview, retention once, cancel at the gateway, refund and support through notify", async () => {
    const w = world()
    const subId = await webSubscriber(w)
    const ov = await w.customers.overview("u1")
    expect(ov).toMatchObject({
      plan: "pro",
      renews: true,
      store: false,
      canCancel: true,
      source: { gateway: "stripe", subscriptionId: subId },
      retention: { kind: "discount", percent: 50 },
    })
    expect(ov.currentPeriodEnd).not.toBeNull()

    // Retention: accepted once, applied once, then not offered again.
    const [r1, r2] = await Promise.all([
      w.customers.acceptRetention("u1"),
      w.customers.acceptRetention("u1"),
    ])
    expect([r1.accepted, r2.accepted].sort()).toEqual([false, true])
    expect(w.retentionApplied).toEqual([`u1:${subId}`])
    expect((await w.customers.overview("u1")).retention).toBeNull()

    // Cancel: at the gateway, at period end; the gateway's webhook keeps access to the end.
    expect(await w.customers.cancel("u1", { reason: "Too expensive" })).toMatchObject({
      cancelled: true,
    })
    expect(w.stripe.state.subscriptions.get(subId)?.cancel_at_period_end).toBe(true)
    await w.deliver("stripe", ...(await w.stripe.takeWebhooks()))
    expect((await w.sub("u1")).plan).toBe("pro")
    const after = await w.customers.overview("u1")
    expect([after.renews, after.canCancel]).toEqual([false, false])
    expect((await w.customers.cancel("u1")).cancelled).toBe(false)

    // Refund request: only for the customer's own payment, once, and the team hears once.
    const [payment] = await w.store.listPayments({ gateway: "stripe", limit: 5 })
    const pid = payment?.gatewayId as string
    // A web checkout records its user (payments.checkout({ userId })); the fake's subscription did not.
    await w.store.savePayment({ ...payment!, userId: "u1" })
    await expect(
      w.customers.requestRefund("u2", { gateway: "stripe", paymentId: pid, reason: "Not mine" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    const ref1 = await w.customers.requestRefund("u1", {
      gateway: "stripe",
      paymentId: pid,
      reason: "Charged twice",
    })
    const ref2 = await w.customers.requestRefund("u1", {
      gateway: "stripe",
      paymentId: pid,
      reason: "Charged twice",
    })
    expect([ref1.created, ref2.created]).toEqual([true, false])
    expect(ref2.request.id).toBe(ref1.request.id)
    await w.customers.contactSupport("u1", { message: "Where is my invoice?", topic: "billing" })
    expect(w.notices).toEqual(["refund_request", "support"])
    await Bun.sleep(30)
    const subjects = w.outbox.messages
      .filter((m) => m.channel === "email")
      .map((m) => (m.rendered as Any).subject)
    expect(
      subjects.some((s: string) => s.startsWith("[refund_request] Refund requested for stripe")),
    ).toBe(true)
    expect(
      subjects.some((s: string) => s.startsWith("[support] Support message from u1 (billing)")),
    ).toBe(true)
    const open = await w.customers.requests({ status: "open" })
    expect(open.map((r) => r.kind).sort()).toEqual(["refund", "support"])
    await w.customers.setRequestStatus(ref1.request.id, "done", { actor: admin })
    expect((await w.customers.requests({ kind: "refund" }))[0]?.status).toBe("done")
  })

  test("stores: no server cancel, a deep link instead; no retention offer by default", async () => {
    const w = world()
    w.play.subscribe("tok-c", { accountId: "u3" })
    await w.deliver("googleplay", w.play.notification(4, "tok-c"))
    const ov = await w.customers.overview("u3")
    expect(ov).toMatchObject({ store: true, canCancel: false, retention: null, renews: true })
    expect(ov.manageUrl).toBe(
      "https://play.google.com/store/account/subscriptions?sku=pro.monthly&package=com.example.app",
    )
    expect(await w.customers.cancel("u3")).toEqual({
      cancelled: false,
      reason: "store",
      manageUrl: ov.manageUrl,
    })
    expect((await w.customers.acceptRetention("u3")).accepted).toBe(false)
  })

  test("through the HTTP routes: offering, merge, overview and refund", async () => {
    const w = world()
    await w.offerings.publish(
      "default",
      { products: PRODUCTS, paywall: { title: "Go pro", highlight: "pro", trial: "7 days free" } },
      { actor: admin },
    )
    await w.offerings.setPlacement("onboarding", { offering: "default" }, { actor: admin })
    // Mounted at /billing in an app; requested directly here.
    const app = monetisationRoutes({
      offerings: w.offerings,
      customers: w.customers,
      subject: (c) => c.req.header("x-user") ?? c.req.header("x-anon"),
      userId: (c) => c.req.header("x-user"),
    })
    // Mounted under an app with signet-server's errorHandler, these become the envelope;
    // requested directly, the ApiException carries the status.
    const status = async (r: Response | Promise<Response>) => {
      try {
        return (await r).status
      } catch (e) {
        return (e as { status?: number }).status
      }
    }
    const get = (p: string, h: Record<string, string> = {}) => app.request(p, { headers: h })
    const post = (p: string, body: unknown, h: Record<string, string> = {}) =>
      app.request(p, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...h },
      })

    const off = await (await get("/offerings/onboarding?platform=web")).json()
    expect(off.offering).toMatchObject({ key: "default", version: 1, paywall: { title: "Go pro" } })
    // The web product the paywall offers is the one entitlements map to pro.
    const web = off.offering.products.find((p: Any) => p.store === "web")
    const { anonymousId } = await (await post("/anonymous", {})).json()
    const s = await w.stripe.subscribe({
      plan: web.id,
      amount: 1999,
      currency: "USD",
      notes: { userId: anonymousId },
    })
    await w.deliver("stripe", ...s.webhooks)
    expect((await (await get("/customer", { "x-anon": anonymousId })).json()).plan).toBe("pro")

    const m = await post("/merge", { anonymousId }, { "x-user": "u9" })
    expect(m.status).toBe(200)
    expect(await status(post("/merge", { anonymousId }, { "x-user": "u10" }))).toBe(409)
    const ov = await (await get("/customer", { "x-user": "u9" })).json()
    expect(ov).toMatchObject({ plan: "pro", canCancel: true })
    expect((await (await get("/customer", { "x-anon": anonymousId })).json()).plan).toBe("free")
    const tl = await (await get("/customer/timeline", { "x-user": "u9" })).json()
    expect(tl.entries.map((e: Any) => e.kind)).toContain("purchase")
    const bad = post(
      "/customer/refund",
      { gateway: "stripe", paymentId: "pi_nope", reason: "x" },
      { "x-user": "u9" },
    )
    expect(await status(bad)).toBe(404)
  })
})
