### signet-db: web-to-app funnels

- New `./funnels`: `createFunnels(db, { tables, funnels, discounts, offerings, customers, entitlements, checkout, track?, grant?, onPaid? })`. A funnel is optional questions, a plan picker from an offering placement's priced web products, and the gateway's checkout. `start` prices the product and any discount on the server, creates a new anonymous customer and asks the gateway for exactly that amount under the session id. `applyEvent` grants the plan only on a verified `payment.captured` for the priced amount and currency, once; `refund.processed` ends the access. `redeem(sessionId, userId)` claims the session for one account (race-safe, idempotent for the same account) and merges the buyer in with `customers.merge`. URL discounts (`percentOff` or `amountOff`, `expiresAt`, `maxRedemptions` held atomically, `plans`) are charged as a price override and recorded on the customer timeline as kind `discount`. Step views, purchase and redemption are analytics events `funnel:<key>:<step>`; `funnelSteps(def)` gives the drop-off steps.
- `funnelTables()` in `./columns/sqlite` and `./columns/pg`. `TimelineKind` gains `discount`.

### signet-server: funnel routes and redemption tokens

- New `./http/funnels`: `funnelRoutes` serves the hosted checkout page (questions, plan picker, Stripe Express Checkout for Apple Pay and Google Pay plus the Payment Element with Stripe.js loaded at runtime, Razorpay Checkout, redirect or form gateways; nonce'd script and strict CSP), its config, step events and checkout API, the session status with a redemption link once paid, and `POST /redeem` for the signed-in app user. `redemptionToken`, `readRedemptionToken` and `redemptionLink` sign expiring, purpose-bound tokens with key rotation.

### signet-lib: funnel error codes

- `ERROR_CODES` and `DEFAULT_ERROR_COPY` gain `BAD_TOKEN` and `REDEEM_REFUSED`.

### signet-ui: funnel screens

- New `./screens/funnel-screens`: `WebFunnel` (questions, `RemotePaywall` with the URL discount priced in, email and code), `ExpressCheckout` (Stripe's Express Checkout and Payment Elements, Stripe.js loaded at runtime), `FunnelRedemption` (waits for payment, then the app link and the code), `discountedOffering` and `loadScript`.

### signet-mcp: add-funnels recipe

- New `add-funnels` recipe: funnels and checkout, URL discounts, redemption, funnel analytics and routes, cut from the db and server READMEs.
