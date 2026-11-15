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

export type AppStoreTransaction = Record<string, unknown> & {
  transactionId: string
  originalTransactionId: string
  productId: string
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
  /** A signed notification POST, as Apple sends to your endpoint. */
  notification(type: string, subtype: string | undefined, transaction: AppStoreTransaction): Request
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
  let n = 0

  const signJws = (payload: unknown) => {
    const input = `${b64u(JSON.stringify({ alg: "ES256", x5c }))}.${b64u(JSON.stringify(payload))}`
    const sig = sign("sha256", Buffer.from(input), {
      key: leaf.privateKey,
      dsaEncoding: "ieee-p1363",
    })
    return `${input}.${b64u(sig)}`
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
    transaction(o = {}) {
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
        expiresDate: t + 30 * 864e5,
        price: 4990,
        currency: "USD",
        environment: "Sandbox",
        signedDate: t,
        ...o,
      }
    },
    sign: signJws,
    serve(t) {
      f.routes[`GET /inApps/v1/transactions/${t.transactionId}`] = {
        signedTransactionInfo: signJws(t),
      }
    },
    notification(type, subtype, t) {
      return new Request(options.url ?? "https://app.example.test/webhooks/appstore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signedPayload: signJws({
            notificationType: type,
            ...(subtype ? { subtype } : {}),
            notificationUUID: crypto.randomUUID(),
            version: "2.0",
            signedDate: now(),
            data: { bundleId, environment: "Sandbox", signedTransactionInfo: signJws(t) },
          }),
        }),
      })
    },
  }
}

// ---------------------------------------------------------------- Google Play

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
   * Record an active subscription (subscriptionsv2) and its latest order for
   * `token`. Returns the order id.
   */
  subscribe(
    token: string,
    options?: {
      productId?: string
      state?: string
      price?: { units: string; nanos?: number; currencyCode?: string }
    },
  ): string
  /** A signed Pub/Sub push for a SubscriptionNotification (4 = PURCHASED, 2 = RENEWED, 3 = CANCELED...). */
  notification(notificationType: number, token: string): Request
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
      const orderId = `GPA.0000-0000-0000-${String(++n).padStart(5, "0")}`
      const productId = o.productId ?? "pro.monthly"
      const start = new Date(now())
      f.routes[`GET ${api}/purchases/subscriptionsv2/tokens/${token}`] = {
        subscriptionState: o.state ?? "SUBSCRIPTION_STATE_ACTIVE",
        startTime: start.toISOString(),
        testPurchase: {},
        lineItems: [
          {
            productId,
            expiryTime: new Date(now() + 30 * 864e5).toISOString(),
            latestSuccessfulOrderId: orderId,
            autoRenewingPlan: { autoRenewEnabled: true },
          },
        ],
      }
      f.routes[`GET ${api}/orders/${orderId}`] = {
        orderId,
        purchaseToken: token,
        state: "PROCESSED",
        total: { currencyCode: "USD", units: "4", nanos: 990000000, ...o.price },
        lineItems: [{ productId }],
        createTime: start.toISOString(),
      }
      return orderId
    },
    notification(notificationType, token) {
      const data = {
        version: "1.0",
        packageName,
        eventTimeMillis: String(now()),
        subscriptionNotification: { version: "1.0", notificationType, purchaseToken: token },
      }
      return new Request(audience, {
        method: "POST",
        headers: { authorization: `Bearer ${oidc()}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: { data: b64u(JSON.stringify(data)), messageId: String(9000 + ++messages) },
          subscription: "projects/signet-test/subscriptions/play",
        }),
      })
    },
  }
}
