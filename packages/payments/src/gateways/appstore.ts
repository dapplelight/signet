/**
 * Apple App Store over the App Store Server API and App Store Server
 * Notifications V2. Purchases happen on the device; this adapter answers what
 * a customer bought and whether they are subscribed, from your backend.
 *
 * Auth: a JWT per request, ES256 with your In-App Purchase key (`kid` = key
 * id; claims `iss` issuer id, `iat`, `exp` at most 60 min later, `aud`
 * "appstoreconnect-v1", `bid` bundle id), sent as a bearer token.
 * https://developer.apple.com/documentation/appstoreserverapi/generating-json-web-tokens-for-api-requests
 * Hosts: api.storekit.apple.com, sandbox api.storekit-sandbox.apple.com.
 * https://developer.apple.com/documentation/appstoreserverapi/environment
 *
 * Ids: a payment is a transaction (`transactionId`); a subscription is its
 * `originalTransactionId`. `Payment.orderId` is the original transaction id,
 * so renewals link to the first purchase. Amounts come from `price`
 * (milliunits) and `currency`; Apple says not to use them for revenue
 * recognition, App Store Connect reports are the record.
 * https://developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload
 *
 * Every signed payload (API responses and notifications) is verified: the x5c
 * chain up to Apple Root CA - G3 (pinned by SHA-256 fingerprint, from
 * https://www.apple.com/certificateauthority/AppleRootCA-G3.cer), the leaf's
 * receipt-signing extension, the intermediate's WWDR extension, every
 * signature and validity window (at the payload's `signedDate`, as Apple's App
 * Store Server Library does offline), then the ES256 JWS signature. Revocation
 * (OCSP) is not checked.
 * https://developer.apple.com/documentation/appstoreserverapi/jwsdecodedheader
 *
 * Unsupported: checkout (purchases happen in StoreKit), refunds (customers ask
 * Apple), cancelling (customers cancel in their account settings), customers,
 * saved methods, payouts, settlements.
 */

import { PaymentsError } from "../errors.js"
import { badSignature, defineGateway, type Json, minorDigits, request, withQuery } from "../http.js"
import { decodeJws, pemToDer, signJwt, verifyChain, verifyJws } from "../jose.js"
import type {
  Environment,
  Event,
  EventType,
  HttpOptions,
  Payment,
  PaymentGateway,
  Subscription,
  SubscriptionStatus,
} from "../types.js"

const G = "appstore"

/** SHA-256 of Apple Root CA - G3, https://www.apple.com/certificateauthority/AppleRootCA-G3.cer */
export const APPLE_ROOT_CA_G3_SHA256 =
  "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179"
/** Mac App Store receipt signing (leaf) and Apple WWDR (intermediate) extension ids. */
const LEAF_OID = "1.2.840.113635.100.6.11.1"
const WWDR_OID = "1.2.840.113635.100.6.2.1"

export type AppStoreConfig = HttpOptions & {
  /** Issuer id from App Store Connect, Users and Access, Keys. */
  issuerId: string
  keyId: string
  /** The In-App Purchase key (.p8 contents, PKCS#8 PEM). */
  privateKey: string
  bundleId: string
  /** Your app's Apple id. When set, production notifications must carry it. */
  appAppleId?: number
  /** SHA-256 fingerprints of trusted roots. Default: Apple Root CA - G3. */
  trustedRoots?: readonly string[]
  now?: () => number
}

