# @dapplelight/signet-payments

One payment model over Razorpay, Stripe, Cashfree, PhonePe, PayU, Paddle,
Lemon Squeezy, PayPal, Hyperswitch and Dodo Payments, and over the App Store
and Google Play, plus the parts every app rebuilds around them: a webhook
inbox, a double-entry ledger and reconciliation. One answer to "what has this
user bought, and are they subscribed", in your own backend.

- **One model.** `Payment`, `Refund`, `Customer`, `PaymentMethod`,
  `Subscription`, `Payout`, `Settlement`, `Event`. Amounts are integer
  minor units plus an ISO currency, never floats; every object keeps the
  gateway's payload in `raw`.
- **No SDKs, no runtime dependencies.** Plain `fetch` and Web Crypto, so it
  runs on Workers, Bun, Node and Deno.
- **Honest capabilities.** A call an adapter does not support rejects with
  `UNSUPPORTED` before any network call. Anything the gateways' docs did not
  pin down is unsupported rather than guessed.
- **Safe money calls.** Every charge, capture, refund and payout takes an
  idempotency key, passed on to gateways that accept one.

| Import | What |
|---|---|
| `@dapplelight/signet-payments` | Types, `createPayments`, stores, ledger, `reconcile`, errors, `applePayDomainAssociation` |
| `@dapplelight/signet-payments/razorpay` ... `/dodo` | One adapter per subpath |
| `@dapplelight/signet-payments/appstore`, `/googleplay` | App store billing: purchases made on the device, verified and tracked on the server |
| `@dapplelight/signet-payments/agent` | `paymentTools`: MCP tools for agents |

## Capability matrix

| | razorpay | stripe | cashfree | phonepe | payu | paddle | lemonsqueezy | paypal | hyperswitch | dodo | appstore | googleplay |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| upi | ✓ |  | ✓ | ✓ | ✓ |  |  |  | ✓ |  |  |  |
| card | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| netbanking | ✓ |  | ✓ | ✓ | ✓ |  |  |  | ✓ |  |  |  |
| wallet | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| emi | ✓ |  | ✓ |  |  |  |  |  |  |  |  |  |
| applepay | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| googlepay |  | ✓ |  |  |  | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| capture | ✓ | ✓ | ✓ |  | ✓ |  |  | ✓ | ✓ |  |  |  |
| refunds | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| partialRefunds | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| customers | ✓ | ✓ | ✓ |  |  | ✓ | ✓ |  | ✓ | ✓ |  |  |
| savedMethods | ✓ | ✓ | ✓ |  |  | ✓ |  | ✓ | ✓ | ✓ |  |  |
| subscriptions | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| payouts | ✓ | ✓ | ✓ |  |  |  |  | ✓ | ✓ |  |  |  |
| settlements | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |  |
| webhooks | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Razorpay payouts are RazorpayX and need `accountNumber`. Hyperswitch
subscriptions need `profileId`, and its methods depend on the connectors
enabled in your account. What each unsupported cell
is missing is at the top of that adapter's source file.

### Apple Pay and Google Pay

`applepay` and `googlepay` are the device wallets. Google Pay's UPI app in
India is `upi`, which is why Razorpay, Cashfree and PayU have no `googlepay`:
their Google Pay is UPI. Checkout with `method: "applepay"` (or
`"googlepay"`) routes only to gateways that take it, and where the gateway's
API takes a method list it limits the checkout:

| Gateway | What `method` sends |
|---|---|
| cashfree | `order_meta.payment_methods: "applepay"` |
| hyperswitch | `allowed_payment_method_types: ["apple_pay"]` (or `google_pay`) |
| dodo | `allowed_payment_method_types: ["apple_pay", "credit", "debit"]`: Dodo says to always keep cards as the fallback |
| the rest | nothing: the wallet shows in the gateway's own checkout or SDK once enabled |

Apple Pay on your own domain needs domain verification. Razorpay, PayPal and
Dodo give you a file to host; serve it with `applePayDomainAssociation(file)`
(at `APPLE_PAY_DOMAIN_ASSOCIATION_PATH`). Stripe has no file: register each
domain with `stripe.raw("POST", "/payment_method_domains", { domain_name })`.
Paddle verifies in its dashboard. Hosted checkout pages need none of this.
### App Store and Google Play

Purchases happen on the device (StoreKit, Play Billing), so `createCheckout`
is UNSUPPORTED for both. The server verifies and tracks them:

