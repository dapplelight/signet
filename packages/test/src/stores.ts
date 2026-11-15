/**
 * Fake App Store and Google Play backends for the real `appstore()` and
 * `googleplay()` adapters. Every key, certificate and token is generated in
 * the test process: an ECDSA certificate chain whose root fingerprint you pass
 * as `trustedRoots`, an RSA key served as Google's JWKS, a service account the
 * fake token endpoint accepts. Signed transactions and server notifications
 * (App Store Server Notifications V2, Play Real-time Developer Notifications
 * over Pub/Sub push) then verify through the adapters' own code.
 *
 * Node or Bun only (uses node:crypto); test code, never production.
 *
 *   const apple = fakeAppStore()
 *   const gw = appstore(apple.config)
 *   const req = apple.notification("SUBSCRIBED", "INITIAL_BUY", apple.transaction())
 *   const event = await gw.verifyWebhook(req)
 */
import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto"
import { type FakeFetch, fakeFetch } from "./fetch.js"

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
const dn = (cn: string) => seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from(cn)))))
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
}): Buffer {
  const alg = seq(oid(o.hash === "sha384" ? "1.2.840.10045.4.3.3" : "1.2.840.10045.4.3.2"))
  const tbs = seq(
    tlv(0xa0, tlv(2, Buffer.from([2]))),
    tlv(2, Buffer.from([1])),
    alg,
    dn(o.issuer),
    seq(utc(new Date("2020-01-01")), utc(new Date("2049-01-01"))),
    dn(o.cn),
    o.pub.export({ type: "spki", format: "der" }),
    tlv(0xa3, seq(...o.exts)),
  )
  return seq(tbs, alg, tlv(3, Buffer.concat([Buffer.from([0]), sign(o.hash, tbs, o.signer)])))
}

const ec = (namedCurve: string) => generateKeyPairSync("ec", { namedCurve })
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url")
const pem = (k: KeyObject) => k.export({ type: "pkcs8", format: "pem" }).toString()

// ---------------------------------------------------------------- App Store

const DAY_MS = 864e5

export type AppStoreTransaction = Record<string, unknown> & {
  transactionId: string
  originalTransactionId: string
  productId: string
}

/** App Store subscription status codes (Get All Subscription Statuses). */
export type AppStoreStatus = 1 | 2 | 3 | 4 | 5

type AppleSub = {
  transactions: AppStoreTransaction[]
  status: AppStoreStatus
  renewal: Record<string, unknown>
  periodMs: number
}

export type FakeAppStore = {
  /** Spread into `appstore(...)`. */
  config: {
    issuerId: string
    keyId: string
    privateKey: string
    bundleId: string
    trustedRoots: string[]
    sandbox: true
    fetch: typeof fetch
    retryDelayMs: number
  }
  /** Calls the adapter made to the (fake) App Store Server API. */
  calls: FakeFetch["calls"]
  /** A JWSTransactionDecodedPayload, Sandbox, with defaults you override. */
  transaction(overrides?: Partial<AppStoreTransaction>): AppStoreTransaction
  /** Sign any payload as Apple would (ES256, x5c chain). */
  sign(payload: unknown): string
  /** Serve a transaction from Get Transaction Info, for `getPayment`. */
  serve(transaction: AppStoreTransaction): void
  /** A signed notification POST, as Apple sends it. `status` and `renewalInfo` go in `data`. */
  notification(
    type: string,
    subtype: string | undefined,
    transaction: AppStoreTransaction,
    extra?: { status?: AppStoreStatus; renewalInfo?: Record<string, unknown> },
  ): Request
  /**
   * Lifecycle: each call moves the subscription the way Apple would, keeps
   * Get All Subscription Statuses (`getSubscription`) and Get Transaction
   * Info in step, and returns the signed notification Apple sends.
   */
  subscribe(options?: {
    productId?: string
    price?: number
    periodDays?: number
    appAccountToken?: string
  }): { originalTransactionId: string; notification: Request }
  /** DID_RENEW: a new transaction for the next period. */
  renew(originalTransactionId: string): Request
  /** DID_FAIL_TO_RENEW: with `graceDays`, Billing Grace Period (status 4, access kept); without, billing retry (status 3). */
  failRenewal(originalTransactionId: string, options?: { graceDays?: number }): Request
  /** DID_CHANGE_RENEWAL_STATUS / AUTO_RENEW_DISABLED: access lasts to the period end. */
  cancelRenewal(originalTransactionId: string): Request
  /** EXPIRED (VOLUNTARY or BILLING_RETRY). */
  expire(originalTransactionId: string): Request
  /** REFUND of the latest transaction: revoked, status 5. */
  refund(originalTransactionId: string): Request
  /** REVOKE: Family Sharing access withdrawn, status 5. */
  revoke(originalTransactionId: string): Request
}