export type AppStoreGateway = PaymentGateway & {
  /** Verify a signed transaction (a StoreKit `jwsRepresentation`, say) and normalise it. */
  decodeTransaction(jws: string): Promise<Payment>
  /** Get Transaction History v2: every transaction for the customer, a page at a time. */
  transactionHistory(
    anyTransactionId: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<{ payments: Payment[]; revision?: string; hasMore: boolean }>
  /** Get Refund History: refunded transactions, a page at a time. */
  refundHistory(
    anyTransactionId: string,
    revision?: string,
  ): Promise<{ payments: Payment[]; revision?: string; hasMore: boolean }>
}

const STATUS: Record<number, SubscriptionStatus> = {
  1: "active",
  2: "expired",
  3: "past_due", // billing retry
  4: "past_due", // billing grace period
  5: "expired", // refunded or revoked from Family Sharing
}

const env = (e: unknown): Environment | undefined =>
  e === "Production" ? "production" : e === "Sandbox" || e === "Xcode" ? "sandbox" : undefined

/** Milliunits (price x 1000) to minor units. */
const milli = (price: number, currency: string) =>
  Math.round((price * 10 ** minorDigits(currency)) / 1000)

const ms = (v: unknown) => (typeof v === "number" ? new Date(v) : undefined)

export function toAppStorePayment(t: Json): Payment {
  const currency = String(t.currency ?? "")
  const amount = typeof t.price === "number" && currency ? milli(t.price, currency) : 0
  const refunded =
    t.revocationDate &&
    t.revocationType !== "FAMILY_REVOKE" &&
    t.revocationType !== "ASSIGNMENT_REVOKE"
  const refundedAmount = !refunded
    ? undefined
    : typeof t.revocationPercentage === "number" && t.revocationType === "REFUND_PRORATED"
      ? Math.round((amount * t.revocationPercentage) / 100000)
      : amount
  return {
    gateway: G,
    gatewayId: String(t.transactionId),
    amount,
    currency,
    status: !refunded
      ? "captured"
      : refundedAmount !== undefined && refundedAmount < amount
        ? "partially_refunded"
        : "refunded",
    ...(refundedAmount !== undefined ? { amountRefunded: refundedAmount } : {}),
    ...(t.appAccountToken ? { customerId: String(t.appAccountToken) } : {}),
    orderId: String(t.originalTransactionId ?? t.transactionId),
    productId: t.productId,
    ...(env(t.environment) ? { environment: env(t.environment) } : {}),
    createdAt: ms(t.purchaseDate) ?? new Date(0),
    raw: t,
  }
}

function toSubscription(t: Json, r: Json | undefined, status: number | undefined): Subscription {
  const base = status !== undefined ? STATUS[status] : undefined
  const auto = r ? r.autoRenewStatus === 1 : undefined
  const s: SubscriptionStatus =
    base === "active" && auto === false
      ? "cancelled"
      : base === "active" && t.offerDiscountType === "FREE_TRIAL"
        ? "trialing"
        : (base ?? "pending")
  return {
    gateway: G,
    gatewayId: String(t.originalTransactionId),
    status: s,
    ...(t.appAccountToken ? { customerId: String(t.appAccountToken) } : {}),
    ...(ms(t.expiresDate) ? { currentPeriodEnd: ms(t.expiresDate) } : {}),
    productId: t.productId,
    ...(auto !== undefined ? { autoRenew: auto } : {}),
    inGracePeriod: status === 4,
    ...(env(t.environment) ? { environment: env(t.environment) } : {}),
    createdAt: ms(t.originalPurchaseDate) ?? ms(t.purchaseDate) ?? new Date(0),
    raw: { transaction: t, renewalInfo: r, status },
  }
}

// notificationType (+ subtype) -> canonical event.
// https://developer.apple.com/documentation/appstoreservernotifications/notificationtype
function eventType(type: string, subtype: string | undefined): EventType {
  switch (type) {
    case "SUBSCRIBED":
      return "subscription.created"
    case "DID_RENEW":
      return "subscription.charged"
    case "DID_FAIL_TO_RENEW":
    case "GRACE_PERIOD_EXPIRED":
      return "subscription.past_due"
    case "EXPIRED":
    case "REVOKE":
      return "subscription.expired"
    case "DID_CHANGE_RENEWAL_STATUS":
      return subtype === "AUTO_RENEW_DISABLED" ? "subscription.cancelled" : "subscription.resumed"
    case "DID_CHANGE_RENEWAL_PREF":
    case "OFFER_REDEEMED":
    case "PRICE_INCREASE":
    case "RENEWAL_EXTENDED":
      return "subscription.updated"
    case "ONE_TIME_CHARGE":
      return "payment.captured"
    case "REFUND":
      return "refund.processed"
    default:
      return "unknown"
  }
}

export function appstore(config: AppStoreConfig): AppStoreGateway {
  const now = config.now ?? Date.now
  const base = () =>
    config.baseUrl ??
    (config.sandbox ? "https://api.storekit-sandbox.apple.com" : "https://api.storekit.apple.com")
  let key: Promise<CryptoKey> | undefined
  const token = async () => {
    key ??= crypto.subtle.importKey(
      "pkcs8",
      pemToDer(config.privateKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    )
    const iat = Math.floor(now() / 1000)
    return signJwt(
      { alg: "ES256", kid: config.keyId, typ: "JWT" },
      {
        iss: config.issuerId,
        iat,
        exp: iat + 300,
        aud: "appstoreconnect-v1",
        bid: config.bundleId,
      },
      await key,
    )
  }

  const raw: PaymentGateway["raw"] = async (method, path, body, o = {}) => {
    const m = method.toUpperCase()
    return request(
      {
        gateway: G,
        method: m,
        url: withQuery(`${base()}${path}`, o.query),
        headers: {
          authorization: `Bearer ${await token()}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...o.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        retryable: m === "GET" || !!o.idempotencyKey,
      },
      config,
    )
  }

  /** Verify an Apple JWS (chain, then signature) and return its payload. */
  async function verified(jws: string): Promise<Json> {
    const d = decodeJws(jws)
    if (d.header.alg !== "ES256") throw badSignature(G, "JWS alg must be ES256")
    const leaf = await verifyChain(d.header.x5c, {
      roots: config.trustedRoots ?? [APPLE_ROOT_CA_G3_SHA256],
      leafOid: LEAF_OID,
      intermediateOid: WWDR_OID,
      at: typeof d.payload.signedDate === "number" ? d.payload.signedDate : now(),
      gateway: G,
    })
    const k = await crypto.subtle.importKey(
      "spki",
      leaf.spki,
      { name: "ECDSA", namedCurve: leaf.curve.name },
      false,
      ["verify"],
    )
    if (!(await verifyJws(d, k))) throw badSignature(G)
    const bundle = d.payload.bundleId ?? d.payload.data?.bundleId
    if (bundle !== undefined && bundle !== config.bundleId)
      throw badSignature(G, `signed for bundle ${bundle}, not ${config.bundleId}`)
    return d.payload
  }

  const transaction = async (jws: string) => toAppStorePayment(await verified(jws))
  const page = async (r: Json) => ({
    payments: await Promise.all((r.signedTransactions ?? []).map(transaction)),
    ...(r.revision ? { revision: String(r.revision) } : {}),
    hasMore: !!r.hasMore,
  })
  const id = encodeURIComponent

  const gw = defineGateway(
    G,
    { methods: [], features: ["subscriptions", "webhooks"] },
    {
      raw,
      // GET /inApps/v1/transactions/{transactionId} -> { signedTransactionInfo }
      // https://developer.apple.com/documentation/appstoreserverapi/get-transaction-info
      async getPayment(transactionId) {
        const r: Json = await raw("GET", `/inApps/v1/transactions/${id(transactionId)}`)
        return transaction(r.signedTransactionInfo)
      },
      // GET /inApps/v1/subscriptions/{anyTransactionId} -> data[].lastTransactions[]
      // https://developer.apple.com/documentation/appstoreserverapi/get-all-subscription-statuses
      async getSubscription(anyTransactionId) {
        const r: Json = await raw("GET", `/inApps/v1/subscriptions/${id(anyTransactionId)}`)
        const items = (r.data ?? []).flatMap((g: Json) => g.lastTransactions ?? [])
        const item =
          items.find((i: Json) => String(i.originalTransactionId) === anyTransactionId) ?? items[0]
        if (!item)
          throw new PaymentsError(
            "NOT_FOUND",
            `appstore: no subscription for ${anyTransactionId}`,
            {
              gateway: G,
            },
          )
        const t = await verified(item.signedTransactionInfo)
        const rn = item.signedRenewalInfo ? await verified(item.signedRenewalInfo) : undefined
        return toSubscription(t, rn, item.status)
      },
      // POST body { signedPayload }: responseBodyV2DecodedPayload with data.signedTransactionInfo
      // and, for subscriptions, data.signedRenewalInfo, each verified the same way.
      // https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2
      async verifyWebhook(req) {
        let body: Json
        try {
          body = JSON.parse(await req.text())
        } catch {
          throw badSignature(G, "body is not JSON")
        }
        const p = await verified(body?.signedPayload)
        const data = p.data ?? {}
        if (
          config.appAppleId !== undefined &&
          data.environment === "Production" &&
          data.appAppleId !== config.appAppleId
        )
          throw badSignature(G, `signed for app ${data.appAppleId}, not ${config.appAppleId}`)
        const t = data.signedTransactionInfo
          ? await verified(data.signedTransactionInfo)
          : undefined
        const rn = data.signedRenewalInfo ? await verified(data.signedRenewalInfo) : undefined
        const type = eventType(String(p.notificationType), p.subtype)
        const pay = t ? toAppStorePayment(t) : undefined
        const isSub = t?.type === "Auto-Renewable Subscription"
        const refund = type === "refund.processed" && pay
        const e: Event = {
          id: String(p.notificationUUID),
          gateway: G,
          type,
          gatewayType: p.subtype
            ? `${p.notificationType}.${p.subtype}`
            : String(p.notificationType),
          occurredAt: ms(p.signedDate) ?? new Date(now()),
          ...(pay ? { paymentId: pay.gatewayId, orderId: pay.orderId } : {}),
          ...(isSub ? { subscriptionId: String(t.originalTransactionId) } : {}),
          ...(refund ? { refundId: `${pay.gatewayId}:refund`, amount: pay.amountRefunded } : {}),
          ...(pay && !refund ? { amount: pay.amount } : {}),
          ...(pay ? { currency: pay.currency, productId: pay.productId } : {}),
          ...(env(data.environment) ? { environment: env(data.environment) } : {}),
          raw: { payload: p, transaction: t, renewalInfo: rn },
        }
        return e
      },
    },
  )

  return Object.assign(gw, {
    decodeTransaction: transaction,
    // GET /inApps/v2/history/{anyTransactionId}?revision=...
    // https://developer.apple.com/documentation/appstoreserverapi/get-transaction-history
    transactionHistory: async (
      anyTransactionId: string,
      query?: Record<string, string | number | undefined>,
    ) => page(await raw("GET", `/inApps/v2/history/${id(anyTransactionId)}`, undefined, { query })),
    // GET /inApps/v2/refund/lookup/{anyTransactionId}?revision=...
    // https://developer.apple.com/documentation/appstoreserverapi/get-refund-history
    refundHistory: async (anyTransactionId: string, revision?: string) =>
      page(
        await raw("GET", `/inApps/v2/refund/lookup/${id(anyTransactionId)}`, undefined, {
          query: { revision },
        }),
      ),
  })
}
