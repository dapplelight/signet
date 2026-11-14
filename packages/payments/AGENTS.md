# Using @dapplelight/signet-payments as an agent

Two cases: you are **writing app code** with the package, or you are **an
agent acting on payments** through the tools it generates.

## Writing app code

- Amounts are integer minor units (paise, cents) plus an ISO currency. Never
  pass floats; convert at the input boundary with `toMinor("499.00", "INR")`.
- Every charge, capture, refund and payout needs an `idempotencyKey`. Use a
  stable one (your order id), not a random one per attempt.
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

## Acting on payments

Tools come from `paymentTools(payments, { userId, approve, maxRows })`.

- You only see the user's payments. Another user's payment reads as
  `NOT_FOUND`.
- `find_payment` and `payment_timeline` take `gateway` and `id`;
  `list_payments` is capped at `maxRows`, page with `offset`.
- `refund_payment` always asks the person first. If it returns
  `APPROVAL_REQUIRED` or `APPROVAL_DECLINED`, nothing was refunded: show the
  person the `approval.summary` and stop. Never retry to get around it.
- `amount` is minor units; omit it for a full refund of what is left. Give a
  `reason`; it is recorded with your actor id in the payment's timeline.
- Calling `refund_payment` twice for the same payment and amount does not
  refund twice.