export function fakeAppStore(
  options: { bundleId?: string; now?: () => number; url?: string } = {},
): FakeAppStore {
  const bundleId = options.bundleId ?? "com.example.app"
  const now = options.now ?? Date.now
  const root = ec("secp384r1")
  const mid = ec("secp384r1")
  const leaf = ec("prime256v1")
  const rootDer = cert({
    cn: "Signet Test Root",
    issuer: "Signet Test Root",
    pub: root.publicKey,
    signer: root.privateKey,
    hash: "sha384",
    exts: [ext("2.5.29.19", CA)],
  })
  const midDer = cert({
    cn: "Signet Test WWDR",
    issuer: "Signet Test Root",
    pub: mid.publicKey,
    signer: root.privateKey,
    hash: "sha384",
    exts: [ext("2.5.29.19", CA), ext("1.2.840.113635.100.6.2.1", MARK)],
  })
  const leafDer = cert({
    cn: "Signet Test Signing",
    issuer: "Signet Test WWDR",
    pub: leaf.publicKey,
    signer: mid.privateKey,
    hash: "sha384",
    exts: [ext("1.2.840.113635.100.6.11.1", MARK)],
  })
  const x5c = [leafDer, midDer, rootDer].map((c) => c.toString("base64"))
  const f = fakeFetch()
  const subs = new Map<string, AppleSub>()
  let n = 0

  const signJws = (payload: unknown) => {
    const input = `${b64u(JSON.stringify({ alg: "ES256", x5c }))}.${b64u(JSON.stringify(payload))}`
    const sig = sign("sha256", Buffer.from(input), {
      key: leaf.privateKey,
      dsaEncoding: "ieee-p1363",
    })
    return `${input}.${b64u(sig)}`
  }
  const transaction = (o: Partial<AppStoreTransaction> = {}): AppStoreTransaction => {
    const t = now()
    const id = String(2000000000 + ++n)
    return {
      transactionId: id,
      originalTransactionId: id,
      bundleId,
      productId: "pro.monthly",
      type: "Auto-Renewable Subscription",
      purchaseDate: t,
      originalPurchaseDate: t,
      expiresDate: t + 30 * DAY_MS,
      price: 4990,
      currency: "USD",
      environment: "Sandbox",
      signedDate: t,
      ...o,
    }
  }
  const serve = (t: AppStoreTransaction) => {
    f.routes[`GET /inApps/v1/transactions/${t.transactionId}`] = {
      signedTransactionInfo: signJws(t),
    }
  }
  const notification: FakeAppStore["notification"] = (type, subtype, t, extra = {}) =>
    new Request(options.url ?? "https://app.example.test/webhooks/appstore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signedPayload: signJws({
          notificationType: type,
          ...(subtype ? { subtype } : {}),
          notificationUUID: crypto.randomUUID(),
          version: "2.0",
          signedDate: now(),
          data: {
            bundleId,
            environment: "Sandbox",
            signedTransactionInfo: signJws(t),
            ...(extra.renewalInfo ? { signedRenewalInfo: signJws(extra.renewalInfo) } : {}),
            ...(extra.status ? { status: extra.status } : {}),
          },
        }),
      }),
    })

  const get = (otid: string) => {
    const s = subs.get(otid)
    if (!s) throw new Error(`signet-test: no App Store subscription ${otid}`)
    return s
  }
  const latest = (s: AppleSub) => s.transactions[s.transactions.length - 1] as AppStoreTransaction
  /** Update the status route and send one notification about the latest transaction. */
  const emit = (otid: string, type: string, subtype?: string) => {
    const s = get(otid)
    const t = latest(s)
    s.renewal = { ...s.renewal, signedDate: now() }
    serve(t)
    f.routes[`GET /inApps/v1/subscriptions/${otid}`] = {
      bundleId,
      environment: "Sandbox",
      data: [
        {
          subscriptionGroupIdentifier: "group-1",
          lastTransactions: [
            {
              originalTransactionId: otid,
              status: s.status,
              signedTransactionInfo: signJws(t),
              signedRenewalInfo: signJws(s.renewal),
            },
          ],
        },
      ],
    }
    return notification(type, subtype, t, { status: s.status, renewalInfo: s.renewal })
  }

  return {
    config: {
      issuerId: "signet-test-issuer",
      keyId: "SIGNETTEST",
      privateKey: pem(ec("prime256v1").privateKey),
      bundleId,
      trustedRoots: [createHash("sha256").update(rootDer).digest("hex")],
      sandbox: true,
      fetch: f.fetch,
      retryDelayMs: 0,
    },
    calls: f.calls,
    transaction,
    sign: signJws,
    serve,
    notification,
    subscribe(o = {}) {
      const periodMs = (o.periodDays ?? 30) * DAY_MS
      const t = transaction({
        productId: o.productId ?? "pro.monthly",
        price: o.price ?? 4990,
        expiresDate: now() + periodMs,
        ...(o.appAccountToken ? { appAccountToken: o.appAccountToken } : {}),
      })
      const otid = t.originalTransactionId
      subs.set(otid, {
        transactions: [t],
        status: 1,
        periodMs,
        renewal: {
          originalTransactionId: otid,
          autoRenewProductId: t.productId,
          productId: t.productId,
          autoRenewStatus: 1,
          environment: "Sandbox",
          renewalDate: t.expiresDate,
        },
      })
      return { originalTransactionId: otid, notification: emit(otid, "SUBSCRIBED", "INITIAL_BUY") }
    },
    renew(otid) {
      const s = get(otid)
      const prev = latest(s)
      const start = Math.max(Number(prev.expiresDate), now())
      s.transactions.push(
        transaction({
          ...prev,
          transactionId: String(2000000000 + ++n),
          purchaseDate: start,
          expiresDate: start + s.periodMs,
          signedDate: now(),
          revocationDate: undefined,
          revocationReason: undefined,
        }),
      )
      s.status = 1
      s.renewal = {
        ...s.renewal,
        renewalDate: start + s.periodMs,
        gracePeriodExpiresDate: undefined,
        isInBillingRetryPeriod: false,
      }
      return emit(otid, "DID_RENEW")
    },
    failRenewal(otid, o = {}) {
      const s = get(otid)
      s.status = o.graceDays ? 4 : 3
      s.renewal = {
        ...s.renewal,
        isInBillingRetryPeriod: true,
        ...(o.graceDays
          ? { gracePeriodExpiresDate: Number(latest(s).expiresDate) + o.graceDays * DAY_MS }
          : {}),
      }
      return emit(otid, "DID_FAIL_TO_RENEW", o.graceDays ? "GRACE_PERIOD" : undefined)
    },
    cancelRenewal(otid) {
      const s = get(otid)
      s.renewal = { ...s.renewal, autoRenewStatus: 0 }
      return emit(otid, "DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED")
    },
    expire(otid) {
      const s = get(otid)
      const voluntary = s.renewal.autoRenewStatus === 0
      s.status = 2
      return emit(otid, "EXPIRED", voluntary ? "VOLUNTARY" : "BILLING_RETRY")
    },
    refund(otid) {
      const s = get(otid)
      const t = latest(s)
      Object.assign(t, {
        revocationDate: now(),
        revocationReason: 0,
        revocationType: "REFUND_FULL",
      })
      s.status = 5
      return emit(otid, "REFUND")
    },
    revoke(otid) {
      const s = get(otid)
      const t = latest(s)
      Object.assign(t, {
        revocationDate: now(),
        revocationReason: 0,
        revocationType: "FAMILY_REVOKE",
      })
      s.status = 5
      return emit(otid, "REVOKE")
    },
  }
}

