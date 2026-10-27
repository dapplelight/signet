# Migrating products onto Signet

Assessed 2026-09-22. **Do app-b first** — it is small, low-risk, and
proves the packages work in a real product before touching the donor.

## app-b — small, do this first

Local code that Signet now provides: `lib/api.ts`, `auth.ts`. **No local UI
components at all**, so nothing to delete or visually diff.

Already on current versions: `better-auth@^1.7.5`, `biome@latest`,
`typescript@latest`. Nothing to bump.

Steps:
1. Replace `apps/web/lib/api.ts` with `createApiClient` from `@dapplelight/signet-lib/api`.
2. Adopt the error envelope: `errorHandler` + `parseBody` from
   `@dapplelight/signet-server/http` in `apps/api`.
3. Adopt `socialProviders` from `@dapplelight/signet-server/auth/better-auth`; its
   provider-skip logic came from app-b. `betterAuthDefaults` is optional
   here: it now defaults to Better Auth's own behaviour, but app-b's
   config (BETTER_AUTH_URL, a comma list of origins) may already be all it needs.
   An earlier version of this step said behaviour was unchanged. It was not —
   the defaults were app-a's, including a disabled OAuth state check.
4. Optionally adopt `@dapplelight/signet-server/middleware` for cors and rate-limit.

Risk: low. No UI, no version jumps, and it already shares the conventions.

## app-a — large, do this second

29 local UI components — **exactly the set Signet was extracted from**, so this
is mostly deletion. Plus 16 modules with Signet equivalents: `lib/api.ts`,
`format.ts`, `query-client.ts`, `utils.ts`, `env.ts`, `runtime-env.ts`,
`sentry.ts`, `email.ts`, `notify.ts`, `validate.ts`, `auth.ts`, and the five
middlewares.

### Behaviour changes to expect — this is not a pure refactor

Signet's copies were **deliberately changed** during extraction. Migrating app-a
adopts those changes:

- **Every `<Badge>` changes colour.** The default variant went from
  `bg-accent-green` to `bg-primary`. That was a finance convention leaking into
  a generic component, but app-a is the product where it looked intentional.
  Expect a visible diff; decide whether app-a wants `variant="default"` or an
  explicit green variant at each call site.
- **`trend-chip` moved** out of the barrel to `@dapplelight/signet-ui/domain/trend-chip`.
  Imports must be updated; it is no longer exported from the index.
- **Badges become pills.** `rounded-4xl` referenced an undefined
  `--radius-4xl` and silently produced no radius. Now `rounded-full`.
- **`--color-cat-*` moved** to `@dapplelight/signet-tokens/finance.css`. Import that instead
  of `editorial.css` or the category colours vanish.
- **`getRuntimeEnv()` behaviour changed.** app-a's short-circuited to
  `process.env` whenever Bun was present, discarding injected Workers values.
  Signet's merges both, injected winning. Verify nothing depended on the old
  behaviour.
- **Validation errors move.** app-a stringified `flatten()` into the message
  field; Signet puts it in `details`. Any client code doing `JSON.parse` on an
  error message breaks and should read `ApiError.details.fieldErrors`.

### Version jumps required

app-a is on `typescript@^5.8.3`, `vite@^6.3.2`, `@tanstack/react-table@^8.21.3`,
`react-day-picker@^9.14.0`, `better-auth@1.6.9`, `date-fns@^4.1.0`.

Signet is on TS 7, Vite 8, react-table 9, day-picker 10. Three are breaking:

- **TypeScript 7** removed `baseUrl` — every tsconfig using it needs `paths`.
- **react-table 9** is opt-in features and a renamed API. app-a has its own
  table call sites beyond `data-table.tsx`; each needs the same treatment.
- **react-day-picker 10** renamed the `table` classname slot to `month_grid`.

`date-fns` can be dropped — `@dapplelight/signet-lib/format` uses `Intl`.

### Suggested order

1. Bump app-a to the Signet versions **first, on its own branch**, and get it
   green. Do not mix a version migration with a package migration.
2. Swap `packages/ui` for `@dapplelight/signet-ui`, import `finance.css`, review the Badge
   diff visually.
3. Swap the server modules one at a time, `env` and `middleware` first
   (mechanical), `auth` last (highest risk). `betterAuthDefaults` no longer
   defaults to app-a's settings. To keep app-a's current behaviour exactly, pass
   them explicitly — and reconsider the first two:
   ```ts
   betterAuthDefaults(env, {
     sessionSeconds: 30 * 24 * 60 * 60,
     cookieCacheSeconds: 300,        // a deleted account stays signed in up to 5 min
     skipStateCookieCheck: true,     // disables the OAuth state CSRF check
     rateLimit: { window: 60, max: 10 },
   })
   ```
4. Delete the local copies only once each swap is green.

### Why not a big-bang migration

app-a has no test suite I have verified. Every change above is individually
recoverable; combined, a regression has too many candidate causes.
