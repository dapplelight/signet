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
  `domain/amount` formats money: the locale's grouping (₹12,50,000 in
  en-IN), the currency's own decimals, minor units and bigints exactly,
  compact lakh/crore ("₹12.5L", "₹1.2Cr"), a sign, and `tone` colours from
  the theme's `--money-*` slots (falling back to the status accents), with a
  class per part (`currency`, `integer`, `fraction`…). `domain/kanban` is a
  board whose cards move between columns by pointer drag or keyboard (Space
  picks up, arrows move, Space drops, Escape cancels), announced in a live
  region; the board is a plain `{ column: ids[] }` object.
- Hooks, one subpath each: `hooks/use-media-query`, `hooks/use-debounce`,
  `hooks/use-local-storage` (JSON, SSR-safe, synced across tabs),
  `hooks/use-copy` (clipboard with a `copied` flag) and
  `hooks/use-intersection` (on screen or not, for lazy loading).
- `screens/` ready screens, out of the barrel: `auth-screens` (sign in / up
  by email or phone code, OAuth, verify, session expired), `account-screens`
  (profile, devices, API keys), `notification-screens` (inbox, preferences)
  and `privacy-screens` (DPDP consents, export and erasure requests). Plain
  data in, callbacks out, shaped like signet-server and signet-db; wire them
  through `createRpcClient`. Strings come from `DEFAULT_*_LABELS` and the
  `labels` prop; parts take `className`, composites `classNames`. Demo:
  `screens-user.html` in the showcase (linked from its header).
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
- `screens/monetisation-screens`: `RemotePaywall` renders the server's
  offering (signet-db `createOfferings`: copy, plans shown, highlighted plan
  and badge, trial text, button text, prices per store) on the `Paywall`
  parts and hands the matching product to your checkout;
  `plansFromOffering(offering, source, display)` is the plan list it uses.
  `CustomerCenter` is the self-serve page on signet-db `createCustomers`:
  plan and renewal date, cancel with the retention offer first, a store
  manage link instead for App Store and Google Play, refund request and
  contact support. `CustomerTimeline` is the admin view of one customer's
  purchases, renewals, refunds, cancellations, billing issues and grace
  periods across stores and web, with ledger totals. `RemotePaywall` shows
  the customer's best offer (free trial, intro or win-back, from
  `customers.withOffers`), passes it to `onPurchase`, and calls
  `onImpression` once per offering version for paywall conversion;
  `PromotionalGrantForm` grants a plan for some days from admin.
- `screens/subscription-charts`: `SubscriptionCharts` on signet-db
  `createCharts`: MRR per currency (and a converted total), active
  subscribers and trials, new versus renewal revenue and refunds, churn and
  trial conversions, paywall views against conversions, with filters by
  store, plan, country and offering, saved audiences and a CSV link. Needs
  recharts (optional peer), so it is its own export path.
- `screens/growth-screens`: `WaitlistJoin` (with the place in line),
  `InviteAccept`, `ReferralCard`, `OnboardingChecklist`, `FeedbackWidget` /
  `FeedbackForm` and `WhatsNew`, shaped like signet-db's growth results.
- `screens/workflow-screens`: `WorkflowRunTimeline` (run status, who or
  what it is waiting on, every step with retries and decisions, cancel) and
  `ApprovalInboxCard` (approve / reject with a reason), shaped like
  signet-db's `wf.get(id)` and `wf.pendingApprovals(user)`.
  Demo for these four: `screens-ops.html` in the showcase (`?screen=`,
  `?theme=`, `?dark=1`).
- `screens/org-screens`: `OrgSwitcher`, `MembersList` (roles, remove, leave,
  pending invites), `InviteDialog` (one-time link with Copy),
  `AcceptInvitePage` (a page around `InviteAccept`) and `OrgSettings` (name,
  theme, brand colour with a `buildTheme` preview), shaped like
  signet-server's `orgRoutes` responses. Demo: `screens-orgs.html`.
- `screens/collab-screens`: `CommentThreads` (threads, replies, edit with
  an "edited" marker, delete, a composer), `MentionTextarea` (type `@` for a
  member picker; the body stores `@[Name](user:<id>)`, so a rename never
  breaks a mention), `ActivityFeed` ("Asha changed status to Done", comments,
  Load more) and `VersionHistory` (versions, a field diff, Restore, Undo with
  the server's conflict message), shaped like signet-db's `createCollab` and
  signet-server's `collabRoutes`. Demo: `screens-collab.html`.
- `screens/abuse-screens`: `CaptchaWidget` (loads Cloudflare Turnstile or
  hCaptcha and reports the token for signet-server's `requireCaptcha`;
  `provider="test"` reports the test token with no script) and
  `AiSpendAdmin` (spend against caps today and this month, top users and
  orgs, set and remove caps), shaped like signet-server's
  `aiSpendAdminRoutes`.
- Real-time: `hooks/use-channel` and `screens/realtime-screens`, see
  [Real-time](#real-time). Demo: `screens-realtime.html`.

### Real-time

On signet-server's realtime hub (`@dapplelight/signet-server/realtime`).
`hooks/use-channel` has `createRealtimeClient` (reconnects with backoff,
rejoins resuming from the last event, pings on the hub's heartbeat, drops
duplicate events, applies shared state by version), `useChannel(client,
channel, { onEvent })` (presence, shared state, `set`, `setTyping`,
`setEditing`, and `stale` / `conflict` flags with `acknowledge`),
`usePresence` and `useRecordChanges`. `screens/realtime-screens` has
`AvatarStack`, `EditingBadge`, `TypingIndicator` (a polite live region) and
`RecordChangedBanner` ("this record changed, reload?"); strings come from
`DEFAULT_REALTIME_LABELS` and the `labels` prop.

```tsx
const live = createRealtimeClient({ url: `/realtime?org=${orgId}` })
function Doc({ id, me }) {
  const ch = useChannel(live, `record:docs:${id}`)
  const { changed, change, dismiss } = useRecordChanges(live, `record:docs:${id}`, { selfId: me })
  return (<>
    <RecordChangedBanner changed={changed} by={change?.data?.name} onReload={() => { refetch(); dismiss() }} />
    <AvatarStack members={ch.members} selfId={me} />
    <EditingBadge members={ch.members} selfId={me} field="title" />
    <input onFocus={() => ch.setEditing("title")} onBlur={() => ch.setEditing(null)} onInput={() => ch.setTyping(true)} />
    <TypingIndicator members={ch.members} selfId={me} />
  </>)
}
```

A user removed from the org or whose session expired is not reconnected
(close codes 4003 and 4001); anything else reconnects with backoff.

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
| `screens/monetisation-screens` | selection + roving-focus + controllable-state + live-region |
| `screens/subscription-charts` | field-wiring (labelled filters) + controllable-state (filters) |
| `screens/growth-screens` | selection + roving-focus + controllable-state + popup + dismiss + live-region + field-wiring |
| `screens/workflow-screens` | roving-focus (timeline) + live-region + field-wiring |
| `screens/org-screens` | popup + dismiss + live-region + field-wiring + controllable-state |
| `screens/collab-screens` | combobox (mention picker: aria-activedescendant, arrows, Enter/Tab, Escape) + live-region |
| `domain/amount` | money-format + tone (colour from the `--money-*` slots) |
| `domain/kanban` | controllable-state + live-region + drag + keyboard-move |
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
