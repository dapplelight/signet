/**
 * Google Play over the Play Developer API (androidpublisher v3) and Real-time
 * Developer Notifications. Purchases happen on the device; this adapter
 * answers what a customer bought and whether they are subscribed.
 * API reference (the discovery document is the spec):
 * https://developers.google.com/android-publisher/api-ref/rest
 *
 * Auth: a service account. A JWT (RS256; `iss` client_email, `scope`
 * androidpublisher, `aud` the token URI, `iat`, `exp` one hour) is exchanged
 * for an access token (grant_type jwt-bearer), cached until it expires.
 * https://developers.google.com/identity/protocols/oauth2/service-account#httprest
 *
 * Ids: a payment is an order (`GPA....`, orders.get); a subscription is its
 * purchase token (purchases.subscriptionsv2.get). `Payment.orderId` is the
 * purchase token, so renewal orders link to the first one. One-time purchases
 * arrive as tokens: `getProductPurchase(token)` reads the order behind one.
 *
 * Notifications come as Pub/Sub push requests. The adapter checks the push
 * request's OIDC token (RS256 against Google's JWKS, `iss` accounts.google.com,
 * `aud` and `email` as configured, `email_verified`, `exp`), decodes the
 * DeveloperNotification, then reads the authoritative state from the API: a
 * notification only says that something changed.
 * https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions
 * https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken
 * https://developer.android.com/google/play/billing/rtdn-reference
 *
 * Refunds use orders.refund (full only; `revoke` ends access, default on).
 * Cancelling stops renewal at the period end (subscriptionsv2.cancel); ending a
 * subscription now is a refund with revoke.
 *
 * Unsupported: checkout (purchases happen in Play Billing), partial refunds
 * (use `raw` with subscriptionsv2 revoke and a prorated refund), customers,
 * saved methods, payouts, settlements, capture.
 */

import { PaymentsError } from "../errors.js"
import {
  badSignature,
  defineGateway,
  type Json,
  jsonRaw,
  request,
  toMinor,
  unsupported,
} from "../http.js"
import { b64Decode, decodeJws, pemToDer, signJwt, verifyJws } from "../jose.js"
import type {
  Event,
  EventType,
  HttpOptions,
  Payment,
  PaymentGateway,
  PaymentStatus,
  Subscription,
  SubscriptionStatus,
} from "../types.js"

const G = "googleplay"
const SCOPE = "https://www.googleapis.com/auth/androidpublisher"
const JWKS = "https://www.googleapis.com/oauth2/v3/certs"

export type GooglePlayConfig = HttpOptions & {
  packageName: string
  /** Fields from the service account's JSON key. */
  serviceAccount: { client_email: string; private_key: string; token_uri?: string }
  /** The push subscription's authentication settings. Required for verifyWebhook. */
  pubsub?: {
    /** The audience set on the push subscription (default there: the endpoint URL). */
    audience: string
    /** The service account the push subscription authenticates as. */
    serviceAccountEmail: string
  }
  /** orders.refund `revoke`: end access when refunding. Default true. */
  revokeOnRefund?: boolean
  now?: () => number
}

export type GooglePlayGateway = PaymentGateway & {
  /** The order behind a one-time purchase token (productsv2, then orders.get). */
  getProductPurchase(token: string): Promise<Payment>
  /** Acknowledge a one-time purchase. Unacknowledged purchases are refunded after three days. */
  acknowledgeProduct(productId: string, token: string): Promise<void>
  /** Consume a consumable one-time purchase so it can be bought again. */
  consumeProduct(productId: string, token: string): Promise<void>
  acknowledgeSubscription(productId: string, token: string): Promise<void>
  /** Purchases that were cancelled, refunded or charged back. */
  listVoided(query?: Record<string, string | number | undefined>): Promise<{
    voided: Json[]
    nextPageToken?: string
  }>
}

// Money { currencyCode, units, nanos } -> minor units, by string.
const money = (m: Json): { amount: number; currency: string } | undefined => {
  if (!m?.currencyCode) return undefined
  const units = String(m.units ?? "0")
  const nanos = Math.abs(Number(m.nanos ?? 0))
  const neg = units.startsWith("-") || Number(m.nanos) < 0
  const v = `${neg ? "-" : ""}${units.replace("-", "")}.${String(nanos).padStart(9, "0")}`
  return {
    amount: toMinor(v.replace(/0+$/, "").replace(/\.$/, ""), m.currencyCode),
    currency: m.currencyCode,
  }
}

const ORDER: Record<string, PaymentStatus> = {
  PENDING: "pending",
  PROCESSED: "captured",
  PENDING_REFUND: "captured",
  CANCELED: "cancelled",
  PARTIALLY_REFUNDED: "partially_refunded",
  REFUNDED: "refunded",
}