```ts
import { appstore } from "@dapplelight/signet-payments/appstore"
import { googleplay } from "@dapplelight/signet-payments/googleplay"

const payments = createPayments({
  gateways: [
    appstore({ issuerId, keyId, privateKey: p8, bundleId, appAppleId }),
    googleplay({
      packageName,
      serviceAccount: { client_email, private_key }, // from the service account JSON key
      pubsub: { audience: "https://api.example.com/webhooks/googleplay", serviceAccountEmail: pushSa },
    }),
  ],
  db,
})

// The app sends the transaction id (App Store) or order id (Google Play) after a purchase.
await payments.verifyPurchase({ gateway: "appstore", id: transactionId, userId })
await payments.gateway("appstore").getSubscription(originalTransactionId) // status, currentPeriodEnd, autoRenew
app.post("/webhooks/:gateway", (c) => payments.handleWebhook(c.req.param("gateway"), c.req.raw))
```

- `verifyPurchase` reads the purchase from the store and records it as the
  user's. It is refused when the purchase, or any payment of the subscription
  it belongs to, is already another user's. Renewals
  and refunds that arrive later link to it through `orderId` (the original
  transaction id, or the purchase token).
- Ids: App Store payments are transaction ids and subscriptions are original
  transaction ids. Google Play payments are order ids and subscriptions are
  purchase tokens.
- Subscription status: `past_due` covers billing retry and account hold;
  `inGracePeriod: true` means the customer still has access. `cancelled` with a
  future `currentPeriodEnd` means renewal is off and access runs until then.
- Events: a purchase or renewal is `subscription.created` / `subscription.charged`
  carrying the charge (`paymentId`, `amount`), which the inbox records as a
  capture; refunds are `refund.processed`. App Store amounts are marked
  `approximate` (see the gap notes).
- App Store extras: `decodeTransaction(jws)` verifies a StoreKit
  `jwsRepresentation`; `transactionHistory`, `refundHistory`. Google Play
  extras: `getProductPurchase(token)`, `acknowledgeProduct`,
  `acknowledgeSubscription` (unacknowledged purchases are refunded after three
  days), `consumeProduct`, `listVoided`.
- Google Play's notifications come through Pub/Sub push with authentication
  on. Each push's OIDC token is verified, and then the current state is read
  from the API. The service account needs the Orders API (financial data)
  permission, because amounts come from `orders.get`.

### Restore purchases

```ts
const { restored, refused } = await payments.restorePurchases({
  userId,
  purchases: [
    { gateway: "appstore", signedTransaction: jwsRepresentation },
    { gateway: "googleplay", purchaseToken, type: "subscription" }, // or "product"
  ],
})
for (const r of restored)
  if (r.subscription) await ent.applySubscription(r.subscription, { subject: userId }) // signet-db
```

Each purchase is verified (App Store: the JWS chain and signature), read live
from the store (Get Transaction Info and Get All Subscription Statuses;
subscriptionsv2 and orders.get, or productsv2) and claimed like
`verifyPurchase`: one that is already another user's is refused, in
`refused` with its index and code (`BAD_INPUT`), as is a forged JWS
(`BAD_SIGNATURE`) or a subscription with no paid order yet (`NOT_FOUND`). An
outage throws, so retry the call. signet-db turns the subscriptions into one
entitlement per plan across stores and web gateways; see its "App Store,
Google Play and restore" section.

### Notes on gaps

A feature is supported only where the official API spec or docs and an official
SDK (or two official doc pages) agree. What is left out, and why:

- **Store purchases to plans, left out:** one-time (non-subscription)
  store products do not map to plans (grant a feature with signet-db's
  `grant` instead); a Google Play voided purchase without a revoke does not
  change the entitlement (Google sends `SUBSCRIPTION_REVOKED` when access
  ends); App Store offer codes, family sharing as a separate seat, and
  restore by bare transaction id (only signed transactions are accepted).
- **App Store refunds and cancellation**: customers ask Apple for refunds and
  cancel in their account settings, so the API has no refund or cancel call
  for this package to make. Checked:
  https://developer.apple.com/documentation/appstoreservernotifications/notificationtype.
- **App Store amounts are approximate.** They are Apple's configured `price`,
  not settled revenue: tax handling and Apple's commission are not in them,
  and Apple says App Store Connect reports are the record. App Store payments
  carry `approximate: true`, and their ledger postings go in as kind
  `capture:approximate` / `refund:approximate`, so `balance` includes them while
  anything that reports revenue can split them out. There is no settlement
  report, so they are never reconciled. Checked:
  https://developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload.
