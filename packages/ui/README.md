<p align="center"><img src="https://raw.githubusercontent.com/dapplelight/signet/main/docs/brand/mark-color.svg" width="72" height="72" alt="Signet"></p>

# @dapplelight/signet-ui

52 React components on Tailwind v4, in the shadcn style, styled only through
[Signet theme tokens](https://www.npmjs.com/package/@dapplelight/signet-tokens).
Swap the theme file and every component changes; no component is edited.

Part of [Signet](https://github.com/dapplelight/signet). Docs:
https://signet.dapplelight.in/

## Install

```bash
bun add @dapplelight/signet-ui @dapplelight/signet-tokens
```

```css
/* app.css */
@import "tailwindcss";
@import "@dapplelight/signet-tokens/editorial.css";
@import "@dapplelight/signet-tokens/base.css";
/* Tailwind does not scan node_modules; the kit's class names must be seen. */
@source "../node_modules/@dapplelight/signet-ui/dist";
```

```tsx
import { Button, DataTable, EmptyState } from "@dapplelight/signet-ui"
// or one component at a time, to keep the module graph small:
import { Button } from "@dapplelight/signet-ui/components/button"
```

Peer dependencies: React 19, Base UI, Radix primitives, TanStack Table and a
few more. recharts, TanStack Hotkeys and the Markdown stack are optional.

## What is in it

- The shadcn set: button, input, dialog, drawer, popover, select, tabs, table
  and the rest. There is no `sheet` component: use `drawer` or
  `responsive-sheet` for sheets.
- Extras: a virtualised `data-table`, `combobox`, `stat-strip`,
  `responsive-sheet`, `markdown` (safe by default), `emoji-picker`.
- Basics on UI SDK behaviours (see below): `toast`, `alert-dialog`, `field`,
  `avatar`, `radio-group`, `command` (with a ⌘K `CommandDialog`), `timeline`,
  `stepper`, `sidebar`, `breadcrumb`, `spinner`. `toast` has sonner's API
  (`toast()`, `toast.success()`, `<Toaster position closeButton />`), so the
  `create-signet-app` template's sonner Toaster can be swapped for it by
  changing two imports.
- `domain/` components that carry product vocabulary, such as `trend-chip`,
  kept out of the main barrel. `domain/job-runs` is a table of background-job
  runs (status, attempts, error, retry and cancel) on `data-table`; it takes
  plain rows such as signet-server's `jobs.status(id)` and callbacks.
  `domain/upload` is a drag-and-drop uploader with per-file progress (XHR to
  a presigned URL), retry, and size/type hints; `getTarget` and `onUploaded`
  talk to your server.
- `screens/admin-screens`: `AdminScreen`, an admin panel generated from
  signet-db's `defineAdmin` metadata over signet-server's `adminRoutes`
  (`createAdminApi({ baseUrl: "/admin" })`): table list, server sort,
  filters, search and cursor pages, deleted rows, a record form built from the
  column types, create, bulk delete, row actions and the audit trail. Every
  part is exported (`AdminPanel`, `AdminTable`, `AdminRecordSheet`…) with
  `useAdmin()` for your own.
- `screens/billing-screens`: `BillingScreen` and `Paywall` on signet-db
  entitlements and signet-payments: plan picker (web and store plans,
  monthly / yearly), current plan with `currentPeriodEnd` and source, restore
  purchases, usage meters, GST invoice links and a wallet balance.
  `plansFromEntitlements(definePlans(...), display)` builds the plan list.
- `screens/growth-screens`: `WaitlistJoin` (with the place in line),
  `InviteAccept`, `ReferralCard`, `OnboardingChecklist`, `FeedbackWidget` /
  `FeedbackForm` and `WhatsNew`, shaped like signet-db's growth results.
- Every screen takes plain data and callbacks, so any client fits
  (`createRpcClient`, fetch). Strings come from `DEFAULT_*_LABELS` and the
  `labels` prop. Demo: `apps/showcase/screens-ops.html` (`?screen=`,
  `?theme=`, `?dark=1`).

## Behaviours and recipes

The basics are built from behaviours: keyboard, focus, selection, dismissal
and the ARIA they need. [UI SDK](https://ui-sdk.dev) (`@ui-sdk/core` and
`@ui-sdk/react`, pinned to an exact beta) implements them inside this package;
nothing from it appears in signet-ui's exports, so it can be replaced here
without an app changing. Each component's source starts with its recipe:

| Component | Recipe |
|---|---|
| `toast` | live-region + timers + swipe + dismiss + shortcut (F6) |
| `alert-dialog` | popup + focus-trap + dismiss |
| `field` | field-wiring (label names, description and error describe, aria-invalid) |
| `avatar` | image-loading |
| `radio-group` | selection + roving-focus |
| `command` | selection + typeahead + filter; `CommandDialog` adds popup + focus-trap + dismiss + shortcut + controllable-state |
| `timeline` | roving-focus |
| `stepper` | roving-focus + status |
| `sidebar` | disclosure + controllable-state + shortcut; on phones the Drawer's popup + focus-trap + dismiss + swipe |
| `breadcrumb` | landmark |
| `spinner` | live-region |
| `screens/billing-screens` | selection + roving-focus + controllable-state + live-region |
| `screens/growth-screens` | selection + roving-focus + controllable-state + popup + dismiss + live-region + field-wiring |
| `screens/admin-screens` | selection + controllable-state + popup + focus-trap + dismiss + roving-focus (tabs) + field-wiring |

`@dapplelight/signet-ui/behaviors` exports the behaviours a new component
needs directly, with Signet's own types: `useShortcut(keys, handler)` and
`useShortcutLabel(keys)` ("mod+k" is ⌘ on Apple platforms, Ctrl elsewhere),
`useControllableState({ value, defaultValue, onChange })`, and
`matchScore(text, query)`, the fuzzy score Command ranks by.

`Field` takes a TanStack Form field's `state.meta.errors` as `errors`, the same
shape `@dapplelight/signet-lib/form` reads. `Command` takes `filter={false}`
with your own results, so a `@dapplelight/signet-lib/search` result list can
drive it.

## Customising

Every basic follows the same contract, and a new component should too:

- **Tokens only.** Colours, radii and type come from theme utilities
  (`bg-popover`, `text-text-muted`, `border-border`, `rounded-lg`); never a hex
  value or a stock palette colour.
- **`className` on every part**, merged over the defaults with `cn`
  (tailwind-merge), so a later class wins. Composite components take
  `classNames` per part (`Toaster`, `Stepper`) or a named class prop
  (`backdropClassName`, `wrapperClassName`, `contentClassName`).
- **State as `data-*`.** Style any state from CSS: `data-open`,
  `data-highlighted`, `data-checked`, `data-disabled`, `data-invalid`,
  `data-complete` / `data-current` / `data-upcoming`, `data-state`.
- **All text overridable** for translation: `label`, `closeLabel`, `title`,
  `description`, `aria-label` have English defaults and are props.
- **Parts are exported** one by one (`SidebarHeader`, `CommandItem`…), and
  `render` swaps a part's element (`render={<Button variant="destructive" />}`,
  `render={<Link to="/" />}`).
- **Controlled or not.** Stateful parts take `open` / `value` with
  `onOpenChange` / `onValueChange`, or `defaultOpen` / `defaultValue`.

## Build a new component

When signet-ui has no component for a need, build it in this package from
`signet-ui/behaviors` and theme tokens, the way `sidebar` and `stepper` are:

1. Write its recipe first: which behaviours it needs (popup, dismiss,
   focus-trap, selection, roving-focus, typeahead, filter, shortcut,
   controllable-state, live-region). Put it as the `// Recipe:` line at the
   top of the file; signet-mcp's `compose_component` reads it.
2. Reuse a signet-ui part that already has the behaviour (Drawer and Dialog
   for popups, Timeline for roving focus over a list, Command for filtering)
   before reaching for a new one. Take state and shortcuts from
   `signet-ui/behaviors`. Import `@ui-sdk/*` only inside this package, never
   in its exported types.
3. Style with token utilities and the customising contract above.
4. Add keyboard, focus and ARIA tests to `test/basics.tsx`; the tokens package
   test compiles every theme against the new classes. Export it in
   `package.json` and add a demo to `apps/showcase`. The MCP index and
   API.md regenerate on their own (see CONTRIBUTING.md).

The full export list is in
[API.md](https://github.com/dapplelight/signet/blob/main/API.md).

## License

MIT
