// App Store and Google Play fakes through the real adapters, and entitlements
// and the ledger under renewals, grace periods, billing retry, refunds and
// revocations, with duplicate and out-of-order delivery.
import { describe, expect, test } from "bun:test"
import { isPaymentsError } from "@dapplelight/signet-payments"
import { appstore } from "@dapplelight/signet-payments/appstore"
import { googleplay } from "@dapplelight/signet-payments/googleplay"
import { DAY, fakeClock } from "../src/clock"
import { type FakeAppStore, type FakeGooglePlay, fakeAppStore, fakeGooglePlay } from "../src/stores"
import { books } from "./harness"

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return isPaymentsError(e) ? e.code : String(e)
  }
}

describe("fakeAppStore", () => {
  test("a hand-built notification verifies through the real adapter", async () => {
    const clock = fakeClock("2026-11-01T10:00:00Z")
    const apple = fakeAppStore({ now: clock.now })
    const gw = appstore({ ...apple.config, now: clock.now })
    const t = apple.transaction({ productId: "pro.yearly", price: 49990 })
    const e = await gw.verifyWebhook(apple.notification("SUBSCRIBED", "INITIAL_BUY", t))
    expect(e).toMatchObject({
      paymentId: t.transactionId,
      productId: "pro.yearly",
      amount: 4999,
      currency: "USD",
      environment: "sandbox",
    })
    apple.serve(t)
    expect((await gw.getPayment(t.transactionId)).productId).toBe("pro.yearly")
    expect(apple.calls[0]?.path).toBe(`/inApps/v1/transactions/${t.transactionId}`)
  })

  test("another fake's chain is not trusted", async () => {
    const a = fakeAppStore()
    const b = fakeAppStore()
    expect(
      await code(
        appstore(a.config).verifyWebhook(b.notification("SUBSCRIBED", undefined, b.transaction())),
      ),
    ).toBe("BAD_SIGNATURE")
  })

  const setup = () => {
    let apple!: FakeAppStore
    const b = books((now) => {
      apple = fakeAppStore({ now })
      return [appstore({ ...apple.config, now })]
    })
    return { ...b, apple, gw: b.gws[0] as ReturnType<typeof appstore> }
  }

  test("subscribe and renew: pro until expiry, revenue booked once per period, replays ignored", async () => {
    const { apple, deliver, plan, ent, clock, bal, gw } = setup()
    const { originalTransactionId: otid, notification } = apple.subscribe()
    await deliver("appstore", notification.clone(), notification.clone())
    expect(await plan()).toBe("pro")
    expect(await bal("revenue", "USD")).toBe(-499)
    expect((await gw.getSubscription(otid)).status).toBe("active")

    clock.advance(30 * DAY)
    const renewal = apple.renew(otid)
    await deliver("appstore", renewal.clone(), renewal.clone())
    expect(await plan()).toBe("pro")
    expect(await bal("revenue", "USD")).toBe(-998)
    expect((await ent.get("u1")).currentPeriodEnd?.getTime()).toBe(clock.now() + 30 * DAY)
  })

  test("grace period keeps access until it ends; billing retry does not", async () => {
    const { apple, deliver, plan, clock, gw } = setup()
    const { originalTransactionId: otid, notification } = apple.subscribe()
    await deliver("appstore", notification)
    clock.advance(30 * DAY)
    await deliver("appstore", apple.failRenewal(otid, { graceDays: 6 }))
    expect((await gw.getSubscription(otid)).inGracePeriod).toBe(true)
    expect(await plan()).toBe("pro")
    clock.advance(7 * DAY)
    expect(await plan()).toBe("free")
    await deliver("appstore", apple.failRenewal(otid))
    expect(await plan()).toBe("free")
    await deliver("appstore", apple.renew(otid))
    expect(await plan()).toBe("pro")
  })

  test("cancel renewal keeps access to the period end, then expiry ends it", async () => {
    const { apple, deliver, plan, clock, gw } = setup()
    const { originalTransactionId: otid, notification } = apple.subscribe()
    await deliver("appstore", notification)
    await deliver("appstore", apple.cancelRenewal(otid))
    expect((await gw.getSubscription(otid)).status).toBe("cancelled")
    expect(await plan()).toBe("pro")
    clock.advance(30 * DAY)
    await deliver("appstore", apple.expire(otid))
    expect(await plan()).toBe("free")
  })

  test("refund revokes access and books the refund once; a late renewal cannot restore it", async () => {
    const { apple, deliver, plan, bal, clock } = setup()
    const { originalTransactionId: otid, notification } = apple.subscribe()
    await deliver("appstore", notification)
    clock.advance(DAY)
    const stale = apple.renew(otid) // built now, delivered after the refund
    clock.advance(DAY)
    const refund = apple.refund(otid)
    await deliver("appstore", refund.clone(), refund.clone())
    expect(await plan()).toBe("free")
    await deliver("appstore", stale)
    expect(await plan()).toBe("free")
    expect(await bal("refunds", "USD")).toBe(499)
  })

  test("Family Sharing revoke ends access without booking a refund", async () => {
    const { apple, deliver, plan, bal } = setup()
    const { originalTransactionId: otid, notification } = apple.subscribe()
    await deliver("appstore", notification)
    await deliver("appstore", apple.revoke(otid))
    expect(await plan()).toBe("free")
    expect(await bal("refunds", "USD")).toBe(0)
  })
})

