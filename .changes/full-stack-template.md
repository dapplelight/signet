### create-signet-app: full-stack template, `--pm`, finance theme

- `--template full`: a web app and its Bun + Hono API in one project. Typed
  client (`createRpcClient(hc<AppType>)`), SQLite through signet-db with
  drizzle-kit migrations (users and roles, audit log, entitlements, growth,
  privacy, and a kv table for sessions, codes, API keys, inbox and rate
  limits), phone one-time-code sign-in with stored sessions, and pages wired
  to signet-ui's auth, account, notification and privacy screens, plus billing
  (plans, fake checkout in development, Razorpay webhooks to entitlements) and
  admin (`defineAdmin` over the schema, by role). Ships API tests, a Playwright
  smoke test (sign-in → admin → billing) and a first-day README.
- `--pm bun|npm|pnpm` (default: the one that ran it, else bun) sets CI's
  install and run commands, the printed next steps and the README; pnpm apps
  get a `pnpm-workspace.yaml` approving esbuild's and workerd's build scripts.
- `--theme finance`.
