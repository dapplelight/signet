### signet-server: public API toolkit

- New `./http/openapi`: `openApiSpec(app, options)` builds OpenAPI 3.1 from the app's routes and their `zValidator` schemas (zod's `toJSONSchema`), with the error envelope as `#/components/responses/Error` on 400/401/default and `sessionCookie` / `apiKey` security schemes. `apiDoc({ summary, tags, response, responses, security })` adds per-route detail, `apiDoc(false)` hides a route. `serveOpenApi(app, options)` adds `GET /openapi.json` and `GET /docs` (`apiDocsHtml`: plain HTML, escaped, no script, no dependency).
- New `./http/cache`: `httpCache({ maxAge, private, vary, ... })` sets Cache-Control and Vary, adds an ETag and answers If-None-Match with a 304 that keeps the cache headers; `cachedResponse(c, { kv, freshSeconds, staleSeconds, varyBy }, render)` is a stale-while-revalidate response cache on any `KeyValue`; `cacheControlValue`, `mergeVary`, `etagMatches`.
- New `./http/webhooks`: `webhookRoutes({ webhooks, owner })`, admin routes for signet-db's outbound webhooks (endpoints, rotate secret, delivery log, redeliver).

### signet-db: outbound webhooks

- New `./webhooks`: `createWebhooks(db, { endpoints, deliveries })` with `webhookTables()` in `./columns/sqlite` and `./columns/pg`. Endpoints per user or org with their own secret (encrypted at rest with a db cipher), Standard Webhooks signatures, one outbox row per delivery so `drainOutbox` retries with backoff, a delivery log (status, attempts, response), `redeliver` with the same event id, and endpoints switched off after `disableAfter` failed attempts in a row. Endpoint urls must be https on a public host unless `allowPrivateUrls`.

### signet-lib: webhook signatures

- New `./webhooks`: `signWebhook`, `verifyWebhook` and `generateWebhookSecret` for Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`), Web Crypto only; secret rotation and Svix headers supported.

### signet-ui: API screens

- New `./screens/api-screens`: `ApiReference` renders an OpenAPI document's endpoints on Signet tokens; `WebhookDeliveryLog` shows deliveries with status filter, response details and redeliver.

### signet-mcp: publish-an-api recipe

- New `publish-an-api` recipe: OpenAPI and docs, outbound webhooks, signatures and HTTP caching, cut from the server, db and lib READMEs.