export function toGooglePlayPayment(o: Json): Payment {
  const total = money(o.total) ?? { amount: 0, currency: "" }
  const h = o.orderHistory ?? {}
  const refunded = h.refundEvent
    ? (money(h.refundEvent.refundDetails?.total)?.amount ?? total.amount)
    : (h.partialRefundEvents ?? []).reduce(
        (s: number, e: Json) =>
          s +
          (e.state === "PROCESSED_SUCCESSFULLY" ? (money(e.refundDetails?.total)?.amount ?? 0) : 0),
        0,
      )
  return {
    gateway: G,
    gatewayId: String(o.orderId),
    ...total,
    status: ORDER[o.state] ?? "pending",
    ...(refunded ? { amountRefunded: refunded } : {}),
    ...(o.purchaseToken ? { orderId: String(o.purchaseToken) } : {}),
    ...(o.lineItems?.[0]?.productId ? { productId: o.lineItems[0].productId } : {}),
    createdAt: o.createTime ? new Date(o.createTime) : new Date(0),
    raw: o,
  }
}

const SUB: Record<string, SubscriptionStatus> = {
  SUBSCRIPTION_STATE_PENDING: "pending",
  SUBSCRIPTION_STATE_ACTIVE: "active",
  SUBSCRIPTION_STATE_PAUSED: "paused",
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "past_due",
  SUBSCRIPTION_STATE_ON_HOLD: "past_due",
  SUBSCRIPTION_STATE_CANCELED: "cancelled",
  SUBSCRIPTION_STATE_EXPIRED: "expired",
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: "cancelled",
}

export function toGooglePlaySubscription(token: string, s: Json): Subscription {
  const items: Json[] = s.lineItems ?? []
  const ends = items.map((i) => Date.parse(i.expiryTime)).filter((n) => !Number.isNaN(n))
  const status = SUB[s.subscriptionState] ?? "pending"
  const auto = items[0]?.autoRenewingPlan
  const account = s.externalAccountIdentifiers?.obfuscatedExternalAccountId
  return {
    gateway: G,
    gatewayId: token,
    status: status === "active" && items[0]?.offerPhase?.freeTrial ? "trialing" : status,
    ...(account ? { customerId: account } : {}),
    ...(ends.length ? { currentPeriodEnd: new Date(Math.max(...ends)) } : {}),
    ...(items[0]?.productId ? { productId: items[0].productId } : {}),
    ...(auto ? { autoRenew: !!auto.autoRenewEnabled } : {}),
    inGracePeriod: s.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
    environment: s.testPurchase ? "sandbox" : "production",
    createdAt: s.startTime ? new Date(s.startTime) : new Date(0),
    raw: s,
  }
}

// SubscriptionNotification.notificationType -> canonical event.
const SUB_EVENT: Record<number, EventType> = {
  1: "subscription.charged", // RECOVERED (from account hold, or resumed from pause)
  2: "subscription.charged", // RENEWED
  3: "subscription.cancelled", // CANCELED
  4: "subscription.created", // PURCHASED
  5: "subscription.past_due", // ON_HOLD
  6: "subscription.past_due", // IN_GRACE_PERIOD
  7: "subscription.resumed", // RESTARTED
  9: "subscription.updated", // DEFERRED
  10: "subscription.paused", // PAUSED
  11: "subscription.updated", // PAUSE_SCHEDULE_CHANGED
  12: "subscription.expired", // REVOKED
  13: "subscription.expired", // EXPIRED
  17: "subscription.updated", // ITEMS_CHANGED
  18: "subscription.updated", // CANCELLATION_SCHEDULED
  19: "subscription.updated", // PRICE_CHANGE_UPDATED
  20: "subscription.cancelled", // PENDING_PURCHASE_CANCELED
  22: "subscription.updated", // PRICE_STEP_UP_CONSENT_UPDATED
}

