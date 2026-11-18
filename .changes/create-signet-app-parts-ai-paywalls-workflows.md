### create-signet-app: `ai`, `paywalls` and `workflows` parts

Three new parts for composed apps, in the `full` starter too:

- `ai` (needs `auth`, API only): AI spend caps per user and for the app with signet-db's `createAiSpend`, `requireAiSpend` on `/api/ai/*` (429 with `Retry-After` over a cap), a sample `POST /api/ai/summary` on signet-ai's fake provider so it runs with no key, caps from `AI_CAP_USER_DAY` and `AI_CAP_GLOBAL_MONTH`, and with `admin`, `aiSpendAdminRoutes` at `/api/admin/ai-spend`.
- `paywalls` (needs `payments`, API only): versioned offerings and placements with signet-db's `createOfferings`, `GET /api/paywall/:placement` for the caller's audience, and with `admin`, publishing under `/api/admin/paywalls` (the admin panel lists both tables read only).
- `workflows` (needs `auth`): signet-db's durable workflows at `/api/workflows` through signet-server's `workflowRoutes`, a generic approval-request example, the runner polling in `api/server.ts` on Bun, Deno and Node, and an **Approvals** page on signet-ui's `ApprovalInboxCard`.

Their tables come in one new migration. Migration pruning now keeps a table two parts list (`usage_counters`, for `payments` and `ai`) while either is chosen, and when a migration empties out the later ones move up a number and relink their snapshots, so `db:generate` neither reuses a number nor finds a broken chain.