// ---------------------------------------------------------------- Google Play

export type PlayState =
  | "SUBSCRIPTION_STATE_ACTIVE"
  | "SUBSCRIPTION_STATE_CANCELED"
  | "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
  | "SUBSCRIPTION_STATE_ON_HOLD"
  | "SUBSCRIPTION_STATE_PAUSED"
  | "SUBSCRIPTION_STATE_EXPIRED"

export type FakeGooglePlay = {
  /** Spread into `googleplay(...)`. */
  config: {
    packageName: string
    serviceAccount: { client_email: string; private_key: string }
    pubsub: { audience: string; serviceAccountEmail: string }
    fetch: typeof fetch
    retryDelayMs: number
  }
  /** Calls the adapter made to the (fake) Play Developer API, token endpoint and JWKS. */
  calls: FakeFetch["calls"]
  /**
   * Record an active subscription (subscriptionsv2) and its first order for
   * `token`. Returns the order id. `notification(4, token)` announces it.
   */
  subscribe(
    token: string,
    options?: {
      productId?: string
      state?: PlayState
      periodDays?: number
      price?: { units: string; nanos?: number; currencyCode?: string }
      accountId?: string
    },
  ): string
  /** A signed Pub/Sub push for a SubscriptionNotification (4 = PURCHASED, 2 = RENEWED, 3 = CANCELED...). */
  notification(notificationType: number, token: string): Request
  /** RENEWED: a new order and the next period. */
  renew(token: string): Request
  /** IN_GRACE_PERIOD (access kept, expiry extended `graceDays`), or ON_HOLD without `graceDays`. */
  failRenewal(token: string, options?: { graceDays?: number }): Request
  /** CANCELED: renewal off, access to the period end. */
  cancel(token: string): Request
  /** EXPIRED. */
  expire(token: string): Request
  /**
   * A refund: the order is refunded (orderHistory.refundEvent) and Play sends a
   * voided-purchase notification; with `revoke` (default true) access ends
   * and a REVOKED notification follows. Returns the notifications in order.
   */
  refund(token: string, options?: { revoke?: boolean }): Request[]
}