export function googleplay(config: GooglePlayConfig): GooglePlayGateway {
  const now = config.now ?? Date.now
  const http = config
  const base = () =>
    `${config.baseUrl ?? "https://androidpublisher.googleapis.com"}/androidpublisher/v3/applications/${encodeURIComponent(config.packageName)}`

  let cached: { token: string; until: number } | undefined
  let signKey: Promise<CryptoKey> | undefined
  async function accessToken(): Promise<string> {
    if (cached && cached.until > now()) return cached.token
    signKey ??= crypto.subtle.importKey(
      "pkcs8",
      pemToDer(config.serviceAccount.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const aud = config.serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token"
    const iat = Math.floor(now() / 1000)
    const assertion = await signJwt(
      { alg: "RS256", typ: "JWT" },
      { iss: config.serviceAccount.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 },
      await signKey,
    )
    const r: Json = await request(
      {
        gateway: G,
        method: "POST",
        url: aud,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
        retryable: true,
      },
      http,
    )
    cached = { token: r.access_token, until: now() + (Number(r.expires_in ?? 3600) - 60) * 1000 }
    return cached.token
  }

  const raw = jsonRaw(
    G,
    base,
    async () => ({ authorization: `Bearer ${await accessToken()}` }),
    http,
  )
  const id = encodeURIComponent
  const order = async (orderId: string) =>
    toGooglePlayPayment(await raw("GET", `/orders/${id(orderId)}`))
  const subscription = async (token: string) =>
    toGooglePlaySubscription(
      token,
      await raw("GET", `/purchases/subscriptionsv2/tokens/${id(token)}`),
    )
  async function productPurchase(token: string): Promise<Payment> {
    const p: Json = await raw("GET", `/purchases/productsv2/tokens/${id(token)}`)
    if (!p.orderId)
      throw new PaymentsError(
        "NOT_FOUND",
        "googleplay: this purchase has no order yet (pending).",
        {
          gateway: G,
        },
      )
    const o = await order(p.orderId)
    return {
      ...o,
      orderId: token,
      ...(p.testPurchaseContext
        ? { environment: "sandbox" as const }
        : { environment: "production" as const }),
      ...(p.obfuscatedExternalAccountId ? { customerId: p.obfuscatedExternalAccountId } : {}),
    }
  }

  // Google's signing keys, by kid; refetched when a token names one we do not have.
  let jwks = new Map<string, CryptoKey>()
  async function googleKey(kid: string): Promise<CryptoKey | undefined> {
    if (!jwks.has(kid)) {
      const r: Json = await request({ gateway: G, method: "GET", url: JWKS, retryable: true }, http)
      const next = new Map<string, CryptoKey>()
      for (const k of r.keys ?? [])
        if (k.kty === "RSA")
          next.set(
            k.kid,
            await crypto.subtle.importKey(
              "jwk",
              { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true },
              { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
              false,
              ["verify"],
            ),
          )
      jwks = next
    }
    return jwks.get(kid)
  }

  async function checkPush(req: Request): Promise<void> {
    const ps = config.pubsub
    if (!ps) throw badSignature(G, "no pubsub audience and service account configured")
    const auth = req.headers.get("authorization") ?? ""
    if (!auth.startsWith("Bearer ")) throw badSignature(G, "no bearer token on the push request")
    const jws = decodeJws(auth.slice(7))
    if (jws.header.alg !== "RS256") throw badSignature(G, "token alg must be RS256")
    const k = await googleKey(String(jws.header.kid))
    if (!k || !(await verifyJws(jws, k))) throw badSignature(G, "token signature does not match")
    const c = jws.payload
    const t = now() / 1000
    if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com")
      throw badSignature(G, "token issuer is not Google")
    if (c.aud !== ps.audience) throw badSignature(G, "token audience does not match")
    if (
      c.email !== ps.serviceAccountEmail ||
      (c.email_verified !== true && c.email_verified !== "true")
    )
      throw badSignature(G, "token email does not match the push service account")
    if (typeof c.exp !== "number" || c.exp < t) throw badSignature(G, "token has expired")
  }

  const gw = defineGateway(
    G,
    { methods: [], features: ["refunds", "subscriptions", "webhooks"] },
    {
      raw,
      // GET /orders/{orderId} -> Order
      // https://developers.google.com/android-publisher/api-ref/rest/v3/orders/get
      getPayment: order,
      // orders.get for the amount, then POST /orders/{orderId}:refund?revoke=... (empty body
      // and response). Sent once: the API takes no idempotency key.
      // https://developers.google.com/android-publisher/api-ref/rest/v3/orders/refund
      async refund(orderId) {
        const o = await order(orderId)
        await raw("POST", `/orders/${id(orderId)}:refund`, undefined, {
          query: { revoke: String(config.revokeOnRefund ?? true) },
        })
        return {
          gateway: G,
          gatewayId: `${orderId}:refund`,
          paymentId: orderId,
          amount: o.amount - (o.amountRefunded ?? 0),
          currency: o.currency,
          status: "pending",
          createdAt: new Date(now()),
          raw: o.raw,
        }
      },
      // https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get
      getSubscription: subscription,
      // POST subscriptionsv2/tokens/{token}:cancel, USER_REQUESTED_STOP_RENEWALS: renewal stops,
      // access runs to the period end, and the customer can restore it.
      // https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/cancel
      async cancelSubscription(token, o) {
        if (!o?.atPeriodEnd)
          throw unsupported(
            G,
            "cancelling now (Google Play stops renewal at the period end: pass atPeriodEnd; refund() with revoke ends access now)",
          )
        await raw("POST", `/purchases/subscriptionsv2/tokens/${id(token)}:cancel`, {
          cancellationContext: { cancellationType: "USER_REQUESTED_STOP_RENEWALS" },
        })
        return subscription(token)
      },
      async verifyWebhook(req) {
        await checkPush(req)
        let push: Json
        let n: Json
        try {
          push = JSON.parse(await req.text())
          n = JSON.parse(new TextDecoder().decode(b64Decode(push.message.data)))
        } catch {
          throw badSignature(G, "body is not a Pub/Sub push message with base64 JSON data")
        }
        if (n.packageName !== config.packageName)
          throw badSignature(G, `notification for ${n.packageName}, not ${config.packageName}`)
        const e: Event = {
          id: String(push.message.messageId ?? push.message.message_id),
          gateway: G,
          type: "unknown",
          gatewayType: "test",
          occurredAt: new Date(Number(n.eventTimeMillis) || now()),
          raw: n,
        }
        const sn = n.subscriptionNotification
        const on = n.oneTimeProductNotification
        const vn = n.voidedPurchaseNotification
        if (sn) {
          const s = await subscription(sn.purchaseToken)
          e.type = SUB_EVENT[sn.notificationType] ?? "unknown"
          e.gatewayType = `subscription.${sn.notificationType}`
          e.subscriptionId = sn.purchaseToken
          e.orderId = sn.purchaseToken
          e.productId = s.productId
          e.environment = s.environment
          const latest = (s.raw as Json).lineItems?.[0]?.latestSuccessfulOrderId
          if ((e.type === "subscription.created" || e.type === "subscription.charged") && latest) {
            const o = await order(latest)
            Object.assign(e, { paymentId: o.gatewayId, amount: o.amount, currency: o.currency })
          }
          e.raw = { notification: n, subscription: s.raw }
        } else if (on) {
          e.gatewayType = `oneTimeProduct.${on.notificationType}`
          e.orderId = on.purchaseToken
          e.productId = on.sku
          if (on.notificationType === 1) {
            const p = await productPurchase(on.purchaseToken)
            Object.assign(e, {
              type: "payment.captured",
              paymentId: p.gatewayId,
              amount: p.amount,
              currency: p.currency,
              environment: p.environment,
              raw: { notification: n, order: p.raw },
            })
          } else if (on.notificationType === 2) e.type = "payment.failed"
        } else if (vn) {
          // A refund or chargeback: the order's history says how much.
          const o = await order(vn.orderId)
          const h = (o.raw as Json).orderHistory ?? {}
          const partial = (h.partialRefundEvents ?? []).at(-1)
          const amount = h.refundEvent
            ? (money(h.refundEvent.refundDetails?.total)?.amount ?? o.amount)
            : partial
              ? money(partial.refundDetails?.total)?.amount
              : o.amount
          Object.assign(e, {
            type: "refund.processed",
            gatewayType: `voided.${vn.refundType ?? ""}`,
            paymentId: o.gatewayId,
            orderId: vn.purchaseToken,
            refundId:
              h.refundEvent || !partial
                ? `${o.gatewayId}:refund`
                : `${o.gatewayId}:refund:${partial.createTime}`,
            amount,
            currency: o.currency,
            raw: { notification: n, order: o.raw },
          })
        }
        return e
      },
    },
  )

  const post = async (path: string) => {
    await raw("POST", path, {})
  }
  return Object.assign(gw, {
    getProductPurchase: productPurchase,
    // https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products
    acknowledgeProduct: (productId: string, token: string) =>
      post(`/purchases/products/${id(productId)}/tokens/${id(token)}:acknowledge`),
    consumeProduct: (productId: string, token: string) =>
      post(`/purchases/products/${id(productId)}/tokens/${id(token)}:consume`),
    // https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge
    acknowledgeSubscription: (productId: string, token: string) =>
      post(`/purchases/subscriptions/${id(productId)}/tokens/${id(token)}:acknowledge`),
    // https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases/list
    async listVoided(query?: Record<string, string | number | undefined>) {
      const r: Json = await raw("GET", "/purchases/voidedpurchases", undefined, { query })
      return {
        voided: r.voidedPurchases ?? [],
        ...(r.tokenPagination?.nextPageToken
          ? { nextPageToken: r.tokenPagination.nextPageToken }
          : {}),
      }
    },
  })
}
