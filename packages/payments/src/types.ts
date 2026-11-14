/**
 * The canonical model every adapter maps to. Amounts are integer minor units
 * (paise, cents) plus an ISO 4217 currency, never floats; every object keeps
 * the gateway's own payload in `raw`.
 */

export type Money = { amount: number; currency: string }

export type Method = "upi" | "card" | "netbanking" | "wallet" | "emi"

export type Feature =
  | "capture"
  | "refunds"
  | "partialRefunds"
  | "subscriptions"
  | "customers"
  | "savedMethods"
  | "payouts"
  | "settlements"
  | "webhooks"

export type Capabilities = {
  methods: readonly Method[]
  features: readonly Feature[]
  /** Currencies the adapter accepts. Omitted: whatever the account supports. */
  currencies?: readonly string[]
}

type Base = {
  gateway: string
  /** The id to pass back to this adapter. */
  gatewayId: string
  createdAt: Date
  raw: unknown
}

export type PaymentStatus =
  | "created"
  | "pending"
  | "authorized"
  | "captured"
  | "partially_refunded"
  | "refunded"
  | "failed"
  | "cancelled"

export type Payment = Base &
  Money & {
    status: PaymentStatus
    method?: string
    customerId?: string
    /** The gateway's order id, when payments hang off orders. */
    orderId?: string
    /** Gateway fee in minor units, when the gateway reports it on the payment. */
    fee?: number
    amountRefunded?: number
  }

export type Refund = Base &
  Money & {
    paymentId: string
    status: "pending" | "processed" | "failed"
  }

export type Customer = Base & { email?: string; name?: string; phone?: string }

export type PaymentMethod = Base & { customerId: string; type: string; label?: string }

export type SubscriptionStatus =
  | "pending"
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "cancelled"
  | "expired"

export type Subscription = Base & {
  status: SubscriptionStatus
  customerId?: string
  currentPeriodEnd?: Date
}

export type Payout = Base &
  Money & { status: "pending" | "processing" | "paid" | "failed" | "cancelled" | "reversed" }

export type SettlementLine = Money & {
  kind: "payment" | "refund" | "adjustment" | "payout" | "other"
  /** The settled entity's id (a payment, refund, ...). */
  gatewayId: string
  /** The payment this line belongs to, as `Payment.gatewayId`. */
  paymentId?: string
  fee?: number
  settlementId?: string
  /** When the underlying transaction happened. */
  createdAt: Date
  raw: unknown
}

export type Settlement = { gateway: string; date: string; lines: SettlementLine[]; raw: unknown }

export type EventType =
  | "payment.authorized"
  | "payment.captured"
  | "payment.failed"
  | "refund.processed"
  | "refund.failed"
  | "subscription.created"
  | "subscription.activated"
  | "subscription.charged"
  | "subscription.updated"
  | "subscription.paused"
  | "subscription.resumed"
  | "subscription.past_due"
  | "subscription.cancelled"
  | "subscription.expired"
  | "payout.processed"
  | "payout.failed"
  | "payout.reversed"
  | "dispute.opened"
  | "dispute.updated"
  | "dispute.won"
  | "dispute.lost"
  | "dispute.closed"
  /** Recorded locally when this package asks a gateway for a refund (who asked, how much). */
  | "refund.requested"
  /** Verified, but not one this package normalises. `gatewayType` says what it was. */
  | "unknown"

/** A verified, normalised webhook event. */
export type Event = {
  /** The gateway's event id: the inbox dedupes on (gateway, id). */
  id: string
  gateway: string
  type: EventType
  /** The gateway's own event name. */
  gatewayType: string
  occurredAt: Date
  paymentId?: string
  /** The gateway order the payment belongs to, when that is a different id. */
  orderId?: string
  /** Your reference, when the gateway echoes it back. */
  reference?: string
  refundId?: string
  subscriptionId?: string
  payoutId?: string
  disputeId?: string
  /** Minor units of the object the event is about (the payment, refund, payout...). */
  amount?: number
  currency?: string
  /** Gateway fee in minor units, when the event carries it. */
  fee?: number
  raw: unknown
}

