# __APP_NAME__

<!-- web:begin -->
A web app and its API in one project, on Signet. <!-- @api -->
A web app on Signet. Its API lives elsewhere: point `VITE_API_URL` at it. <!-- @!api -->
<!-- web:end -->
An API on Signet: Hono on Bun, with SQLite. <!-- @!web -->
<!-- auth:begin -->
It has:

- phone sign-in
- organisations with members, roles and invite links <!-- @orgs -->
- an account page with devices and API keys <!-- @account -->
- an in-app inbox <!-- @notifications -->
- privacy (DPDP consent and data requests) <!-- @privacy -->
- plans and billing <!-- @payments -->
- an admin panel over the whole database <!-- @admin -->
- MCP for agents at `/mcp` <!-- @mcp -->
<!-- auth:end -->
<!-- !auth:begin -->
- MCP for agents at `/mcp` <!-- @mcp -->
<!-- !auth:end -->
<!-- api:begin -->

The API runs on [Bun](https://bun.sh), whichever package manager installed it.
<!-- api:end -->

## First day

### Run it (5 minutes)

```sh
__PM_INSTALL__
__PM_RUN__ dev
```

<!-- web:begin -->
<!-- api:begin -->
`dev` starts the API on port 3000 and Vite next to it; open the URL Vite
prints.
<!-- api:end -->
<!-- !api:begin -->
`dev` starts Vite; open the URL it prints. Put your API's origin in
`VITE_API_URL` (in `.env.local`); unset, the app calls its own origin.
<!-- !api:end -->
<!-- web:end -->
`dev` starts the API on port 3000 and restarts it on change. <!-- @!web -->
<!-- auth:begin -->
Sign in with any phone number. In development no SMS is sent: the
code is printed in the terminal running the API.
<!-- auth:end -->
<!-- api:begin -->

The env file at the project root was written for you with fresh <!-- @auth -->
`SESSION_SECRET` and `OTP_SECRET` values. It is gitignored. Every variable is <!-- @auth -->
The env file at the project root was written for you. It is gitignored. Every variable is <!-- @!auth -->
declared, with its default, in `api/env.ts`.
<!-- api:end -->
<!-- orgs:begin -->

### Organisations (5 minutes)

Signing up made you a **Personal** org, and you own it.
<!-- web:begin -->
The switcher in the
header lists your orgs; **New organisation** makes another and moves you into
it. **Org** has its settings (name, theme, brand colour) and
**Members and invites**: create an invite link, open it in a private window,
sign in as another number and accept. That person sees the orgs they belong
to and nothing else.
<!-- web:end -->
<!-- !web:begin -->
`/api/orgs` makes more, switches between them, and manages members and
invite links. A person sees the orgs they belong to and nothing else.
<!-- !web:end -->

- Roles are `owner` (everything), `admin` (settings, members, invites) and
  `member` (sees the member list), from signet-db's `DEFAULT_ORG_ROLES`. No
  one can hand out a role with more permissions than their own, and an org
  always keeps an owner.
- Which org a request is for: in development, the `signet_org` cookie the
  switcher sets, or an `x-org` header. In production, also the org's custom
  domain, or `<slug>.<ORG_ROOT_DOMAIN>` when you set `ORG_ROOT_DOMAIN`.
- Every org write (create, settings, roles, members, invites) is in the
  audit log.
<!-- orgs:end -->
<!-- admin:begin -->

### Make yourself platform admin (2 minutes)

Put your number in `ADMIN_PHONES` (E.164, comma-separated, e.g.
`+919876543210`) and sign in again. **Admin** appears in the header: the
operator's view of every table across every org, searchable and editable, with
each write in the audit log. Platform roles live in `users.role`: `admin` does
everything, `staff` all but delete, `readonly` looks. They are separate from
org roles: an org owner is not a platform admin.
<!-- admin:end -->
<!-- payments:begin -->

### Try billing (2 minutes)

<!-- web:begin -->
Open **Billing**, pick Pro and continue. `BILLING=fake` switches the plan at once, no
money moves, and the inbox gets a "Plan changed" notice. The API refuses to <!-- @notifications -->
money moves. The API refuses to <!-- @!notifications -->
start with `BILLING=fake` in staging or production.
<!-- web:end -->
<!-- !web:begin -->
`POST /api/billing/checkout` with `{ "plan": "pro" }`: `BILLING=fake` switches the
plan at once and no money moves. The API refuses to start with `BILLING=fake`
in staging or production.
<!-- !web:end -->

<!-- api:begin -->
Plans are in `api/plans.ts`: `definePlans` says what each plan allows,
`PLAN_DISPLAY` the name, description and price the page shows. Check a plan anywhere in the API:

```ts
await s.entitlements.can(userId, "export")
await s.entitlements.consume(userId, "projects", 1) // { ok, remaining }
```
<!-- api:end -->
<!-- !api:begin -->
Plans are in `src/lib/plans.ts`, a copy of your API's: `definePlans` says what
each plan allows, `PLAN_DISPLAY` the name, description and price the page shows.
Keep it in step with the API.
<!-- !api:end -->
<!-- payments:end -->

### Build your first feature (the rest of the day)

<!-- api:begin -->
1. **Table.** Add it to `api/db/schema.ts` (see `kv` for the shape, and <!-- @!auth -->
   `@dapplelight/signet-db/columns/sqlite` for the column helpers). <!-- @!auth -->
1. **Table.** Add it to `api/db/schema.ts` (see `users` for the column <!-- @auth -->
   helpers). <!-- @auth -->
   If it belongs to an org, give it <!-- @orgs -->
   `orgId: text("org_id").notNull()`. <!-- @orgs -->
   Then run `__PM_RUN__ db:generate`. The migration lands in `drizzle/`;
   the API applies it on its next start. `__PM_RUN__ db:check` flags migrations
   that drop or rename data.
2. **Route.** Add a file in `api/routes/` and mount it in `api/app.ts`.
<!-- auth:begin -->
   List its path in `SIGNED_IN` if it needs a user;
   `c.get("user")` is then the signed-in user.
<!-- auth:end -->
<!-- orgs:begin -->
   For org data, guard the route
   with `orgGuards({ orgs: s.orgs, userId }).requirePermission("projects:write")`
   and read and write through `scoped(s.db, { orgId: currentTenant(c).id })`.
   Another org's rows are then unreachable, and a table without `orgId`
   throws instead of leaking.
<!-- orgs:end -->
   Validate input with `zValidator`: the route is
   then also typed for the client and, with MCP on, a tool.
<!-- api:end -->
<!-- web:begin -->
3. **Page.** Add `src/routes/_app/<name>.tsx`. Call the route through `api` <!-- @api -->
   from `src/lib/api.ts`: the path, input and response are typed from the <!-- @api -->
   server, so a renamed field fails typecheck instead of production. <!-- @api -->
1. **Page.** Add `src/routes/_app/<name>.tsx` and call your API through `api` <!-- @!api -->
   from `src/lib/api.ts`. Give it your API's `AppType` (see the file) and the <!-- @!api -->
   calls are typed from the server. <!-- @!api -->
<!-- web:end -->
<!-- notifications:begin -->
<!-- api:begin -->
4. **Notify.** Add a template to `templates` in `api/services.ts` and call
   `s.notifier.notify(userId, "your.event", data)`. In-app works now; add
   `email`, `sms` or `whatsapp` variants and senders from
   `@dapplelight/signet-server/notify/channels` when you have provider keys.
<!-- api:end -->
<!-- notifications:end -->
<!-- admin:begin -->

The admin panel picks up new tables by itself.
<!-- admin:end -->

### Check it

```sh
__PM_RUN__ lint && __PM_RUN__ typecheck && __PM_RUN__ test && __PM_RUN__ build <!-- @web -->
__PM_RUN__ lint && __PM_RUN__ typecheck && __PM_RUN__ test <!-- @!web -->
<!-- web:begin -->
<!-- api:begin -->
<!-- auth:begin -->
__PM_X__ playwright install chromium   # once
__PM_RUN__ test:e2e                    # sign in, then each page
<!-- auth:end -->
<!-- api:end -->
<!-- web:end -->
```

CI (`.github/workflows/ci.yml`) runs the first line on every push. Commit
your lockfile.

## Layout

```
<!-- api:begin -->
api/
  app.ts            routes, the signed-in gate, MCP; exports AppType for the client
  plans.ts          plans and what the billing page shows (shared with the browser) <!-- @payments -->
  services.ts       what the routes use, built once per process
  routes/           one file per area <!-- @auth -->
  db/schema.ts      every table; drizzle/ holds the migrations
  db/kv.ts          sessions, codes, API keys, inbox and rate limits live in the kv table
  server.ts         Bun entry: the API under /api, the built app for every other path <!-- @web -->
  server.ts         Bun entry: the API under /api <!-- @!web -->
<!-- api:end -->
<!-- web:begin -->
src/
  routes/login.tsx  sign-in <!-- @auth -->
  routes/_app/      the signed-in pages, home first <!-- @auth -->
  routes/_app/      the pages, home first <!-- @!auth -->
  routes/invite.$token.tsx  the invite link <!-- @orgs -->
  lib/api.ts        the API client
<!-- !api:begin -->
  lib/plans.ts      plans, a copy of your API's <!-- @payments -->
<!-- !api:end -->
<!-- web:end -->
<!-- api:begin -->
test/               API tests (in-memory database)
e2e/                the browser smoke test <!-- @auth -->
<!-- api:end -->
```

## Deploying

<!-- api:begin -->
`__PM_RUN__ build`, then `__PM_RUN__ start` serves the API and the built app from one <!-- @web -->
Bun process. <!-- @web -->
`__PM_RUN__ start` serves the API from one Bun process. <!-- @!web -->
Mount a volume for `DATABASE_PATH` (default `data/app.db`) and set
`APP_ENV=production` on the host,
and `SESSION_SECRET`, `OTP_SECRET` and `ADMIN_PHONES`, <!-- @auth -->
and `ORG_ROOT_DOMAIN` if orgs get subdomains. For an org's custom <!-- @orgs -->
domain, point its DNS at the host and serve TLS for it there. <!-- @orgs -->
SQLite wants one writer: run one instance.
<!-- auth:begin -->

Before production:

- **SMS.** `api/services.ts` uses `devSmsSender`, which refuses to run in
  staging or production. Swap in a real sender, e.g. `smsSenderFor(msg91Sms(...))`
  from `@dapplelight/signet-server/notify/channels` (Indian numbers need DLT
  template ids).
<!-- payments:begin -->
- **Taking real payments.** Set `BILLING=razorpay` and the `RAZORPAY_*` keys.
  Gateway webhooks arrive at `/api/webhooks/razorpay`; signet-payments verifies
  them and each subscription event moves the user's plan through
  `entitlements.applyBillingEvent`. Map your Razorpay plan ids to plans in
  `billing.plans` (`api/services.ts`). Creating the subscription at checkout is
  the one step left to you: see the `TODO(billing)` in `api/routes/billing.ts`
  (pass the user id in the subscription's notes and read it back with
  `billing.subjectOf`).
<!-- payments:end -->
<!-- privacy:begin -->
- **Privacy requests.** Users open export and erasure requests from Privacy.
  Fulfil them with `privacy.fulfil(id, { actor })` (export returns the data to
  send; erasure deletes the user's rows listed in `userTables`).
<!-- privacy:end -->
<!-- auth:end -->
<!-- api:end -->
<!-- !api:begin -->
`__PM_RUN__ build` writes the app to `dist/`. Serve it from any static host
that falls back to `index.html` for unknown paths, with `VITE_API_URL` set at
build time. The API must allow this origin (CORS, credentials) and set its
session cookie for it.
<!-- !api:end -->
<!-- api:begin -->

## Observability

Off by default. Set `OBSERVABILITY=on` and the API writes a JSON log line pair
per request (`request.started`, then `request.completed` or `request.failed`)
with the request id and trace id, opens an OpenTelemetry span per request, and
answers `/health/live` and `/health/ready` (the database). Probes are left out
of spans and logs. Spans are no-ops until you register an OpenTelemetry SDK or
turn on Cloudflare tracing; Signet adds no exporter. To put the trace id on
every log line, pass `mixin` in `api/server.ts`. Prompts, bodies, cookies and
headers are never recorded.
<!-- api:end -->
<!-- web:begin -->

## Themes

`src/app.css` imports the __THEME__ theme from `@dapplelight/signet-tokens`.
Swap the import (`editorial`, `cinematic`, `finance`) and every component
reshapes. No component changes.
<!-- web:end -->