describe("fakeGooglePlay", () => {
  const setup = () => {
    let play!: FakeGooglePlay
    const b = books((now) => {
      play = fakeGooglePlay({ now })
      return [googleplay({ ...play.config, now })]
    })
    return { ...b, play, gw: b.gws[0] as ReturnType<typeof googleplay> }
  }

  test("a signed push verifies and reads the fake Play API", async () => {
    const { play, gw } = setup()
    const orderId = play.subscribe("tok-1")
    const e = await gw.verifyWebhook(play.notification(4, "tok-1"))
    expect(e).toMatchObject({
      type: "subscription.created",
      subscriptionId: "tok-1",
      paymentId: orderId,
      amount: 499,
      currency: "USD",
    })
    expect((await gw.getSubscription("tok-1")).status).toBe("active")
    expect(play.calls.some((c) => c.path === "/oauth2/v3/certs")).toBe(true)
  })

  test("purchase and renewals: pro, revenue per order, replays ignored", async () => {
    const { play, deliver, plan, bal, clock } = setup()
    play.subscribe("tok-1")
    const bought = play.notification(4, "tok-1")
    await deliver("googleplay", bought.clone(), bought.clone())
    expect(await plan()).toBe("pro")
    expect(await bal("revenue", "USD")).toBe(-499)
    clock.advance(30 * DAY)
    const renewed = play.renew("tok-1")
    await deliver("googleplay", renewed.clone(), renewed.clone())
    expect(await bal("revenue", "USD")).toBe(-998)
    expect(await plan()).toBe("pro")
  })

  test("grace period keeps access to its end; account hold blocks it", async () => {
    const { play, deliver, plan, clock } = setup()
    play.subscribe("tok-1")
    await deliver("googleplay", play.notification(4, "tok-1"))
    clock.advance(30 * DAY)
    await deliver("googleplay", play.failRenewal("tok-1", { graceDays: 3 }))
    expect(await plan()).toBe("pro")
    clock.advance(4 * DAY)
    expect(await plan()).toBe("free")
    await deliver("googleplay", play.failRenewal("tok-1"))
    expect(await plan()).toBe("free")
  })

  test("cancel keeps access to the period end; expiry ends it", async () => {
    const { play, deliver, plan, clock } = setup()
    play.subscribe("tok-1")
    await deliver("googleplay", play.notification(4, "tok-1"))
    await deliver("googleplay", play.cancel("tok-1"))
    expect(await plan()).toBe("pro")
    clock.advance(30 * DAY)
    await deliver("googleplay", play.expire("tok-1"))
    expect(await plan()).toBe("free")
  })

  test("refund with revoke: refund booked once, access ends", async () => {
    const { play, deliver, plan, bal } = setup()
    play.subscribe("tok-1")
    await deliver("googleplay", play.notification(4, "tok-1"))
    const [voided, revoked] = play.refund("tok-1")
    await deliver("googleplay", (voided as Request).clone(), voided as Request, revoked as Request)
    expect(await plan()).toBe("free")
    expect(await bal("refunds", "USD")).toBe(499)
  })
})
