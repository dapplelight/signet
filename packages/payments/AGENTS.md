# Using @dapplelight/signet-payments as an agent

Two cases: you are **writing app code** with the package, or you are **an
agent acting on payments** through the tools it generates.

## Writing app code

- Amounts are integer minor units (paise, cents) plus an ISO currency. Never
  pass floats; convert at the input boundary with `toMinor("499.00", "INR")`.
- Every charge, capture, refund and payout needs an `idempotencyKey`. Use a
  stable one (your order id), not a random one per attempt.
- `method: "applepay" | "googlepay"` means the device wallets. Google Pay's
  UPI app in India is `upi`. Check `gateway.capabilities.methods` first.
- Check `gateway.supports(feature)` before offering a feature; an unsupported
  call rejects with `UNSUPPORTED` and never reaches the network.
- Mount `payments.handleWebhook(name, request)` on the raw request. Do not
  parse the body first; verification needs the exact bytes.
- Fallback happens only on `GATEWAY_UNAVAILABLE`. Never retry a `DECLINED`
  charge on another gateway.
- Read balances from the ledger (`balance(store, account, currency)`), never by
  adding up payment rows.
- Run `reconcile` daily for gateways with `settlements`; act on `missing`
  first (usually a webhook that never arrived: `replay` or re-sync).
- Errors are `PaymentsError`; branch on `e.code`.
- App Store and Google Play purchases happen on the device. After one, call
  `payments.verifyPurchase({ gateway, id, userId })` with the transaction id
  (App Store) or order id (Google Play). Never trust a client's claim that a
  user is subscribed: read `getSubscription` or the stored events.
- App Store amounts are Apple's configured price, not settled revenue
  (`approximate: true`; ledger kind `capture:approximate`). Never report them
  as revenue without saying so.
- Store subscriptions: `past_due` with `inGracePeriod: true` still has access;
  `cancelled` keeps access until `currentPeriodEnd`.

## Acting on payments

Tools come from `paymentTools(payments, { userId, approve, maxRows })`.

- You only see the user's payments. Another user's payment reads as
  `NOT_FOUND`.
- `find_payment` and `payment_timeline` take `gateway` and `id`;
  `list_payments` is capped at `maxRows`, page with `offset`.
- `find_subscription` takes `gateway` and the subscription `id` (App Store:
  original transaction id; Google Play: purchase token) and reads it live.
  It only finds subscriptions linked to one of the user's payments.
- `refresh_entitlement` (only with `entitlements`) takes the same input,
  reads the subscription live and re-applies it to its owner's plan. Use it
  when access looks wrong after a renewal, refund or restore; it changes
  nothing the store does not already say.
- `restorePurchases` refuses a purchase another user owns (`BAD_INPUT` in
  `refused`). Tell the user it belongs to another account; never retry it
  under a different user id.
- App Store payments cannot be refunded from the server: `refund_payment`
  returns `UNSUPPORTED` without asking anyone. Tell the person that the customer
  requests the refund from Apple. Google Play refunds are full only.
- `refund_payment` always asks the person first. If it returns
  `APPROVAL_REQUIRED` or `APPROVAL_DECLINED`, nothing was refunded: show the
  person the `approval.summary` and stop. Never retry to get around it.
- `amount` is minor units; omit it for a full refund of what is left. Give a
  `reason`; it is recorded with your actor id in the payment's timeline.
- `refund_payment` needs an `idempotencyKey`. Retry a call that timed out or
  lost its result with the same key and it does not refund twice. A different
  refund, even for the same amount, needs a new key and its own approval.