export type CheckoutInput = Money & {
  /** Required: retries with the same key never charge twice. */
  idempotencyKey: string
  method?: Method
  country?: string
  /** Your order id. Gateways that need a merchant reference use it (default: the idempotency key). */
  reference?: string
  description?: string
  customer?: { id?: string; email?: string; name?: string; phone?: string }
  /** Where the gateway sends the buyer back to. */
  returnUrl?: string
  /** "manual": authorise now, `capture` later. Default "auto". */
  capture?: "auto" | "manual"
  metadata?: Record<string, string>
  /** Gateway-specific fields merged into the create request. */
  extra?: Record<string, unknown>
}

export type Checkout = Money & {
  gateway: string
  /** Pass to `getPayment` (or the order id, for order-based gateways). */
  gatewayId: string
  /** A hosted page to redirect the buyer to. */
  url?: string
  /** For a client-side SDK (Stripe Elements, Hyperswitch SDK). */
  clientSecret?: string
  /** A form to POST from the browser (PayU). */
  form?: { action: string; fields: Record<string, string> }
  raw: unknown
}

export type RefundInput = {
  /** Omit for a full refund. */
  amount?: number
  reason?: string
  idempotencyKey: string
}

export type CaptureInput = { amount?: number; idempotencyKey: string }

export type CustomerInput = { email?: string; name?: string; phone?: string }

export type PayoutInput = Money & {
  idempotencyKey: string
  /** The gateway's destination id (a fund account, bank account, receiver email...). */
  destination: string
  reference?: string
  extra?: Record<string, unknown>
}

export type WebhookOptions = {
  /** Reject signed timestamps older than this. Default 300 s, where the scheme signs one. */
  toleranceSeconds?: number
  now?: () => number
}

export type RawOptions = {
  idempotencyKey?: string
  headers?: Record<string, string>
  query?: Record<string, string | number | undefined>
}

/**
 * One adapter. Every method exists on every adapter; one outside
 * `capabilities` rejects with UNSUPPORTED before any network call.
 */
export type PaymentGateway = {
  readonly name: string
  readonly capabilities: Capabilities
  supports(feature: Feature): boolean
  createCheckout(input: CheckoutInput): Promise<Checkout>
  getPayment(id: string): Promise<Payment>
  capture(id: string, input: CaptureInput): Promise<Payment>
  refund(paymentId: string, input: RefundInput): Promise<Refund>
  createCustomer(input: CustomerInput): Promise<Customer>
  listPaymentMethods(customerId: string): Promise<PaymentMethod[]>
  getSubscription(id: string): Promise<Subscription>
  cancelSubscription(id: string, options?: { atPeriodEnd?: boolean }): Promise<Subscription>
  createPayout(input: PayoutInput): Promise<Payout>
  listSettlements(options: { date: string }): Promise<Settlement[]>
  /** Verify the signature on the raw body, then normalise. Throws BAD_SIGNATURE. */
  verifyWebhook(request: Request, options?: WebhookOptions): Promise<Event>
  /** Any endpoint, with this adapter's auth, signing and retries. */
  raw(method: string, path: string, body?: unknown, options?: RawOptions): Promise<unknown>
}

/** What every adapter's config takes besides credentials. */
export type HttpOptions = {
  fetch?: typeof fetch
  /** Retries on network errors, 429 and 5xx, for GETs and keyed writes. Default 2. */
  retries?: number
  /** First retry delay; doubles each time. Default 250 ms. */
  retryDelayMs?: number
  /** Use the gateway's sandbox / test host. Default false. */
  sandbox?: boolean
  /** Override the API base URL. */
  baseUrl?: string
}
