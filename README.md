# Signet

The mark that makes it yours. One component kit, many design systems.

Extracted from `app-a/packages/ui` — 29 primitives, zero hardcoded palette colors,
every visual decision resolved through `@dapplelight/signet-tokens`.

```
@dapplelight/signet-tokens    themes; all satisfy packages/tokens/CONTRACT.md
@dapplelight/signet-ui        40 token-driven React components
@dapplelight/signet-lib       api client, format, analytics, form      (client)
@dapplelight/signet-server    auth, http, env, middleware, notify, oauth-rs  (server)
@dapplelight/signet-ai        structured LLM calls with budget, cache, failover
@dapplelight/signet-config    Biome preset + tsconfig bases (react, worker)
```

## Use

```ts
// app.css
@import "tailwindcss";
@import "@dapplelight/signet-tokens/editorial.css";
@import "@dapplelight/signet-tokens/base.css";
```
```tsx
import { Button, DataTable, EmptyState } from "@dapplelight/signet-ui"
```
Or per component, to keep the graph small:
```tsx
import { Button } from "@dapplelight/signet-ui/components/button"
```

## New design system

Copy `packages/tokens/src/themes/editorial.css`, change the values, satisfy
[CONTRACT.md](packages/tokens/CONTRACT.md). Components need no edits.

## What is deliberately not here

**Invite and marketing products do not take this as a dependency.** Seven of them
(several wedding and event sites) are restyled to the bone
each time and are structurally different — full-bleed scenes, scroll choreography.
A dependency there is a liability. Those get a copy-paste block registry instead:
`MobileFrame`, `SplashScreen`, `SceneStack`, `RSVPDrawer`, `EventList`,
`PhotoCarousel`, `MediaPlayer`, `GuestAdminTable`, `LanguageSwitcher`.

Signet serves the app/dashboard tier: app-a, app-e, app-i, app-f, app-g,
app-c.

## Beyond shadcn

`combobox` `data-table` `empty-state` `error-state` `input-group` `kbd` `pill-group`
`search-input` — hand-built, and the reason this package is worth lifting.

Lifted from app-a: `responsive-sheet` (bottom Drawer on phone, Dialog on
desktop), `stat-strip`, `answer-headline`, and `privacy-mask` (a "hide values"
toggle that keeps numbers and ratios out of the DOM). Plus the
`hooks/use-media-query` hook they use.

For big lists and documents (asked for by app-g): `data-table` takes
`virtual` rows, facet and text filters with counts, `sortable` headers,
`selectable` (checkboxes + a bulk-actions bar), `searchable` (a global search
box), `columnsMenu`, `exportFilename` (a CSV download of the current view)
and saved views; `shortcuts` adds a `?` overlay and j/k navigation on
TanStack Hotkeys; `markdown` renders untrusted Markdown safely, with anchors
and a table of contents. `shortcuts` and `markdown` need optional peers and
are not in the barrel.

Domain tier, imported explicitly, not in the barrel:
`@dapplelight/signet-ui/domain/trend-chip` (finance up/down).
