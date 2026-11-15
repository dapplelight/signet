### signet-test: new package (private until published)

- New `@dapplelight/signet-test`: fake providers with the real interfaces,
  each recording its calls. Nothing reaches the network.
- `fakeGateway("razorpay" | "stripe" | "payu")`: the real signet-payments
  adapter over an in-memory server in each gateway's own formats. Covers
  checkout, capture, refunds, customers, subscriptions (renewals, failed
  charges, cancels), payouts and settlements, with signed lifecycle webhooks.
  `UNSUPPORTED` only where the gateway has no such API (PayU subscriptions
  and payouts). Failure injection (`fail("decline" | "unavailable" |
  "timeout")`), idempotency keys that replay like the gateways' (scoped per
  endpoint, safe under concurrency, rejected on a different body), `reset()`.
- `fakeAppStore` / `fakeGooglePlay`: signed transactions and notifications
  from test-generated keys for the real `appstore()` / `googleplay()`, with
  lifecycle helpers (subscribe, renew, grace period, billing retry / account
  hold, cancel, expire, refund, revoke) that keep the store APIs in step.
- Tests drive the real ledger and entitlements through every failure:
  duplicate and concurrent webhooks, out-of-order and stale events, timeouts,
  5xx retries, declines. Grants and bookings happen once.
- `fakeSenders` with an outbox for `createNotifier` (failures are real
  `NotifyError`s, permanent or transient); `fakeNotifyStore`, an in-memory
  `NotifyStore` on the fake clock; `fakeModel` on the AI SDK mock;
  `fakeClock`; `fakeFetch`.
- `./playwright`: `signInAs`, `seed`, and `expectAcrossThemes(page, name)`,
  which compares screenshots across the 3 themes × light/dark against stored
  baselines. `@playwright/test` is an optional peer.
- `./overlay`: `DevOverlay`, a dev-only panel (user, plan, entitlements,
  flags, theme switcher, outbox). Production builds resolve a stub through
  the `production` export condition; it also loads without a bundler and
  takes an explicit `enabled`.
- `./demo`: `createDemo` wires every fake (gateways, payments, senders,
  notify store, model) on a fake clock with seed data and `/__signet/*`
  routes, so an app runs fully offline; `reset` restores all of it.
- CI: a separate job runs the Playwright suite in Chromium against stored
  Linux baselines.
- signet-mcp: new `add-tests` recipe.