- **App Store signature checks** verify the full x5c chain up to Apple Root
  CA - G3 (pinned by SHA-256 fingerprint): the leaf and intermediate extension
  ids, every signature, validity at the payload's `signedDate`, then the ES256
  signature. Revocation (OCSP) is not checked. Checked:
  https://developer.apple.com/documentation/appstoreserverapi/jwsdecodedheader,
  https://www.apple.com/certificateauthority/AppleRootCA-G3.cer.
- **App Store environments**: every signed payload must match the adapter's
  environment. A production adapter rejects Sandbox data unless
  `allowSandbox: true` (a staging server that takes both); a `sandbox: true`
  adapter rejects Production data. `Event.environment` says which one it was.
  With `appAppleId` set, production notifications for another app are rejected.
- **Google Play refunds** are full only (`orders.refund`, which revokes access
  by default; set `revokeOnRefund: false` to keep access). For a prorated
  subscription refund, call `raw("POST", "/purchases/subscriptionsv2/tokens/<token>:revoke", { revocationContext: { proratedRefund: {} } })`.
  Cancelling stops renewal at the period end only: `subscriptionsv2.cancel`
  has no immediate mode. Checked:
  https://developers.google.com/android-publisher/api-ref/rest/v3/orders/refund,
  https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/cancel.
- **Google Play pending-refund reviews** (`pendingRefundReviewNotification`)
  arrive as `unknown` events: answering them is `orders.reviewrefund` through `raw`.
- **Cashfree payouts** need either a whitelisted server IP or `payoutPublicKey`
  (the 2FA public key PEM), which adds `x-cf-signature` to each call.
- **Cashfree subscriptions** cancel immediately only (`atPeriodEnd` is refused)
  and report no created time or period end: `SubscriptionEntity` has neither.
  Checked: https://www.cashfree.com/docs/openapi/payments/v2026-01-01.yaml,
  https://www.cashfree.com/docs/payments/subscription/create.md.
- **PhonePe webhooks** use the `Authorization: sha256(username:password)`
  check (docs plus the Node, Python, Java and Go SDKs). That header does not
  sign the body, so the adapter re-reads the order or refund status before
  emitting an event. The newer checksum-header mode is unsupported: its
  algorithm is not documented and no SDK implements it. Checked:
  https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook,
  https://github.com/PhonePe/phonepe-pg-sdk-node, https://github.com/PhonePe/phonepe-pg-sdk-python.
- **PhonePe settlements**: the settlement APIs return per-settlement totals
  (id, UTR, amount), not per-payment lines, so `listSettlements` cannot be
  built on them. No SDK covers them. Checked:
  https://developer.phonepe.com/settlement/date-range-based-settlement-ids,
  https://developer.phonepe.com/settlement/settlement-status.
- **PhonePe subscriptions**: get and cancel only (immediate). Setup is a UPI
  intent flow; call `/subscriptions/v2/setup` through `raw`. Checked:
  https://developer.phonepe.com/payment-gateway/autopay/api-integration/api-reference/subscription-status,
  https://developer.phonepe.com/payment-gateway/autopay/api-integration/api-reference/subscription-cancel,
  https://github.com/PhonePe/phonepe-pg-sdk-java.
- **PayU Apple Pay** is shown on PayU Hosted Checkout but not forced: the
  hosted-checkout samples send `pg=APPLEPAY&bankcode=APPLEPAY`, while the
  merchant-hosted parameter table says `bankcode=CCAP`. Checked:
  https://docs.payu.in/docs/apple-pay-integration-payu-hosted-checkout.md,
  https://docs.payu.in/docs/apple-pay-integration-merchant-hosted-checkout.md.
  PayU's Google Pay is an Android SDK over UPI and saved instruments, not the
  web wallet: https://docs.payu.in/docs/android-google-pay-sdk.md.
- **Stripe, Razorpay, Paddle, PayPal and Lemon Squeezy** have no server-side
  way to limit a checkout to one wallet: Stripe shows wallets in the Payment
  Element, Razorpay in Standard Checkout, Paddle filters with Paddle.js
  `allowedPaymentMethods`, PayPal runs them through its JS SDK. Checked:
  https://docs.stripe.com/apple-pay.md?platform=web,
  https://razorpay.com/docs/payments/payment-methods/apple-pay.md,
  https://developer.paddle.com/concepts/payment-methods/apple-pay.md,
  https://developer.paypal.com/docs/checkout/apm/google-pay/,
  https://docs.lemonsqueezy.com/help/checkout/payment-methods.