export function fakeGooglePlay(
  options: { packageName?: string; now?: () => number; url?: string } = {},
): FakeGooglePlay {
  const packageName = options.packageName ?? "com.example.app"
  const now = options.now ?? Date.now
  const audience = options.url ?? "https://app.example.test/webhooks/googleplay"
  const pushEmail = "push@signet-test.iam.gserviceaccount.test"
  const sa = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const google = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const api = `/androidpublisher/v3/applications/${packageName}`
  const f = fakeFetch({
    "POST /token": { access_token: "ya29.signet-test", expires_in: 3600 },
    "GET /oauth2/v3/certs": {
      keys: [
        {
          ...google.publicKey.export({ format: "jwk" }),
          kid: "signet-test",
          alg: "RS256",
          use: "sig",
        },
      ],
    },
  })
  const subs = new Map<string, { sub: any; periodMs: number; price: any; orders: string[] }>()
  let n = 0
  let messages = 0

  const oidc = () => {
    const t = Math.floor(now() / 1000)
    const input = `${b64u(JSON.stringify({ alg: "RS256", kid: "signet-test", typ: "JWT" }))}.${b64u(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: audience,
        email: pushEmail,
        email_verified: true,
        iat: t,
        exp: t + 3600,
      }),
    )}`
    return `${input}.${b64u(sign("sha256", Buffer.from(input), google.privateKey))}`
  }
  const push = (data: Record<string, unknown>) =>
    new Request(audience, {
      method: "POST",
      headers: { authorization: `Bearer ${oidc()}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          data: b64u(
            JSON.stringify({
              version: "1.0",
              packageName,
              eventTimeMillis: String(now()),
              ...data,
            }),
          ),
          messageId: String(9000 + ++messages),
        },
        subscription: "projects/signet-test/subscriptions/play",
      }),
    })
  const notification = (notificationType: number, token: string) =>
    push({ subscriptionNotification: { version: "1.0", notificationType, purchaseToken: token } })

  const get = (token: string) => {
    const s = subs.get(token)
    if (!s) throw new Error(`signet-test: no Play subscription ${token}`)
    return s
  }
  const sync = (token: string) => {
    f.routes[`GET ${api}/purchases/subscriptionsv2/tokens/${token}`] = structuredClone(
      get(token).sub,
    )
  }
  const addOrder = (token: string) => {
    const s = get(token)
    const orderId = `GPA.0000-0000-0000-${String(++n).padStart(5, "0")}${s.orders.length ? `..${s.orders.length - 1}` : ""}`
    s.orders.push(orderId)
    f.routes[`GET ${api}/orders/${orderId}`] = {
      orderId,
      purchaseToken: token,
      state: "PROCESSED",
      total: s.price,
      lineItems: [{ productId: s.sub.lineItems[0].productId }],
      createTime: new Date(now()).toISOString(),
    }
    s.sub.lineItems[0].latestSuccessfulOrderId = orderId
    return orderId
  }
  const item = (token: string) => get(token).sub.lineItems[0]
  const setState = (token: string, state: PlayState) => {
    get(token).sub.subscriptionState = state
  }

  return {
    config: {
      packageName,
      serviceAccount: {
        client_email: "api@signet-test.iam.gserviceaccount.test",
        private_key: pem(sa.privateKey),
      },
      pubsub: { audience, serviceAccountEmail: pushEmail },
      fetch: f.fetch,
      retryDelayMs: 0,
    },
    calls: f.calls,
    subscribe(token, o = {}) {
      const periodMs = (o.periodDays ?? 30) * DAY_MS
      subs.set(token, {
        periodMs,
        price: { currencyCode: "USD", units: "4", nanos: 990000000, ...o.price },
        orders: [],
        sub: {
          kind: "androidpublisher#subscriptionPurchaseV2",
          subscriptionState: o.state ?? "SUBSCRIPTION_STATE_ACTIVE",
          startTime: new Date(now()).toISOString(),
          testPurchase: {},
          ...(o.accountId
            ? { externalAccountIdentifiers: { obfuscatedExternalAccountId: o.accountId } }
            : {}),
          lineItems: [
            {
              productId: o.productId ?? "pro.monthly",
              expiryTime: new Date(now() + periodMs).toISOString(),
              autoRenewingPlan: { autoRenewEnabled: true },
            },
          ],
        },
      })
      const orderId = addOrder(token)
      sync(token)
      return orderId
    },
    notification,
    renew(token) {
      const s = get(token)
      const from = Math.max(Date.parse(item(token).expiryTime), now())
      item(token).expiryTime = new Date(from + s.periodMs).toISOString()
      setState(token, "SUBSCRIPTION_STATE_ACTIVE")
      addOrder(token)
      sync(token)
      return notification(2, token)
    },
    failRenewal(token, o = {}) {
      if (o.graceDays) {
        setState(token, "SUBSCRIPTION_STATE_IN_GRACE_PERIOD")
        item(token).expiryTime = new Date(
          Date.parse(item(token).expiryTime) + o.graceDays * DAY_MS,
        ).toISOString()
      } else setState(token, "SUBSCRIPTION_STATE_ON_HOLD")
      sync(token)
      return notification(o.graceDays ? 6 : 5, token)
    },
    cancel(token) {
      setState(token, "SUBSCRIPTION_STATE_CANCELED")
      item(token).autoRenewingPlan = { autoRenewEnabled: false }
      sync(token)
      return notification(3, token)
    },
    expire(token) {
      setState(token, "SUBSCRIPTION_STATE_EXPIRED")
      sync(token)
      return notification(13, token)
    },
    refund(token, o = {}) {
      const s = get(token)
      const orderId = s.orders[s.orders.length - 1] as string
      const order = f.routes[`GET ${api}/orders/${orderId}`] as any
      order.state = "REFUNDED"
      order.orderHistory = {
        refundEvent: {
          eventTime: new Date(now()).toISOString(),
          refundDetails: { total: s.price },
        },
      }
      const out = [
        push({
          voidedPurchaseNotification: {
            purchaseToken: token,
            orderId,
            productType: 1,
            refundType: 1,
          },
        }),
      ]
      if (o.revoke !== false) {
        setState(token, "SUBSCRIPTION_STATE_EXPIRED")
        item(token).expiryTime = new Date(now()).toISOString()
        sync(token)
        out.push(notification(12, token))
      }
      return out
    },
  }
}
