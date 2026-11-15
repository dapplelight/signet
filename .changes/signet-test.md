### signet-test: new package (private until published)

- New `@dapplelight/signet-test`: fake providers with the real interfaces,
  each recording its calls. `fakeGateway` (Razorpay, Stripe, PayU shapes;
  webhooks signed in each gateway's format and verified by the real adapter),
  `fakeAppStore` / `fakeGooglePlay` (signed transactions and server
  notifications from test-generated keys, for the real `appstore()` /
  `googleplay()`), `fakeSenders` with an outbox for `createNotifier`,
  `fakeModel` on the AI SDK mock, `fakeClock`, `fakeFetch`.
- `./playwright`: `signInAs`, `seed`, and `expectAcrossThemes(page, name)`,
  which compares screenshots across the 3 themes × light/dark against stored
  baselines. `@playwright/test` is an optional peer.
- `./overlay`: `DevOverlay`, a dev-only panel (user, plan, entitlements,
  flags, theme switcher, outbox) that production builds drop.
- `./demo`: `createDemo` wires the fakes, a fake clock and seed data, with
  `/__signet/*` routes, so an app runs fully offline.
- signet-mcp: new `add-tests` recipe.
