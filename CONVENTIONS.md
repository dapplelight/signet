# Conventions

Decisions made 2026-09-22, from the audit of 23 products in `~/projects`.

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, strict | 8,775 `.ts` + 4,599 `.tsx` vs 123 `.js`/`.jsx`. Not a decision so much as an observation. |
| Framework | Vite + React SPA | 13 of 23. Next.js only 2, both incidental. |
| Styling | Tailwind v4 + `@dapplelight/signet-tokens` | Already 12 of 23; v3 stragglers should move. |
| Database | **Drizzle** | Led 3 families to Prisma's 1, and the only ORM that runs properly on Workers. `app-i` migrates off Prisma eventually. |
| Toast | **sonner** | Already in 3 families. `RoomToast` and the hand-rolled one go. Building our own means re-solving stacking, swipe and a11y. |
| Lint + format | **Biome** | One binary replacing eslint + prettier + a five-package plugin graph. Biome covers the react-hooks rules (`useExhaustiveDependencies`, `useHookAtTopLevel`), so the objection to it did not hold. |
| Forms | **TanStack Form** + zod | Zero of 23 used any form library. Coherent with the TanStack Query already in 7 families, and `@dapplelight/signet-lib/form` closes the loop with the server error envelope. |
| Backend | Hono + Workers | 4 families on Hono, 5 on wrangler. |
| Errors | `@dapplelight/signet-lib/api` envelope | `{ success: false, error, code?, details? }`, written by `@dapplelight/signet-server/http`. |
| Analytics | Cloudflare, two tiers | See `packages/lib/ANALYTICS.md`. Nothing in app-a or app-e. |

## Why Biome, specifically

The eslint config in the existing repos crashes on current plugin versions:

```
TypeError: Cannot read properties of undefined (reading 'recommended')
```

`reactHooks.configs.flat.recommended` was removed in `eslint-plugin-react-hooks`
5.2. Those repos only still work because their lockfiles pin older versions —
copying that config into anything new breaks immediately. It had been
copy-pasted into exactly 8 of 23 repos, identical counts for all five packages.

Biome removes the plugin graph that rotted.

## Dependency versions

Pinned to latest as of 2026-09-22 and verified by building, not by assumption.
Three majors broke real code and were fixed rather than pinned back:

- **TypeScript 7** removed `baseUrl`. The scaffold's `tsconfig.app.json` now
  uses `paths` alone.
- **@tanstack/react-table 9** made features opt-in and renamed the API.
  `data-table.tsx` now declares `columnSizingFeature`, `columnResizingFeature`,
  `columnVisibilityFeature` and `rowSelectionFeature` explicitly; the core row
  model is built in and no longer passed. The per-column `TValue` generic is
  gone from the public surface, because v9's `useTable` is typed against
  `ColumnDef<…, unknown>`.
- **react-day-picker 10** renamed the `table` classname slot to `month_grid`.

Run `bun run test` in every package after any bump. The suites caught all three.

## Signet ships a default for everything it owns

Where Signet defines a behaviour — an error code, the envelope's message, the
429 text, a guard's failure, a validation message, a retry policy, a
notification template — it ships a working, product-neutral default **and** an
override point: an option, a spreadable object, or a callback. An app then
writes only what its product needs to say differently, never the same
boilerplate every other app writes.

Example: `DEFAULT_ERROR_COPY` in `@dapplelight/signet-lib/api`. An app spreads it,
overrides a few entries and adds its own codes, and `satisfies
Record<ErrorCode | AppErrorCode, ErrorCopy>` keeps it complete at compile time.

A default must not change the app's behaviour in a way it did not ask for. A
default that weakens security or delays revocation is not a default; it is an
option (see `betterAuthDefaults`).