- **PayU capture** uses `pre_authorize=1` at checkout and `capture_transaction`
  on the same postservice host as verify (two pre-authorization guides agree on
  the host, the vars and the sample). Checked:
  https://docs.payu.in/docs/credit-card-merchant-hosted-integration-pre-authorize-payment,
  https://docs.payu.in/docs/debit-card-merchant-hosted-integration-preauthorize-payments.
- **PayU subscriptions**: standing instructions are merchant-initiated
  `si_transaction` debits on a mandate. There is no gateway-run subscription
  to get or cancel. Charge renewals through `raw` with the `si_transaction`
  command. Checked:
  https://docs.payu.in/docs/cards-subscription-integration-merchant-hosted-checkout,
  https://docs.payu.in/docs/cb-subscriptions-integration-non-seamless.
- **PayU settlements** list through the Settlement Detail Range API
  (`GET https://info.payu.in/settlement/range`, sandbox
  `https://apitest.payu.in/settlement/range`; override with `settlementUrl`).
  Auth is an HMAC header: `hmac username="<key>", algorithm="sha512",
  headers="date", signature=sha512("|" + Date + "|" + salt)`. A transaction's
  `action` maps capture to `payment`, refund to `refund` and anything else
  (chargeback, `ADJ_*`) to `adjustment`. The fee is `totalProcessingFee` plus
  `totalServiceTax`. PayU's timestamps (`addedon`, `transactionDate`) carry no
  zone and the docs never state one; they are read as IST (+05:30), because
  PayU prints +05:30 wherever it does give an offset (e.g. the mandate status
  API). `payuDate` is the exported parser. The old `get_settlement_details`
  postservice command is gone from PayU's docs. Checked:
  https://docs.payu.in/reference/settlements/llms.txt,
  https://docs.payu.in/reference/check-mandate-status-api.
- **PayU payouts** stay unsupported because PayU's payout reference
  contradicts itself at https://docs.payu.in/reference/initiate-transfer-api:
  the samples send a JSON array body while the embedded OpenAPI says a
  form-urlencoded `BODY` field; the prose puts `pid` in a header while the
  OpenAPI puts it in the query; and the test URL
  (`https://uatoneapi.payu.in/payout/v2/payment`) and production URL
  (`https://payout.payumoney.com/payout/payment`) use different version paths.
