# __APP_NAME__

A web app and its API in one project, on Signet: phone sign-in, an account
page with devices and API keys, an in-app inbox, privacy (DPDP consent and data
requests), plans and billing, and an admin panel over the whole database.

The API runs on [Bun](https://bun.sh), whichever package manager installed it.

## First day

### 1. Run it (5 minutes)

```sh
__PM_INSTALL__
__PM_RUN__ dev
```

`dev` starts the API on port 3000 and Vite next to it; open the URL Vite
prints. Sign in with any phone number. In development no SMS is sent: the
code is printed in the terminal running `dev`.

The env file at the project root was written for you with fresh
`SESSION_SECRET` and `OTP_SECRET` values. It is gitignored. Every variable is
declared, with its default, in `api/env.ts`.

### 2. Make yourself admin (2 minutes)

Put your number in `ADMIN_PHONES` (E.164, comma-separated, e.g.
`+919876543210`) and sign in again. **Admin** appears in the header: every
table, searchable and editable, with each write in the audit log. Roles live in
`users.role`: `admin` does everything, `staff` all but delete, `readonly` looks.

### 3. Try billing (2 minutes)

Open **Billing** and upgrade. `BILLING=fake` switches the plan at once, no
money moves, and the inbox gets a "Plan changed" notice. The API refuses to
start with `BILLING=fake` in staging or production.

Plans are in `api/services.ts`: `definePlans` says what each plan allows,
`PLAN_DISPLAY` what the page shows. Check a plan anywhere in the API:

```ts
await s.entitlements.can(userId, "export")
await s.entitlements.consume(userId, "projects", 1) // { ok, remaining }
```

### 4. Build your first feature (the rest of the day)

1. **Table.** Add it to `api/db/schema.ts` (see `users` for the column
   helpers), then `__PM_RUN__ db:generate`. The migration lands in `drizzle/`;
   the API applies it on its next start. `__PM_RUN__ db:check` flags migrations
   that drop or rename data.
2. **Route.** Add a file in `api/routes/` like `account.ts` and mount it in
   `api/app.ts`. List its path in `SIGNED_IN` if it needs a user;
   `c.get("user")` is then the signed-in user. Validate input with `zValidator`:
   the route is then also typed for the client and, with MCP on, a tool.
3. **Page.** Add `src/routes/_app/<name>.tsx`. Call the route through `api`
   from `src/lib/api.ts`: the path, input and response are typed from the
   server, so a renamed field fails typecheck instead of production.
4. **Notify.** Add a template to `templates` in `api/services.ts` and call
   `s.notifier.notify(userId, "your.event", data)`. In-app works now; add
   `email`, `sms` or `whatsapp` variants and senders from
   `@dapplelight/signet-server/notify/channels` when you have provider keys.

The admin panel picks up new tables by itself.

### 5. Check it

```sh
__PM_RUN__ lint && __PM_RUN__ typecheck && __PM_RUN__ test && __PM_RUN__ build
__PM_X__ playwright install chromium   # once
__PM_RUN__ test:e2e                    # signs in, opens admin, upgrades, in a real browser
```

CI (`.github/workflows/ci.yml`) runs the first line on every push. Commit
your lockfile.

## Layout

```
api/
  app.ts            routes, auth gate, admin, MCP; exports AppType for the client
  services.ts       plans, notification templates, consent purposes, admin config
  routes/           auth, account, notifications, privacy, billing
  db/schema.ts      every table; drizzle/ holds the migrations
  db/kv.ts          sessions, codes, API keys, inbox and rate limits live in the kv table
  server.ts         Bun entry: the API under /api, the built app for every other path
src/
  routes/login.tsx  sign-in
  routes/_app/      the signed-in pages: home, account, notifications, privacy, billing, admin
  lib/api.ts        the typed client
test/               API tests (in-memory database)
e2e/                the browser smoke test
```

## Deploying

`__PM_RUN__ build`, then `__PM_RUN__ start` serves the API and the built app from one
Bun process. Mount a volume for `DATABASE_PATH` (default `data/app.db`) and set
`APP_ENV=production`, `SESSION_SECRET`, `OTP_SECRET` and `ADMIN_PHONES` on the
host. SQLite wants one writer: run one instance.

Before production:

- **SMS.** `api/services.ts` uses `devSmsSender`, which refuses to run in
  staging or production. Swap in a real sender, e.g. `smsSenderFor(msg91Sms(...))`
  from `@dapplelight/signet-server/notify/channels` (Indian numbers need DLT
  template ids).
- **Taking real payments.** Set `BILLING=razorpay` and the `RAZORPAY_*` keys.
  Gateway webhooks arrive at `/api/webhooks/razorpay`; signet-payments verifies
  them and each subscription event moves the user's plan through
  `entitlements.applyBillingEvent`. Map your Razorpay plan ids to plans in
  `billing.plans` (`api/services.ts`). Creating the subscription at checkout is
  the one step left to you: see the `TODO(billing)` in `api/routes/billing.ts`
  (pass the user id in the subscription's notes and read it back with
  `billing.subjectOf`).
- **Privacy requests.** Users open export and erasure requests from Privacy.
  Fulfil them with `privacy.fulfil(id, { actor })` (export returns the data to
  send; erasure deletes the user's rows listed in `userTables`).

## Themes

`src/app.css` imports the __THEME__ theme from `@dapplelight/signet-tokens`.
Swap the import (`editorial`, `cinematic`, `finance`) and every component
reshapes. No component changes.
