### signet-db: offerings, customer timeline, identity merge and Customer Center

- New `./offerings`: `createOfferings(db, { tables, plans })`. Offerings are store and web products mapped to plans plus a remote paywall (title, subtitle, plans shown, highlighted plan, badge, trial text, button text); `publish` writes an immutable version (`key@version`, safe under concurrent publishes). Placements (`setPlacement`) serve an offering's latest or a pinned version, with audience overrides on country, platform and attributes (first match wins); `current(placement, audience)` resolves it. `plansFromProducts` builds entitlements' `billing.plans` from the products.
- New `./customers`: `createCustomers(db, { tables, entitlements, payments?, notify?, cancel?, retention? })`. `record(event)` puts signet-payments events on a per-customer timeline once (purchase, renewal, refund, cancellation, billing issue, grace period, expiration...); `timeline(subject)` adds the customer's payments and ledger totals. `anonymousId()` and `merge({ anonymousId, userId, orgId })` move an anonymous buyer's subscriptions, grants, payments, timeline and requests to the account once, refusing repeats into another account, other orgs, non-anonymous ids and non-members; `resolve(id)` follows merges. Customer Center: `overview` (plan, renewal date, manage link, retention offer), `cancel` (web gateways directly, stores by deep link), `acceptRetention` (once per customer), `requestRefund` (own payments only, once per payment) and `contactSupport`, both sent to the team through `notify`; `requests` and `setRequestStatus` for admins.
- `monetisationTables()` in `./columns/sqlite` and `./columns/pg`. `matchesRule` is exported from `./flags`.

### signet-payments: reassign a user's payments

- `PaymentsStore.reassignUser(from, to)` (optional on the type; implemented by `memoryStore` and `sqlStore`) moves every payment of one user to another, for identity merges.

### signet-server: monetisation routes

- New `./http/monetisation`: `monetisationRoutes` (offering per placement and audience, anonymous ids, merge into the signed-in user, Customer Center: overview, timeline, cancel, retention, refund request, support) and `monetisationAdminRoutes` (publish offerings, set placements, any customer's overview and timeline, list and close requests; deny by default).

### signet-ui: monetisation screens

- New `./screens/monetisation-screens`: `RemotePaywall` renders a server offering on the `Paywall` parts and hands the matching store or web product to your checkout (`plansFromOffering`); `CustomerCenter` (plan and renewal date, retention offer before cancel, store manage links, refund request, contact support); `CustomerTimeline` (admin history across App Store, Google Play and web, with ledger totals).

### signet-mcp: add-monetisation recipe

- New `add-monetisation` recipe: offerings and remote paywalls, customer timeline, identity merge, Customer Center and routes, cut from the db and server READMEs.