- **Paddle partial refunds** are per line item. The adapter reads the
  transaction's `details.line_items` and fills them in order, each up to its
  total (tax included, Paddle's default `tax_mode`). Pick items yourself with
  `raw("POST", "/adjustments", ...)` if you need a different split.
- **Lemon Squeezy refunds**: the `order_refunded` webhook only carries the
  cumulative `refunded_amount`. Refunds made through this package line up with
  their webhook. A second partial refund made in the Dashboard arrives with the
  cumulative amount and over-counts the ledger.
- **PayPal settlements**: Transaction Search reports capture ids, and no
  official page says how to map one back to its order (this adapter's payment
  id) or which sign refunds and fees carry. Checked:
  https://developer.paypal.com/docs/api/transaction-search/v1/,
  https://github.com/paypal/paypal-rest-api-specifications.
- **PayPal webhooks** use the verify-webhook-signature API, not the offline
  certificate check: the docs describe the offline check but not how to
  validate `paypal-cert-url`, and an unvalidated certificate URL lets anyone
  sign. Checked: https://developer.paypal.com/api/rest/webhooks/rest/.
- **PayPal customers**: PayPal has no customer object. Vault customer ids come
  from vaulting a payment source, and `listPaymentMethods` takes that id.
- **Hyperswitch payouts** send `destination` as `payout_method_id` (a saved
  payout method). The guide says to pass the customer list's `payment_token`
  but names no field; the OpenAPI spec settles it. Payouts are never retried,
  because `merchant_order_reference_id` does not deduplicate. Subscriptions
  report no period end: `SubscriptionResponse` has none. Checked:
  https://api-reference.hyperswitch.io/v1/payouts/payouts--create,
  https://raw.githubusercontent.com/juspay/hyperswitch/main/api-reference/v1/openapi_spec_v1.json.
- **Hyperswitch settlements**: no public settlement or recon API. Checked:
  https://api-reference.hyperswitch.io/llms.txt.
- **Dodo Payments**: no capture endpoint; payouts are Dodo paying you
  (read-only), with no outbound payout API; no idempotency keys, so refunds
  are sent once and never retried. Settlements stay out because the balance
  ledger is in the settlement currency and net of the tax Dodo collects as
  merchant of record, so its lines cannot be matched to payment amounts.
  Checked: https://docs.dodopayments.com/api-reference/introduction.md,
  https://docs.dodopayments.com/api-reference/balance-ledger/list-ledger-entries.md,
  https://docs.dodopayments.com/api-reference/payouts/get-payouts.md.

## Quick start

```ts
import { createPayments, sqlStore } from "@dapplelight/signet-payments"
import { razorpay } from "@dapplelight/signet-payments/razorpay"
import { stripe } from "@dapplelight/signet-payments/stripe"

const payments = createPayments({
  gateways: [
    razorpay({ keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET }),
    stripe({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET }),
  ],
  route: (i) => (i.currency === "INR" ? "razorpay" : "stripe"),
  fallback: true, // on an outage only, never on a decline
  db: sqlStore({ query: async (s, p) => (await env.DB.prepare(s).bind(...p).all()).results }, { dialect: "sqlite" }),
})

const checkout = await payments.checkout({ amount: 49900, currency: "INR", idempotencyKey: orderId, reference: orderId, userId })
app.post("/webhooks/:gateway", (c) => payments.handleWebhook(c.req.param("gateway"), c.req.raw))
```

Configs never read env themselves; build them per request on Workers.

### One adapter on its own

Every adapter is a `PaymentGateway`; use it directly when you do not need
routing or the inbox.

```ts
// Razorpay: an Order for Razorpay Checkout; capture mode is a Dashboard setting.
const rzp = razorpay({ keyId, keySecret, webhookSecret })
const order = await rzp.createCheckout({ amount: 49900, currency: "INR", idempotencyKey: "order-1042" })

// Stripe: a PaymentIntent; pass clientSecret to Stripe Elements. Stripe-Version is pinned.
const s = stripe({ secretKey, webhookSecret })
const pi = await s.createCheckout({ amount: 1999, currency: "USD", idempotencyKey: "order-1042", capture: "manual" })

// Cashfree: an Order; clientSecret is the payment_session_id. Needs customer id and phone.
const cf = cashfree({ clientId, clientSecret, sandbox: true })
await cf.createCheckout({ amount: 49900, currency: "INR", idempotencyKey: orderUuid /* Cashfree expects a UUID */, customer: { id: "c1", phone: "9999999999" } })
await cf.createPayout({ amount: 10000, currency: "INR", idempotencyKey: "payout_42", destination: beneficiaryId }) // Payouts v2: whitelist the IP or pass payoutPublicKey

// PhonePe: Standard Checkout v2 (OAuth); redirect to url. Webhooks need the dashboard username and password.
const pp = phonepe({ clientId, clientSecret, clientVersion: 1, webhookUsername, webhookPassword, sandbox: true })
await pp.createCheckout({ amount: 49900, currency: "INR", idempotencyKey: "order-1042", returnUrl: "https://shop.example/done" })

// PayU: returns a form to POST from the browser (form.action, form.fields with the hash).
const pu = payu({ key, salt, sandbox: true })
await pu.createCheckout({ amount: 49900, currency: "INR", idempotencyKey: "order-1042", returnUrl, customer: { name: "A Buyer", email: "buyer@example.com" } })

// Paddle Billing: a Transaction from catalog prices; redirect to url.
const pd = paddle({ apiKey, webhookSecret, sandbox: true })
await pd.createCheckout({ amount: 1999, currency: "USD", idempotencyKey: "order-1042", extra: { items: [{ price_id: "pri_...", quantity: 1 }] } })

// Lemon Squeezy: a checkout for a variant at a custom price in the store currency.
const ls = lemonsqueezy({ apiKey, storeId: "1", currency: "USD", variantId: "7", webhookSecret })
await ls.createCheckout({ amount: 1999, currency: "USD", idempotencyKey: "order-1042" })

// PayPal: an Order; redirect to the approve url, then capture. Webhooks verify via PayPal's API.
const pal = paypal({ clientId, clientSecret, webhookId, sandbox: true })
const o = await pal.createCheckout({ amount: 1999, currency: "USD", idempotencyKey: "order-1042" })
await pal.capture(o.gatewayId, { idempotencyKey: "capture-1042" })

// Hyperswitch: a Payment; pass clientSecret to the Hyperswitch SDK.
const hs = hyperswitch({ apiKey, paymentResponseHashKey, sandbox: true })
await hs.createCheckout({ amount: 1999, currency: "USD", idempotencyKey: "order-1042" })

// Dodo Payments (merchant of record): a Checkout Session; redirect to url.
// Pass extra.product_cart, or a pay-what-you-want productId priced by amount.
const dd = dodo({ apiKey, webhookSecret, productId: "pdt_...", sandbox: true })
await dd.createCheckout({ amount: 1999, currency: "USD", idempotencyKey: "order-1042", reference: "order-1042" })
```

Anything the model does not cover: `gateway.raw("GET", "/path")` calls the
API with that adapter's auth, signing and retries.

## Webhook inbox

`handleWebhook` verifies the signature on the raw body (Web Crypto,
constant-time compare, timestamp tolerance where the scheme signs one),
stores the event deduped on (gateway, event id), then applies it:

- Events for a payment apply in `occurredAt` order, and an older or lower
  event never undoes a newer state (a late `authorized` cannot un-capture).
- Captures, fees, refunds and payouts post to the ledger under keys derived
  from the object, so duplicates and replays never double-post.
- `inline: false` stores only; run `payments.processInbox()` from a cron
  or queue consumer. `payments.replay(gateway, eventId)` re-applies one.
- Answers 200 once stored, 400 for a bad signature (nothing is kept), 500
  otherwise so the gateway retries.

## Storage

`memoryStore()` for tests. `sqlStore(client, { dialect })` for SQLite, D1
or Postgres; create the tables with the statements from
`paymentsSchema("sqlite" | "pg")`. The client is one structural function, so
it works with a signet-db database's driver or any other:

```ts
sqlStore({ query: (s, p) => sqlite.query(s).all(...p) }, { dialect: "sqlite" }) // bun:sqlite
sqlStore({ query: (s, p) => sql.unsafe(s, p) }, { dialect: "pg" })              // postgres-js
```

Idempotency is a structural hook too. With signet-db:

```ts
createPayments({ ..., idempotency: (key, scope, fn) => withIdempotency(db, key, scope, fn) })
```

## Ledger

Double entry, integer minor units, balanced per currency or rejected
(`UNBALANCED`), one atomic insert per transaction. Accounts:
`receivable:<gateway>`, `revenue`, `refunds`, `fees`, `bank`.

```ts
import { balance, post, transfer } from "@dapplelight/signet-payments"
await post(store, { txId: "adj-7", kind: "adjustment", legs: transfer("fees", "receivable:razorpay", 250, "INR") })
await balance(store, "receivable:razorpay", "INR")
```

## Reconciliation

```ts
const r = await reconcile(store, payments.gateway("razorpay"), { date: "2026-11-13" })
// r.mismatches: missing (settled, not in ledger), amount_differs, extra (in ledger, not settled)

const job = reconcileJob(store, payments.gateway("razorpay"), { onMismatch: alert })
await job() // yesterday, UTC: call from a cron
```

App Store amounts are Apple's configured price, not settled revenue: they
post as `capture:approximate` and are never reconciled (no settlement report).
Settlement lines come from Razorpay's settlement recon, Stripe's balance
transactions for the day, and PayU's settlement details.

## Agent tools

`paymentTools(payments, { userId, approve })` returns plain MCP tools
(`find_payment`, `list_payments`, `payment_timeline`, `find_subscription`,
`refund_payment`, and `refresh_entitlement` when you pass signet-db's
`entitlements`) that
signet-server's `createMcpServer({ tools })` takes. Refunds always go through
`approve`; pass signet-server's `requireApproval`. Without it, the tool
returns `APPROVAL_REQUIRED` and refunds nothing. See `AGENTS.md`.

## Errors

`PaymentsError` with `code`: `UNSUPPORTED`, `BAD_INPUT`, `DECLINED`,
`GATEWAY_ERROR`, `NOT_FOUND`, `GATEWAY_UNAVAILABLE` (the only retryable one),
`BAD_SIGNATURE`, `IDEMPOTENCY_KEY_REQUIRED`, `UNBALANCED`, `NO_GATEWAY`.

## Testing

`bun test` runs one conformance suite over every adapter against
docs-shaped fixtures (no keys, no network): the capability matrix, checkout,
payment, refund and webhook signatures built independently with node:crypto.
