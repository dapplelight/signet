### signet-db: subscription charts, offers, promotional entitlements, Apple refund requests

- New `./charts`: `createCharts(db, { tables: { customerEvents, chartAudiences?, offerings? }, products?, fx?, trialDays?, attributionDays? })`. `metrics({ from, to, store?, plan?, country?, offering?, audience? })` gives per UTC day and in total: MRR per currency (normalised to a month; a total in `fx.base` only with a rate for every currency), active subscribers and trials, new versus renewal revenue, refunds, new subscriptions, trials started and converted, churn, paywall impressions and conversions, plus `trialConversion`, `churnRate` and `paywallConversion`. One GROUP BY on SQLite, D1 or Postgres buckets the timeline by day; results with App Store prices say `approximate`. Saved filters: `saveAudience`, `audiences`, `removeAudience`. CSV: `csv(query)` or `chartsCsv(result)`.
- `monetisationTables()` adds `chartAudiences`, and `customerEvents` gains nullable `country` and `offering` columns and an `occurred_at` index. Add them in your next migration.
- Offers: `OfferingProduct.offers` takes free trials, intro and win-back offers (`{ id, type, days?, price?, eligibility?: { neverSubscribed?, lapsedDays?, once? } }`), validated on `publish`. `offerEligible(offer, history)` is the rule: never while subscribed, never-subscribed by default for trials and intro, lapsed at least `lapsedDays` for win-back, once per customer. `customers.withOffers(subject, offering)` cuts an offering to what that customer may see; `customers.redeemOffer(subject, offering, offerId)` claims one once (concurrent claims have one winner). Requests gain the `offer` kind.
- Promotional entitlements: `ent.grantPromotional(subject, plan, { actor, expiresAt })` and `ent.endPromotional`, a `promotional` source that lapses exactly at its expiry. `customers.grantPromotional(subject, { plan, days | expiresAt, note? }, { actor })` and `customers.endPromotional` also put it on the timeline (`promotional`, then `expiration`). The Customer Center treats it like a manual plan.
- Timeline: zero-amount or App Store FREE_TRIAL purchases are `trial`; App Store `CONSUMPTION_REQUEST` is `refund_request` (`isTrial` is exported). `record(e, { country })` stores the customer's country. `customers.logImpression(subject, { offering, version?, placement?, country? })` logs a paywall view, once per customer, offering and day, kept off the timeline.
- `customers.consumptionInfo(event)` builds the answer to a CONSUMPTION_REQUEST from the customer's data (delivery status, share of the paid period used, whether they had a trial), with hooks for each field. With no consent (`consumption.consented`) it returns `respond: false` and nothing is sent, as Apple requires.

### signet-payments: answer App Store CONSUMPTION_REQUEST

- `appstore(...).sendConsumptionInfo(transactionId, body)` PUTs Send Consumption Information v2 (`/inApps/v2/transactions/consumption/{id}`). `checkConsumptionRequest` refuses a body Apple would reject: `customerConsented` other than true, an unknown `deliveryStatus`, a percentage outside 0 to 100000, a non-zero percentage when not delivered, or a percentage with `GRANT_PRORATED`. New types `ConsumptionRequest` and `ConsumptionDeliveryStatus`.

### signet-server: charts, offers and promotional grants in the monetisation routes

- `monetisationRoutes`: `GET /offerings/:placement` returns only the offers this customer may see (`customers.withOffers`); new `POST /offerings/:placement/impression` (204) and `POST /offerings/:placement/redeem` (`{ offerId }`, 409 `OFFER_REFUSED` with the reason).
- `monetisationAdminRoutes({ charts })`, deny by default like the rest: `GET /charts` and `GET /charts/csv` (`?from=&to=&store=&plan=&country=&offering=&audience=`, default the last 30 days), `GET/POST /audiences`, `DELETE /audiences/:id`, `POST /customers/:subject/promotional` and `DELETE /customers/:subject/promotional/:id`. `GET /requests?kind=offer` is accepted. New type `ChartStore`.

### signet-ui: subscription charts screen, offers on the paywall

- New `./screens/subscription-charts`: `SubscriptionCharts` draws signet-db's chart result on the recharts chart parts. It shows summary tiles, then MRR per currency with the converted total, subscribers and trials, new and renewal revenue with refunds, churn and trial conversions, and paywall views against conversions. Filters for store, plan, country and offering, the audience picker, save as audience and the CSV link go out as callbacks. recharts is an optional peer, so the screen is not in the barrel.
- `RemotePaywall` shows the customer's first offer (`RemoteOffer`) in place of the static trial text and passes it to `onPurchase` as a fourth argument. New `onImpression` is called once per offering version. New `PromotionalGrantForm`. The timeline labels `trial`, `promotional` and `refund_request`.

### signet-mcp: add-subscription-charts recipe

- New recipe covering charts, offers, promotional entitlements and CONSUMPTION_REQUEST, cut from the db and server READMEs, with end-to-end checks.

### signet-lib: OFFER_REFUSED error code

- `ERROR_CODES` and `DEFAULT_ERROR_COPY` gain `OFFER_REFUSED` (signet-server's offer claim, 409, with the reason in `details`).
