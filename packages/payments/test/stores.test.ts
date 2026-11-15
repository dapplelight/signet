// App Store and Google Play adapters. Every key, certificate and token here is
// made up in the test: a three-level ECDSA chain built as DER and signed with
// node:crypto (independent of the adapter's Web Crypto code), JWS payloads shaped
// per Apple's JWSTransactionDecodedPayload / responseBodyV2DecodedPayload docs,
// and Pub/Sub OIDC tokens signed with a test RSA key served as a fake JWKS.
import { describe, expect, test } from "bun:test"
import { createHash, generateKeyPairSync, type KeyObject, sign, verify } from "node:crypto"
import { paymentTools } from "../src/agent"
import { isPaymentsError } from "../src/errors"
import { appstore } from "../src/gateways/appstore"
import { googleplay } from "../src/gateways/googleplay"
import { balance } from "../src/ledger"
import { createPayments } from "../src/payments"
import { memoryStore } from "../src/store"
import type { Feature, PaymentGateway } from "../src/types"
import { fakeFetch } from "./fake"

const http = { retryDelayMs: 0 }
const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return isPaymentsError(e) ? e.code : String(e)
  }
}

// ---------------------------------------------------------------- DER + certs

const len = (n: number) => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255])
const tlv = (tag: number, ...parts: Uint8Array[]) => {
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([tag, ...len(body.length)]), body])
}
const seq = (...p: Uint8Array[]) => tlv(0x30, ...p)
const oid = (s: string) => {
  const [a, b, ...rest] = s.split(".").map(Number) as [number, number, ...number[]]
  const out = [40 * a + b]
  for (const v of rest) {
    const st = [v & 127]
    for (let x = v >> 7; x; x >>= 7) st.unshift((x & 127) | 128)
    out.push(...st)
  }
  return tlv(6, Buffer.from(out))
}
const name = (cn: string) => seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from(cn)))))
const utc = (d: Date) =>
  tlv(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-:T]/g, "")}Z`))
const ext = (id: string, value: Uint8Array) => seq(oid(id), tlv(4, value))
const MARK = Buffer.from([5, 0])
const CA = seq(tlv(1, Buffer.from([0xff])))

function cert(o: {
  cn: string
  issuer: string
  pub: KeyObject
  signer: KeyObject
  hash: "sha256" | "sha384"
  exts: Uint8Array[]
  from?: Date
  to?: Date
}): Buffer {
  const alg = seq(oid(o.hash === "sha384" ? "1.2.840.10045.4.3.3" : "1.2.840.10045.4.3.2"))
  const tbs = seq(
    tlv(0xa0, tlv(2, Buffer.from([2]))),
    tlv(2, Buffer.from([1])),
    alg,
    name(o.issuer),
    seq(utc(o.from ?? new Date("2020-01-01")), utc(o.to ?? new Date("2049-01-01"))),
    name(o.cn),
    o.pub.export({ type: "spki", format: "der" }),
    tlv(0xa3, seq(...o.exts)),
  )
  const sig = sign(o.hash, tbs, o.signer)
  return seq(tbs, alg, tlv(3, Buffer.concat([Buffer.from([0]), sig])))
}

const ec = (namedCurve: string) => generateKeyPairSync("ec", { namedCurve })
const root = ec("secp384r1")
const mid = ec("secp384r1")
const leaf = ec("prime256v1")
const rootDer = cert({
  cn: "Test Root",
  issuer: "Test Root",
  pub: root.publicKey,
  signer: root.privateKey,
  hash: "sha384",
  exts: [ext("2.5.29.19", CA)],
})
const midDer = cert({
  cn: "Test WWDR",
  issuer: "Test Root",
  pub: mid.publicKey,
  signer: root.privateKey,
  hash: "sha384",
  exts: [ext("2.5.29.19", CA), ext("1.2.840.113635.100.6.2.1", MARK)],
})
const leafDer = cert({
  cn: "Test Signing",
  issuer: "Test WWDR",
  pub: leaf.publicKey,
  signer: mid.privateKey,
  hash: "sha384",
  exts: [ext("1.2.840.113635.100.6.11.1", MARK)],
})
const ROOT_FP = createHash("sha256").update(rootDer).digest("hex")

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url")
function jws(payload: unknown, o: { x5c?: Buffer[]; key?: KeyObject } = {}) {
  const head = b64u(
    JSON.stringify({
      alg: "ES256",
      x5c: (o.x5c ?? [leafDer, midDer, rootDer]).map((c) => c.toString("base64")),
    }),
  )
  const input = `${head}.${b64u(JSON.stringify(payload))}`
  const sig = sign("sha256", Buffer.from(input), {
    key: o.key ?? leaf.privateKey,
    dsaEncoding: "ieee-p1363",
  })
  return `${input}.${b64u(sig)}`
}

// ---------------------------------------------------------------- App Store

const BUNDLE = "com.example.app"
const apiKey = ec("prime256v1")
const T0 = Date.parse("2026-11-01T10:00:00Z")
const txn = (o: Record<string, unknown> = {}) => ({
  transactionId: "2000000002",
  originalTransactionId: "2000000001",
  bundleId: BUNDLE,
  productId: "pro.monthly",
  type: "Auto-Renewable Subscription",
  purchaseDate: T0,
  originalPurchaseDate: T0 - 30 * 864e5,
  expiresDate: T0 + 30 * 864e5,
  price: 4990,
  currency: "USD",
  environment: "Sandbox",
  appAccountToken: "6f1c3c2e-made-up",
  signedDate: T0,
  ...o,
})
const apple = (routes: Record<string, unknown> = {}) => {
  const f = fakeFetch(routes)
  const g = appstore({
    issuerId: "issuer-made-up",
    keyId: "KEYMADEUP1",
    privateKey: apiKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    bundleId: BUNDLE,
    trustedRoots: [ROOT_FP],
    sandbox: true,
    fetch: f.fetch,
    ...http,
  })
  return { f, g }
}
const notification = (
  type: string,
  subtype: string | undefined,
  t: unknown,
  extra: Record<string, unknown> = {},
) =>
  new Request("https://shop.example.test/hooks/appstore", {
    method: "POST",
    body: JSON.stringify({
      signedPayload: jws({
        notificationType: type,
        ...(subtype ? { subtype } : {}),
        notificationUUID: `uuid-${type}`,
        version: "2.0",
        signedDate: T0,
        data: { bundleId: BUNDLE, environment: "Sandbox", signedTransactionInfo: jws(t), ...extra },
      }),
    }),
  })

// ---------------------------------------------------------------- Google Play

const PKG = "com.example.app"
const API = `/androidpublisher/v3/applications/${PKG}`
const sa = generateKeyPairSync("rsa", { modulusLength: 2048 })
const google = generateKeyPairSync("rsa", { modulusLength: 2048 })
const PUSH = {
  audience: "https://shop.example.test/hooks/googleplay",
  serviceAccountEmail: "push@example-project.iam.gserviceaccount.test",
}
const usd = (units: string, nanos = 0) => ({ currencyCode: "USD", units, nanos })
const order = (id: string, o: Record<string, unknown> = {}) => ({
  orderId: id,
  purchaseToken: "tok-1",
  state: "PROCESSED",
  total: usd("4", 990000000),
  lineItems: [{ productId: "pro.monthly" }],
  createTime: "2026-11-01T10:00:00Z",
  ...o,
})
const sub = (state = "SUBSCRIPTION_STATE_ACTIVE", o: Record<string, unknown> = {}) => ({
  subscriptionState: state,
  startTime: "2026-10-01T10:00:00Z",
  testPurchase: {},
  externalAccountIdentifiers: { obfuscatedExternalAccountId: "acct-made-up" },
  lineItems: [
    {
      productId: "pro.monthly",
      expiryTime: "2026-12-01T10:00:00Z",
      latestSuccessfulOrderId: "GPA.1111-2222-3333-44444..1",
      autoRenewingPlan: { autoRenewEnabled: true },
    },
  ],
  ...o,
})
const googleRoutes = (extra: Record<string, unknown> = {}) => ({
  "POST /token": ({ form }: any) => {
    const [h, p, s] = form.get("assertion").split(".")
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), sa.publicKey, Buffer.from(s, "base64url"))
    const c = JSON.parse(Buffer.from(p, "base64url").toString())
    if (!ok || c.scope !== "https://www.googleapis.com/auth/androidpublisher")
      return { error: "bad" }
    return { access_token: "ya29.made-up", expires_in: 3600 }
  },
  "GET /oauth2/v3/certs": {
    keys: [
      { ...google.publicKey.export({ format: "jwk" }), kid: "kid-1", alg: "RS256", use: "sig" },
    ],
  },
  [`GET ${API}/purchases/subscriptionsv2/tokens/tok-1`]: sub(),
  [`GET ${API}/orders/GPA.1111-2222-3333-44444..1`]: order("GPA.1111-2222-3333-44444..1"),
  ...extra,
})
const play = (routes: Record<string, unknown> = googleRoutes()) => {
  const f = fakeFetch(routes)
  const g = googleplay({
    packageName: PKG,
    serviceAccount: {
      client_email: "api@example-project.iam.gserviceaccount.test",
      private_key: sa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    },
    pubsub: PUSH,
    fetch: f.fetch,
    ...http,
  })
  return { f, g }
}
const oidc = (claims: Record<string, unknown> = {}, key = google.privateKey) => {
  const input = `${b64u(JSON.stringify({ alg: "RS256", kid: "kid-1", typ: "JWT" }))}.${b64u(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: PUSH.audience,
      email: PUSH.serviceAccountEmail,
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    }),
  )}`
  return `${input}.${b64u(sign("sha256", Buffer.from(input), key))}`
}
const push = (n: Record<string, unknown>, token = oidc()) =>
  new Request(PUSH.audience, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      message: {
        data: b64u(
          JSON.stringify({ version: "1.0", packageName: PKG, eventTimeMillis: String(T0), ...n }),
        ),
        messageId: "136969346945",
      },
      subscription: "projects/example/subscriptions/play",
    }),
  })

// ---------------------------------------------------------------- conformance

const CALL: Record<Feature, (g: PaymentGateway) => Promise<unknown>> = {
  capture: (g) => g.capture("x", { idempotencyKey: "k" }),
  refunds: (g) => g.refund("x", { idempotencyKey: "k" }),
  partialRefunds: (g) => g.refund("x", { amount: 1, idempotencyKey: "k" }),
  subscriptions: (g) => g.getSubscription("x"),
  customers: (g) => g.createCustomer({ email: "a@example.test" }),
  savedMethods: (g) => g.listPaymentMethods("x"),
  payouts: (g) =>
    g.createPayout({ amount: 1, currency: "USD", destination: "x", idempotencyKey: "k" }),
  settlements: (g) => g.listSettlements({ date: "2026-01-01" }),
  webhooks: (g) => g.verifyWebhook(new Request("https://x.test", { method: "POST", body: "{}" })),
}

for (const [label, make, features] of [
  ["appstore", () => apple(), ["subscriptions", "webhooks"]],
  ["googleplay", () => play({}), ["refunds", "subscriptions", "webhooks"]],
] as const) {
  describe(`conformance: ${label}`, () => {
    test("capabilities are honest; unsupported calls and checkout reject before the network", async () => {
      const { f, g } = make()
      expect([...g.capabilities.features].sort()).toEqual([...features].sort())
      expect(g.capabilities.methods).toEqual([])
      for (const feature of Object.keys(CALL) as Feature[])
        if (!g.supports(feature))
          expect(`${feature}:${await code(CALL[feature](g))}`).toBe(`${feature}:UNSUPPORTED`)
      expect(
        await code(g.createCheckout({ amount: 100, currency: "USD", idempotencyKey: "k" })),
      ).toBe("UNSUPPORTED")
      expect(await code(g.cancelSubscription("x"))).toBe("UNSUPPORTED")
      expect(f.calls).toHaveLength(0)
    })
  })
}

// ---------------------------------------------------------------- App Store

describe("appstore", () => {
  test("getPayment: a verified transaction in minor units, with an ES256 API token", async () => {
    const { f, g } = apple({
      "GET /inApps/v1/transactions/2000000002": { signedTransactionInfo: jws(txn()) },
    })
    const p = await g.getPayment("2000000002")
    expect(p).toMatchObject({
      gatewayId: "2000000002",
      amount: 499,
      currency: "USD",
      status: "captured",
      orderId: "2000000001",
      productId: "pro.monthly",
      environment: "sandbox",
      customerId: "6f1c3c2e-made-up",
      approximate: true,
    })
    expect(f.calls[0].url).toBe(
      "https://api.storekit-sandbox.apple.com/inApps/v1/transactions/2000000002",
    )
    const [h, c, s] = f.calls[0].headers.authorization!.slice(7).split(".") as [
      string,
      string,
      string,
    ]
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEYMADEUP1",
      typ: "JWT",
    })
    const claims = JSON.parse(Buffer.from(c, "base64url").toString())
    expect(claims).toMatchObject({ iss: "issuer-made-up", aud: "appstoreconnect-v1", bid: BUNDLE })
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600)
    expect(
      verify(
        "sha256",
        Buffer.from(`${h}.${c}`),
        { key: apiKey.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(s, "base64url"),
      ),
    ).toBe(true)
  })

  test("a prorated refund and zero-decimal currencies", async () => {
    const { g } = apple()
    const r = await g.decodeTransaction(
      jws(
        txn({ revocationDate: T0, revocationType: "REFUND_PRORATED", revocationPercentage: 50000 }),
      ),
    )
    expect(r).toMatchObject({ status: "partially_refunded", amountRefunded: 250 })
    expect((await g.decodeTransaction(jws(txn({ price: 500000, currency: "JPY" })))).amount).toBe(
      500,
    )
    const fam = await g.decodeTransaction(
      jws(txn({ revocationDate: T0, revocationType: "FAMILY_REVOKE" })),
    )
    expect(fam.status).toBe("captured")
  })

  test("getSubscription: status, grace period, auto-renew off reads as cancelled", async () => {
    const item = (status: number, autoRenewStatus: number) => ({
      environment: "Sandbox",
      data: [
        {
          subscriptionGroupIdentifier: "g1",
          lastTransactions: [
            {
              originalTransactionId: "2000000001",
              status,
              signedTransactionInfo: jws(txn()),
              signedRenewalInfo: jws({
                originalTransactionId: "2000000001",
                autoRenewStatus,
                productId: "pro.monthly",
                signedDate: T0,
              }),
            },
          ],
        },
      ],
    })
    let { g } = apple({ "GET /inApps/v1/subscriptions/2000000001": item(4, 1) })
    expect(await g.getSubscription("2000000001")).toMatchObject({
      gatewayId: "2000000001",
      status: "past_due",
      inGracePeriod: true,
      autoRenew: true,
      productId: "pro.monthly",
      currentPeriodEnd: new Date(T0 + 30 * 864e5),
    })
    ;({ g } = apple({ "GET /inApps/v1/subscriptions/2000000001": item(1, 0) }))
    expect(await g.getSubscription("2000000001")).toMatchObject({
      status: "cancelled",
      autoRenew: false,
    })
  })

  test("history and refund lookup page through verified transactions", async () => {
    const { f, g } = apple({
      "GET /inApps/v2/history/2000000001": {
        signedTransactions: [jws(txn())],
        revision: "rev-2",
        hasMore: true,
      },
      "GET /inApps/v2/refund/lookup/2000000001": { signedTransactions: [], hasMore: false },
    })
    expect(await g.transactionHistory("2000000001", { revision: "rev-1" })).toMatchObject({
      revision: "rev-2",
      hasMore: true,
    })
    expect(f.calls[0].url).toContain("revision=rev-1")
    expect((await g.refundHistory("2000000001")).payments).toEqual([])
  })

  test("notifications: renewal, auto-renew off, refund", async () => {
    const { g } = apple()
    const renew = await g.verifyWebhook(notification("DID_RENEW", undefined, txn()))
    expect(renew).toMatchObject({
      id: "uuid-DID_RENEW",
      type: "subscription.charged",
      paymentId: "2000000002",
      orderId: "2000000001",
      subscriptionId: "2000000001",
      amount: 499,
      currency: "USD",
      environment: "sandbox",
    })
    expect(
      (
        await g.verifyWebhook(
          notification("DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", txn()),
        )
      ).type,
    ).toBe("subscription.cancelled")
    expect(
      (await g.verifyWebhook(notification("DID_FAIL_TO_RENEW", "GRACE_PERIOD", txn()))).type,
    ).toBe("subscription.past_due")
    const refund = await g.verifyWebhook(
      notification("REFUND", undefined, txn({ revocationDate: T0, revocationType: "REFUND_FULL" })),
    )
    expect(refund).toMatchObject({
      type: "refund.processed",
      refundId: "2000000002:refund",
      amount: 499,
    })
  })

  test("notifications that fail verification are rejected", async () => {
    const { g } = apple()
    const good = notification("DID_RENEW", undefined, txn())
    const { signedPayload } = JSON.parse(await good.text())
    const [h, , s] = signedPayload.split(".")
    const forged = `${h}.${b64u(JSON.stringify({ notificationType: "DID_RENEW", data: { bundleId: BUNDLE } }))}.${s}`
    const post = (sp: string) =>
      g.verifyWebhook(
        new Request("https://x.test", {
          method: "POST",
          body: JSON.stringify({ signedPayload: sp }),
        }),
      )
    expect(await code(post(forged))).toBe("BAD_SIGNATURE")
    // Signed by a key whose chain does not lead to the trusted root.
    const other = ec("secp384r1")
    const otherRoot = cert({
      cn: "Other",
      issuer: "Other",
      pub: other.publicKey,
      signer: other.privateKey,
      hash: "sha384",
      exts: [ext("2.5.29.19", CA)],
    })
    expect(
      await code(post(jws({ data: { bundleId: BUNDLE } }, { x5c: [leafDer, midDer, otherRoot] }))),
    ).toBe("BAD_SIGNATURE")
    // A leaf without Apple's receipt-signing extension.
    const plain = cert({
      cn: "Plain",
      issuer: "Test WWDR",
      pub: leaf.publicKey,
      signer: mid.privateKey,
      hash: "sha384",
      exts: [ext("2.5.29.19", CA)],
    })
    expect(
      await code(post(jws({ data: { bundleId: BUNDLE } }, { x5c: [plain, midDer, rootDer] }))),
    ).toBe("BAD_SIGNATURE")
    // An intermediate that the root did not sign.
    const rogue = cert({
      cn: "Test WWDR",
      issuer: "Test Root",
      pub: mid.publicKey,
      signer: other.privateKey,
      hash: "sha384",
      exts: [ext("2.5.29.19", CA), ext("1.2.840.113635.100.6.2.1", MARK)],
    })
    expect(
      await code(post(jws({ data: { bundleId: BUNDLE } }, { x5c: [leafDer, rogue, rootDer] }))),
    ).toBe("BAD_SIGNATURE")
    // Expired at signing time.
    const old = cert({
      cn: "Test Signing",
      issuer: "Test WWDR",
      pub: leaf.publicKey,
      signer: mid.privateKey,
      hash: "sha384",
      exts: [ext("1.2.840.113635.100.6.11.1", MARK)],
      to: new Date("2021-01-01"),
    })
    expect(
      await code(
        post(jws({ signedDate: T0, data: { bundleId: BUNDLE } }, { x5c: [old, midDer, rootDer] })),
      ),
    ).toBe("BAD_SIGNATURE")
    // Another app's notification.
    expect(await code(post(jws({ data: { bundleId: "com.example.other" } })))).toBe("BAD_SIGNATURE")
    // The real Apple root is the default: a test chain is refused without trustedRoots.
    const strict = appstore({
      issuerId: "i",
      keyId: "k",
      privateKey: "x",
      bundleId: BUNDLE,
      fetch: fakeFetch({}).fetch,
    })
    expect(await code(strict.verifyWebhook(notification("DID_RENEW", undefined, txn())))).toBe(
      "BAD_SIGNATURE",
    )
  })
})

// ---------------------------------------------------------------- Google Play

describe("googleplay", () => {
  test("service account token, then getSubscription", async () => {
    const { f, g } = play()
    const s = await g.getSubscription("tok-1")
    expect(s).toMatchObject({
      gatewayId: "tok-1",
      status: "active",
      productId: "pro.monthly",
      autoRenew: true,
      inGracePeriod: false,
      environment: "sandbox",
      customerId: "acct-made-up",
      currentPeriodEnd: new Date("2026-12-01T10:00:00Z"),
    })
    expect(f.calls[0].url).toBe("https://oauth2.googleapis.com/token")
    expect(f.calls[1].headers.authorization).toBe("Bearer ya29.made-up")
    await g.getSubscription("tok-1")
    expect(f.calls.filter((c) => c.path === "/token")).toHaveLength(1) // cached
  })

  test("subscription states", async () => {
    for (const [state, status, grace] of [
      ["SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "past_due", true],
      ["SUBSCRIPTION_STATE_ON_HOLD", "past_due", false],
      ["SUBSCRIPTION_STATE_CANCELED", "cancelled", false],
      ["SUBSCRIPTION_STATE_EXPIRED", "expired", false],
      ["SUBSCRIPTION_STATE_PAUSED", "paused", false],
    ] as const) {
      const { g } = play(
        googleRoutes({ [`GET ${API}/purchases/subscriptionsv2/tokens/tok-1`]: sub(state) }),
      )
      expect(await g.getSubscription("tok-1")).toMatchObject({ status, inGracePeriod: grace })
    }
  })

  test("getPayment reads the order; refund is full only and revokes by default", async () => {
    const id = "GPA.1111-2222-3333-44444..1"
    const { f, g } = play(googleRoutes({ [`POST ${API}/orders/${id}:refund`]: undefined }))
    expect(await g.getPayment(id)).toMatchObject({
      gatewayId: id,
      amount: 499,
      currency: "USD",
      status: "captured",
      orderId: "tok-1",
      productId: "pro.monthly",
    })
    expect((await g.getPayment(id)).approximate).toBeUndefined() // Play orders are what was paid
    expect(await code(g.refund(id, { amount: 100, idempotencyKey: "k" }))).toBe("UNSUPPORTED")
    const r = await g.refund(id, { idempotencyKey: "k" })
    expect(r).toMatchObject({
      paymentId: id,
      amount: 499,
      status: "pending",
      gatewayId: `${id}:refund`,
    })
    const call = f.calls.find((c) => c.method === "POST" && c.path.endsWith(":refund"))!
    expect(new URL(call.url).searchParams.get("revoke")).toBe("true")
  })

  test("cancel stops renewal at the period end; one-time purchases acknowledge and consume", async () => {
    const { f, g } = play(
      googleRoutes({
        [`POST ${API}/purchases/subscriptionsv2/tokens/tok-1:cancel`]: {},
        [`POST ${API}/purchases/products/coins.100/tokens/tok-2:acknowledge`]: undefined,
        [`POST ${API}/purchases/products/coins.100/tokens/tok-2:consume`]: undefined,
        [`GET ${API}/purchases/productsv2/tokens/tok-2`]: {
          orderId: "GPA.9",
          testPurchaseContext: {},
          productLineItem: [{ productId: "coins.100" }],
        },
        [`GET ${API}/orders/GPA.9`]: order("GPA.9", { purchaseToken: "tok-2", total: usd("1", 0) }),
        [`GET ${API}/purchases/voidedpurchases`]: {
          voidedPurchases: [{ orderId: "GPA.9" }],
          tokenPagination: { nextPageToken: "n2" },
        },
      }),
    )
    expect(await code(g.cancelSubscription("tok-1"))).toBe("UNSUPPORTED")
    await g.cancelSubscription("tok-1", { atPeriodEnd: true })
    const cancel = f.calls.find((c) => c.path.endsWith(":cancel"))!
    expect(JSON.parse(cancel.body!)).toEqual({
      cancellationContext: { cancellationType: "USER_REQUESTED_STOP_RENEWALS" },
    })
    await g.acknowledgeProduct("coins.100", "tok-2")
    await g.consumeProduct("coins.100", "tok-2")
    expect(await g.getProductPurchase("tok-2")).toMatchObject({
      gatewayId: "GPA.9",
      amount: 100,
      orderId: "tok-2",
      environment: "sandbox",
    })
    expect(await g.listVoided({ startTime: 1 })).toEqual({
      voided: [{ orderId: "GPA.9" }],
      nextPageToken: "n2",
    })
  })

  test("RTDN: a verified push, then the authoritative state from the API", async () => {
    const { g } = play(
      googleRoutes({
        [`GET ${API}/purchases/productsv2/tokens/tok-2`]: { orderId: "GPA.9" },
        [`GET ${API}/orders/GPA.9`]: order("GPA.9", {
          purchaseToken: "tok-2",
          total: usd("1", 0),
          orderHistory: {
            refundEvent: {
              refundDetails: { total: usd("1", 0) },
              eventTime: "2026-11-02T00:00:00Z",
            },
          },
        }),
      }),
    )
    const renewed = await g.verifyWebhook(
      push({
        subscriptionNotification: { version: "1.0", notificationType: 2, purchaseToken: "tok-1" },
      }),
    )
    expect(renewed).toMatchObject({
      id: "136969346945",
      type: "subscription.charged",
      subscriptionId: "tok-1",
      orderId: "tok-1",
      paymentId: "GPA.1111-2222-3333-44444..1",
      amount: 499,
      currency: "USD",
      productId: "pro.monthly",
    })
    const bought = await g.verifyWebhook(
      push({
        oneTimeProductNotification: {
          notificationType: 1,
          purchaseToken: "tok-2",
          sku: "coins.100",
        },
      }),
    )
    expect(bought).toMatchObject({
      type: "payment.captured",
      paymentId: "GPA.9",
      amount: 100,
      orderId: "tok-2",
    })
    const voided = await g.verifyWebhook(
      push({
        voidedPurchaseNotification: {
          purchaseToken: "tok-2",
          orderId: "GPA.9",
          productType: 2,
          refundType: 1,
        },
      }),
    )
    expect(voided).toMatchObject({
      type: "refund.processed",
      paymentId: "GPA.9",
      refundId: "GPA.9:refund",
      amount: 100,
    })
    expect((await g.verifyWebhook(push({ testNotification: { version: "1.0" } }))).type).toBe(
      "unknown",
    )
  })

  test("RTDN: pushes that fail verification are rejected before any API call", async () => {
    const n = { subscriptionNotification: { notificationType: 2, purchaseToken: "tok-1" } }
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 })
    for (const token of [
      oidc({ aud: "https://elsewhere.example.test" }),
      oidc({ email: "someone@example.test" }),
      oidc({ email_verified: false }),
      oidc({ iss: "https://evil.example.test" }),
      oidc({ exp: Math.floor(Date.now() / 1000) - 10 }),
      oidc({}, other.privateKey),
    ]) {
      const { f, g } = play()
      expect(await code(g.verifyWebhook(push(n, token)))).toBe("BAD_SIGNATURE")
      expect(f.calls.some((c) => c.path.startsWith(API))).toBe(false)
    }
    const { g } = play()
    expect(
      await code(g.verifyWebhook(new Request(PUSH.audience, { method: "POST", body: "{}" }))),
    ).toBe("BAD_SIGNATURE")
    expect(await code(g.verifyWebhook(push({ packageName: "com.example.other", ...n })))).toBe(
      "BAD_SIGNATURE",
    )
  })
})

// ---------------------------------------------------------------- createPayments + agent

describe("store purchases in createPayments", () => {
  test("verifyPurchase claims a purchase for one user; renewals link; agent tools see it", async () => {
    const db = memoryStore()
    const { g: ap } = apple({
      "GET /inApps/v1/transactions/2000000002": { signedTransactionInfo: jws(txn()) },
      "GET /inApps/v1/subscriptions/2000000001": {
        data: [
          {
            lastTransactions: [
              {
                originalTransactionId: "2000000001",
                status: 1,
                signedTransactionInfo: jws(txn()),
                signedRenewalInfo: jws({ autoRenewStatus: 1, signedDate: T0 }),
              },
            ],
          },
        ],
      },
    })
    const payments = createPayments({ gateways: [ap], db })
    await payments.verifyPurchase({ gateway: "appstore", id: "2000000002", userId: "u1" })
    expect(
      await code(payments.verifyPurchase({ gateway: "appstore", id: "2000000002", userId: "u2" })),
    ).toBe("BAD_INPUT")
    await payments.verifyPurchase({ gateway: "appstore", id: "2000000002", userId: "u1" }) // idempotent

    // A renewal is a new transaction: it inherits the owner through the original transaction id.
    const res = await payments.handleWebhook(
      "appstore",
      notification(
        "DID_RENEW",
        undefined,
        txn({ transactionId: "2000000003", purchaseDate: T0 + 30 * 864e5 }),
      ),
    )
    expect(res.status).toBe(200)
    const renewal = await db.getPayment("appstore", "2000000003")
    expect(renewal).toMatchObject({
      userId: "u1",
      status: "captured",
      amount: 499,
      orderId: "2000000001",
    })
    // On the ledger, flagged approximate: Apple's configured price, not settled revenue.
    const captured = await db.entries({ ref: "2000000003" })
    expect(captured.map((e) => [e.account, e.amount, e.kind])).toEqual([
      ["receivable:appstore", 499, "capture:approximate"],
      ["revenue", -499, "capture:approximate"],
    ])
    expect(await balance(db, "revenue", "USD")).toBe(-499)
    await payments.handleWebhook(
      "appstore",
      notification(
        "REFUND",
        undefined,
        txn({ transactionId: "2000000003", revocationDate: T0, revocationType: "REFUND_FULL" }),
      ),
    )
    expect(
      (await db.entries({ ref: "2000000003", account: "refunds" })).map((e) => [e.amount, e.kind]),
    ).toEqual([[499, "refund:approximate"]])
    expect((await db.getPayment("appstore", "2000000003"))?.status).toBe("refunded")

    const approvals: unknown[] = []
    const tools = paymentTools(payments, {
      userId: "u1",
      approve: (_c, r) => void approvals.push(r),
    })
    const run = (n: string, input: Record<string, unknown>) =>
      tools.find((t) => t.name === n)!.run(input)
    expect(await run("find_payment", { gateway: "appstore", id: "2000000003" })).toMatchObject({
      amount: 499,
      status: "refunded",
    })
    expect(await run("find_subscription", { gateway: "appstore", id: "2000000001" })).toMatchObject(
      { status: "active", productId: "pro.monthly", autoRenew: true },
    )
    expect(
      await code(
        run("refund_payment", {
          gateway: "appstore",
          id: "2000000003",
          reason: "asked",
          idempotencyKey: "r1",
        }),
      ),
    ).toBe("UNSUPPORTED")
    expect(approvals).toHaveLength(0)

    const other = paymentTools(payments, { userId: "u2" })
    expect(
      await code(
        other
          .find((t) => t.name === "find_subscription")!
          .run({ gateway: "appstore", id: "2000000001" }),
      ),
    ).toBe("NOT_FOUND")
  })

  test("google play refunds go through the approval hook", async () => {
    const id = "GPA.1111-2222-3333-44444..1"
    const { f, g } = play(googleRoutes({ [`POST ${API}/orders/${id}:refund`]: undefined }))
    const payments = createPayments({ gateways: [g], db: memoryStore() })
    await payments.verifyPurchase({ gateway: "googleplay", id, userId: "u1" })
    const asked: unknown[] = []
    const tools = paymentTools(payments, { userId: "u1" })
    const refund = tools.find((t) => t.name === "refund_payment")!
    const gated: any = await refund.run({
      gateway: "googleplay",
      id,
      reason: "asked",
      idempotencyKey: "r1",
    })
    expect(gated.structuredContent.code).toBe("APPROVAL_REQUIRED")
    expect(f.calls.some((c) => c.path.endsWith(":refund"))).toBe(false)
    const approved = paymentTools(payments, {
      userId: "u1",
      approve: (_c, r) => void asked.push(r),
    })
    const out: any = await approved
      .find((t) => t.name === "refund_payment")!
      .run({ gateway: "googleplay", id, reason: "asked", idempotencyKey: "r1" })
    expect(out).toMatchObject({ refunded: true, amount: 499, status: "pending" })
    expect(asked).toHaveLength(1)
  })
})

describe("review fixes", () => {
  const make = (o: { sandbox?: boolean; allowSandbox?: boolean }) =>
    appstore({
      issuerId: "issuer-made-up",
      keyId: "KEYMADEUP1",
      privateKey: apiKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      bundleId: BUNDLE,
      trustedRoots: [ROOT_FP],
      fetch: fakeFetch({}).fetch,
      ...o,
      ...http,
    })
  const prod = (t: unknown) =>
    new Request("https://x.test", {
      method: "POST",
      body: JSON.stringify({
        signedPayload: jws({
          notificationType: "DID_RENEW",
          notificationUUID: "uuid-prod",
          signedDate: T0,
          data: { bundleId: BUNDLE, environment: "Production", signedTransactionInfo: jws(t) },
        }),
      }),
    })

  test("signed payloads must match the configured environment", async () => {
    const sandboxTxn = txn()
    const prodTxn = txn({ environment: "Production" })
    // Production setup: Sandbox notifications and transactions are rejected.
    expect(
      await code(make({}).verifyWebhook(notification("DID_RENEW", undefined, sandboxTxn))),
    ).toBe("BAD_SIGNATURE")
    expect(await code(make({}).decodeTransaction(jws(sandboxTxn)))).toBe("BAD_SIGNATURE")
    expect(await code(make({}).verifyWebhook(prod(sandboxTxn)))).toBe("BAD_SIGNATURE")
    expect((await make({}).verifyWebhook(prod(prodTxn))).environment).toBe("production")
    // Staging: allowSandbox takes both.
    expect(
      (
        await make({ allowSandbox: true }).verifyWebhook(
          notification("DID_RENEW", undefined, sandboxTxn),
        )
      ).environment,
    ).toBe("sandbox")
    expect((await make({ allowSandbox: true }).decodeTransaction(jws(prodTxn))).environment).toBe(
      "production",
    )
    // Sandbox setup never takes Production data.
    expect(await code(make({ sandbox: true }).verifyWebhook(prod(prodTxn)))).toBe("BAD_SIGNATURE")
    expect(
      await code(make({ sandbox: true, allowSandbox: true }).decodeTransaction(jws(prodTxn))),
    ).toBe("BAD_SIGNATURE")
  })

  test("verifyPurchase refuses another transaction of a subscription someone else owns", async () => {
    const db = memoryStore()
    const { g } = apple({
      "GET /inApps/v1/transactions/2000000002": { signedTransactionInfo: jws(txn()) },
      "GET /inApps/v1/transactions/2000000003": {
        signedTransactionInfo: jws(txn({ transactionId: "2000000003" })),
      },
      "GET /inApps/v1/transactions/3000000001": {
        signedTransactionInfo: jws(
          txn({ transactionId: "3000000001", originalTransactionId: "3000000001" }),
        ),
      },
    })
    const payments = createPayments({ gateways: [g], db })
    await payments.verifyPurchase({ gateway: "appstore", id: "2000000002", userId: "u1" })
    // A renewal of u1's subscription cannot be claimed by u2, even before its own row exists.
    expect(
      await code(payments.verifyPurchase({ gateway: "appstore", id: "2000000003", userId: "u2" })),
    ).toBe("BAD_INPUT")
    expect(await db.getPayment("appstore", "2000000003")).toBeUndefined()
    // u1 can claim it; an unrelated subscription is free for u2.
    await payments.verifyPurchase({ gateway: "appstore", id: "2000000003", userId: "u1" })
    await payments.verifyPurchase({ gateway: "appstore", id: "3000000001", userId: "u2" })
  })

  test("verifyPurchase takes over payments of the subscription that arrived before the claim", async () => {
    const db = memoryStore()
    const { g } = apple({
      "GET /inApps/v1/transactions/2000000003": {
        signedTransactionInfo: jws(txn({ transactionId: "2000000003" })),
      },
    })
    const payments = createPayments({ gateways: [g], db })
    // The first purchase's webhook lands before the app calls verifyPurchase: no owner yet.
    await payments.handleWebhook("appstore", notification("SUBSCRIBED", "INITIAL_BUY", txn()))
    expect((await db.getPayment("appstore", "2000000002"))?.userId).toBeUndefined()
    await payments.verifyPurchase({ gateway: "appstore", id: "2000000003", userId: "u1" })
    expect((await db.getPayment("appstore", "2000000002"))?.userId).toBe("u1")
    // ...and now nobody else can claim either transaction.
    expect(
      await code(payments.verifyPurchase({ gateway: "appstore", id: "2000000003", userId: "u2" })),
    ).toBe("BAD_INPUT")
  })
})

describe("restorePurchases", () => {
  const appleRoutes = (t = txn()) => ({
    [`GET /inApps/v1/transactions/${t.transactionId}`]: { signedTransactionInfo: jws(t) },
    "GET /inApps/v1/subscriptions/2000000001": {
      data: [
        {
          lastTransactions: [
            {
              originalTransactionId: "2000000001",
              status: 1,
              signedTransactionInfo: jws(t),
              signedRenewalInfo: jws({ autoRenewStatus: 1, signedDate: T0 }),
            },
          ],
        },
      ],
    },
  })

  test("App Store: a signed transaction is re-verified live and claimed once", async () => {
    const db = memoryStore()
    const { f, g } = apple(appleRoutes())
    const payments = createPayments({ gateways: [g], db })
    const r = await payments.restorePurchases({
      userId: "u1",
      purchases: [{ gateway: "appstore", signedTransaction: jws(txn()) }],
    })
    expect(r.refused).toEqual([])
    expect(r.restored).toHaveLength(1)
    expect(r.restored[0]?.payment).toMatchObject({ gatewayId: "2000000002", orderId: "2000000001" })
    expect(r.restored[0]?.subscription).toMatchObject({
      gatewayId: "2000000001",
      status: "active",
      productId: "pro.monthly",
      currentPeriodEnd: new Date(T0 + 30 * 864e5),
    })
    // The shape signet-db's storeStateOf reads: Apple's status, transaction and renewal info.
    expect(r.restored[0]?.subscription?.raw).toMatchObject({
      status: 1,
      transaction: { expiresDate: T0 + 30 * 864e5 },
    })
    // Re-verified against Apple, not only trusted from the device.
    expect(f.calls.map((c) => c.path)).toEqual([
      "/inApps/v1/transactions/2000000002",
      "/inApps/v1/subscriptions/2000000001",
    ])
    expect((await db.getPayment("appstore", "2000000002"))?.userId).toBe("u1")

    // Another user restoring the same receipt is refused; a forged one too. Neither throws.
    const forged = jws(txn(), { key: ec("prime256v1").privateKey })
    const other = await payments.restorePurchases({
      userId: "u2",
      purchases: [
        { gateway: "appstore", signedTransaction: jws(txn()) },
        { gateway: "appstore", signedTransaction: forged },
      ],
    })
    expect(other.restored).toEqual([])
    expect(other.refused.map((x) => [x.index, x.code])).toEqual([
      [0, "BAD_INPUT"],
      [1, "BAD_SIGNATURE"],
    ])
    expect((await db.getPayment("appstore", "2000000002"))?.userId).toBe("u1")
  })

  test("App Store: a one-time purchase restores without a subscription", async () => {
    const t = txn({
      transactionId: "2000000050",
      originalTransactionId: "2000000050",
      type: "Non-Consumable",
    })
    const { g } = apple(appleRoutes(t))
    const payments = createPayments({ gateways: [g], db: memoryStore() })
    const r = await payments.restorePurchases({
      userId: "u1",
      purchases: [{ gateway: "appstore", signedTransaction: jws(t) }],
    })
    expect(r.restored[0]?.payment.gatewayId).toBe("2000000050")
    expect(r.restored[0]?.subscription).toBeUndefined()
  })

  test("Google Play: subscription and product tokens; pending and owned ones refused; outages throw", async () => {
    const db = memoryStore()
    const { g } = play(
      googleRoutes({
        [`GET ${API}/purchases/productsv2/tokens/tok-2`]: { orderId: "GPA.9" },
        [`GET ${API}/orders/GPA.9`]: order("GPA.9", { purchaseToken: "tok-2" }),
        [`GET ${API}/purchases/subscriptionsv2/tokens/tok-3`]: sub("SUBSCRIPTION_STATE_PENDING", {
          lineItems: [{ productId: "pro.monthly" }],
        }),
        [`GET ${API}/purchases/subscriptionsv2/tokens/tok-down`]: () => {
          throw new TypeError("network down")
        },
      }),
    )
    const payments = createPayments({ gateways: [g], db })
    const r = await payments.restorePurchases({
      userId: "u1",
      purchases: [
        { gateway: "googleplay", purchaseToken: "tok-1", type: "subscription" },
        { gateway: "googleplay", purchaseToken: "tok-2", type: "product" },
        { gateway: "googleplay", purchaseToken: "tok-3", type: "subscription" },
      ],
    })
    expect(r.restored.map((x) => [x.payment.gatewayId, x.subscription?.status])).toEqual([
      ["GPA.1111-2222-3333-44444..1", "active"],
      ["GPA.9", undefined],
    ])
    expect(r.restored[0]?.subscription?.raw).toMatchObject({
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    })
    expect(r.refused).toMatchObject([{ index: 2, code: "NOT_FOUND" }])
    expect((await db.getPayment("googleplay", "GPA.9"))?.userId).toBe("u1")

    const theirs = await payments.restorePurchases({
      userId: "u2",
      purchases: [{ gateway: "googleplay", purchaseToken: "tok-1", type: "subscription" }],
    })
    expect(theirs.refused).toMatchObject([{ code: "BAD_INPUT" }])
    expect(
      await code(
        payments.restorePurchases({
          userId: "u1",
          purchases: [{ gateway: "googleplay", purchaseToken: "tok-down", type: "subscription" }],
        }),
      ),
    ).toBe("GATEWAY_UNAVAILABLE")
    expect(await code(payments.restorePurchases({ userId: "", purchases: [] }))).toBe("BAD_INPUT")
  })

  test("refresh_entitlement re-applies a subscription the user owns, only with entitlements", async () => {
    const { g } = play()
    const payments = createPayments({ gateways: [g], db: memoryStore() })
    await payments.verifyPurchase({
      gateway: "googleplay",
      id: "GPA.1111-2222-3333-44444..1",
      userId: "u1",
    })
    const applied: unknown[] = []
    const entitlements = {
      applySubscription: async (s: unknown, o: { subject: string }) => {
        applied.push([s, o])
        return { applied: true, subject: o.subject, plan: "pro" }
      },
    }
    expect(
      paymentTools(payments, { userId: "u1" }).some((t) => t.name === "refresh_entitlement"),
    ).toBe(false)
    const tool = paymentTools(payments, { userId: "u1", entitlements }).find(
      (t) => t.name === "refresh_entitlement",
    )!
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(await tool.run({ gateway: "googleplay", id: "tok-1" })).toMatchObject({
      subscription: { status: "active", id: "tok-1" },
      result: { applied: true, subject: "u1" },
    })
    expect(applied).toHaveLength(1)
    const otherTool = paymentTools(payments, { userId: "u2", entitlements }).find(
      (t) => t.name === "refresh_entitlement",
    )!
    expect(await code(otherTool.run({ gateway: "googleplay", id: "tok-1" }))).toBe("NOT_FOUND")
    expect(applied).toHaveLength(1)
  })
})
