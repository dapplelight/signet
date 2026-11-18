### create-signet-app: compose apps from parts

- A web app and its API are now composed from parts: `auth`, `account`,
  `orgs`, `admin`, `notifications`, `privacy`, `payments`, `growth` (waitlist,
  invites, referrals, feedback and marks) and `mcp`. `--with`
  adds parts, `--without` leaves them out, and the parts they need come along
  (the output says which). `--ui` writes the web half only (its client calls
  an API at `VITE_API_URL`), `--api` the API half only (no web files, no Vite);
  both by default.
- `--starter full` is every part on both halves, the app `--template full`
  made; `--template full` still works and means the same. `--starter blank` is
  the shell, API and database with no parts.
- `--platform web|api|cli|extension|desktop` names the single-app platforms;
  `--template` stays as its alias.
- Each part's migration pieces compose: an app's `drizzle/` holds only its
  parts' tables, `db:check` passes and `db:generate` finds nothing to do.
- The full app's API tests are split into one file per part, sharing
  `test/helpers.ts`; `account` gains an API key test and `notifications` an
  inbox test.
- `--pm` also takes `yarn` (modern Yarn through corepack) and `deno` (Deno 2,
  `package.json` scripts through `deno task`), and the default follows
  `npm_config_user_agent` for all five. `--platform cli` is refused with deno.
