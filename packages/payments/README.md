# @dapplelight/signet-payments

One payment model over Razorpay, Stripe, Cashfree, PhonePe, PayU, Paddle,
Lemon Squeezy, PayPal and Hyperswitch, plus the parts every app rebuilds
around them: a webhook inbox, a double-entry ledger and reconciliation.

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
| `@dapplelight/signet-payments` | Types, `createPayments`, stores, ledger, `reconcile`, errors |
| `@dapplelight/signet-payments/razorpay` ... `/hyperswitch` | One adapter per subpath |
| `@dapplelight/signet-payments/agent` | `paymentTools`: MCP tools for agents |

## Capability matrix

| | razorpay | stripe | cashfree | phonepe | payu | paddle | lemonsqueezy | paypal | hyperswitch |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| upi | ✓ |  | ✓ | ✓ | ✓ |  |  |  | ✓ |
| card | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| netbanking | ✓ |  | ✓ | ✓ | ✓ |  |  |  | ✓ |
| wallet | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ | ✓ |
| emi | ✓ |  | ✓ |  |  |  |  |  |  |
| capture | ✓ | ✓ | ✓ |  |  |  |  | ✓ | ✓ |
| refunds | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| partialRefunds | ✓ | ✓ | ✓ | ✓ | ✓ |  |  | ✓ | ✓ |
| customers | ✓ | ✓ | ✓ |  |  | ✓ | ✓ |  | ✓ |
| savedMethods | ✓ | ✓ | ✓ |  |  | ✓ |  |  |  |
| subscriptions | ✓ | ✓ | ✓ |  |  | ✓ | ✓ | ✓ |  |
| payouts | ✓ | ✓ | ✓ |  |  |  |  | ✓ |  |
| settlements | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |
| webhooks | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ | ✓ |

Razorpay payouts are RazorpayX and need `accountNumber`. Hyperswitch methods
depend on the connectors enabled in your account. What each unsupported cell
is missing is at the top of that adapter's source file.

### Notes on gaps

A feature is supported only where the official API spec or docs and an official
SDK (or two official doc pages) agree. What is left out, and why:

- **Cashfree payouts** do not send the optional `x-cf-signature` 2FA header (RSA
  over `clientId.timestamp` with a dashboard key). Two doc pages describe it but
  the official payout SDK has no code for it, so whitelist your server IP
  instead. Checked: https://www.cashfree.com/docs/payouts/payouts/integrations/payouts-2fa.md,
  https://www.cashfree.com/docs/openapi/payouts/payoutsv2extra.yaml,
  https://github.com/cashfree/cashfree-payout-sdk-nodejs.
- **Cashfree subscriptions** cancel immediately only (`atPeriodEnd` is refused)
  and report no created time or period end: `SubscriptionEntity` has neither.
  Checked: https://www.cashfree.com/docs/openapi/payments/v2026-01-01.yaml,
  https://www.cashfree.com/docs/payments/subscription/create.md.

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
await cf.createPayout({ amount: 10000, currency: "INR", idempotencyKey: "payout_42", destination: beneficiaryId }) // Payouts v2, IP whitelisted

// PhonePe: Standard Checkout v2 (OAuth); redirect to url. Poll getPayment: webhooks are unsupported.
const pp = phonepe({ clientId, clientSecret, clientVersion: 1, sandbox: true })
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

Settlement lines come from Razorpay's settlement recon, Stripe's balance
transactions for the day, and PayU's settlement details.

## Agent tools

`paymentTools(payments, { userId, approve })` returns plain MCP tools
(`find_payment`, `list_payments`, `payment_timeline`, `refund_payment`) that
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
