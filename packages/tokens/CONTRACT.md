# Theme contract

`@dapplelight/signet-ui` reads **only** the variables below. Any file that defines all of them is a
valid Signet theme — that is the whole mechanism by which one component kit serves
products with different design systems.

**78 required, 16 optional.** `bun run test` counts the code blocks in this file
and fails if either number here, or the one in the repo's `CLAUDE.md`, drifts.

Define them inside `@theme inline { ... }` (Tailwind v4) so the class names resolve.

## Required — color

Surfaces and text:
```
--color-background  --color-foreground
--color-card        --color-card-foreground
--color-popover     --color-popover-foreground
--color-bg-base     --color-bg-surface     --color-bg-elevated
--color-text-primary --color-text-secondary --color-text-muted
--color-text-hint    --color-text-disabled  --color-text-inverse
```

Intent:
```
--color-primary     --color-primary-foreground
--color-secondary   --color-secondary-foreground
--color-muted       --color-muted-foreground
--color-accent      --color-accent-foreground
--color-destructive
```

Lines and focus:
```
--color-border  --color-border-default  --color-border-subtle  --color-border-strong
--color-input   --color-ring
```

Status (green = good, red = bad, amber = warn, blue = info — universal, not domain):
```
--color-accent-green  --color-accent-green-subtle
--color-accent-red    --color-accent-red-subtle
--color-accent-amber  --color-accent-amber-subtle
--color-accent-blue   --color-accent-blue-subtle
```

## Required — form

Geometry, type and motion.

### The size scale the components actually use

**These are the names that matter.** The components reference Tailwind's default
scale — `text-sm` ×31, `text-xs` ×9, `text-base` ×4, `rounded-lg`, `rounded-md`.
A theme that only redefines the semantic names below changes **nothing**,
because no component references them.

```
--text-xs --text-sm --text-base --text-lg --text-xl
--radius --radius-sm --radius-md --radius-lg --radius-xl --radius-2xl
--radius-4xl --radius-full
--spacing
```

`--spacing` is the base density unit. Every `h-*`, `px-*`, `gap-*` and `size-*`
in the components compiles to `calc(<spacing> * n)`, **inlined at build time**,
so this one token retunes the density of all 207 of them per theme.

This was wrong in the first version of this document. It claimed redefining the
semantic scale reshaped every component. Compiling both themes and diffing the
output showed `text-sm` resolving identically under each, because the themes
defined `--text-body` and the components said `text-sm`. `bun run test` in this
package now asserts these differ, so the claim cannot silently rot again.

### Semantic scale — for app-level use

Available to products as `text-body`, `text-headline` and so on. Components do
not use them; do not expect them to reshape anything on their own.

```
--text-caption --text-label --text-body --text-callout --text-subhead
--text-headline --text-title --text-display --text-hero --text-stat
```

### Type and motion

```
--font-sans --font-display --font-mono
--font-weight-normal --font-weight-medium --font-weight-semibold --font-weight-bold
--shadow-xs --shadow-sm --shadow-md --shadow-lg --shadow-xl
--ease-default --ease-in --ease-out --ease-spring
```

## Optional — named slots, never required

Names for things a brand layer otherwise invents (app-a's Fern layer did, for
all of these). A theme **may** define any of them; nothing requires them, and
no component in `@dapplelight/signet-ui` reads them. They exist so two products that
want a chart palette or a focus ring call it the same thing.

Each colour slot is a runtime variable `--X`, set in both the light and the
dark block like `--ring` is, and exposed to Tailwind as `--color-X: var(--X)`
so `bg-chart-1`, `ring-focus-ring` and so on work. A theme that defines a slot
must do both. The code blocks list the `@theme` names.

Generic — `editorial.css` and `cinematic.css` define these, as aliases of their
existing tokens, so an app can use them under any Signet theme:
```
--color-chart-1 --color-chart-2 --color-chart-3
--color-chart-4 --color-chart-5 --color-chart-6
--color-focus-ring --color-focus-ring-offset
--color-accent-primary --color-accent-primary-fg --color-accent-primary-subtle
--color-accent-red-fg
--leading-display
```

| Slot | Meaning | Default in the base themes |
|---|---|---|
| `--chart-1` … `--chart-6` | categorical series colours | the four status accents (blue, green, amber, red), then two theme colours |
| `--focus-ring` | focus outline colour | `var(--ring)` |
| `--focus-ring-offset` | the gap between ring and element | `var(--bg-base)` |
| `--accent-primary` / `-fg` | the brand accent and ink on it | `var(--primary)` / `var(--primary-fg)` |
| `--accent-primary-subtle` | tinted brand background | `--primary` at 10% (12–14% dark), like the other `-subtle`s |
| `--accent-red-fg` | ink on a solid `--accent-red` fill | `var(--primary-fg)` |
| `--leading-display` | line height for `text-display` / `text-hero` | editorial `1.1`, cinematic `1` |

Override the slot, not what it aliases: a layer that sets
`--ring: var(--focus-ring)` must also set `--focus-ring`, or the two form a
cycle and both become invalid.

Domain — **`finance.css` only**, never a base theme (see the domain rule in
the repo's `CLAUDE.md`):
```
--color-money-credit --color-money-debit --color-money-transfer
```

| Slot | Default in `finance.css` |
|---|---|
| `--money-credit` | `var(--accent-green)` |
| `--money-debit` | `var(--text-primary)` — spending is the normal case; not red |
| `--money-transfer` | `var(--text-muted)` |

`bun run test` checks every slot a theme defines: the runtime variable is set in
both modes, `--color-X` maps to it, the utility compiles to `var(--X)` with
nothing undefined behind it, and the money slots stay out of the base themes.

## Not part of the contract

Product-specific token sets live in the product, never here. `editorial.css` currently
still carries app-a's `--color-cat-needs / -wants / -investments / -income / -transfer`
— those are a finance taxonomy, not a design system. Strip them when app-a moves to
`@dapplelight/signet-tokens`, or keep them in a `finance.css` that imports `editorial.css`.

Tailwind's stock palettes (`--color-red-*`, `--color-green-*`, `--color-violet-*` …)
are not the theme's either. A theme sets the semantic tokens (`--destructive`,
`--accent-red` …) to the hex it wants and leaves the stock scales alone, so an
app's `bg-red-500` is Tailwind's red under every theme. `editorial.css` used to
repaint red as rose and pin green/blue/amber/emerald to v3 hexes; `cinematic.css`
did the same to violet. `bun run test` now fails if a theme defines any stock
scale variable or changes what a stock `bg-*` utility paints.

## Density — corrected

An earlier version of this document said the ~200 raw density literals (`h-8`,
`px-2`, `size-4`) "do **not** respond to this contract". **That was wrong.**
Compiling shows:

```css
.h-8  { height: calc(var(--spacing) * 8); }
.px-3 { padding-inline: calc(var(--spacing) * 3); }
```

The value comes from `--spacing` and is inlined per theme, so a theme that sets
it retunes every one of them. Editorial `0.25rem` gives `h-8` = 2rem; Cinematic
`0.3rem` gives 2.4rem. Asserted by `bun run test`.

Note it is **inlined, not a runtime `var()`** — so density cannot be flipped by
overriding a CSS variable at runtime the way colour can. It is a build-time
property of the theme.

The real limitation is narrower than claimed: density scales **globally, not
per component**. You cannot make buttons roomier while leaving table rows
tight without editing the components or adding cva size variants. That is worth
doing when a product actually needs it, and is not the blocker the earlier
wording implied.

This is the second claim in this file that compiling falsified, and the
correction itself was wrong on first attempt — it described `--spacing` as a
runtime reference, which a second compile disproved. Both original errors came
from reading the source instead of building it.

## Verified, not asserted

`bun run test` compiles Tailwind against the real `@dapplelight/signet-ui` components under
every theme and asserts that the same utility class resolves to different
values. Current results:

| Class | editorial | cinematic |
|---|---|---|
| `text-sm` | 0.8125rem | 1rem |
| `text-xs` | 0.75rem | 0.875rem |
| `text-base` | 0.875rem | 1.125rem |
| `rounded-lg` | 0.75rem | 0.1875rem |
| `rounded-md` | 0.625rem | 0.125rem |
| `rounded-full` | 9999px | 9999px — invariant, correctly |

It also asserts that no utility resolves to an undefined custom property. That
check caught `rounded-4xl` in `badge.tsx`, which referenced an undefined
`--radius-4xl` and silently produced no radius in **both** themes — a live bug
that had shipped in app-a.

## Scanning — the consuming app declares it, not the theme

A theme must **not** carry `@source`. It cannot know where it is installed, and
a hardcoded sibling path (`../../../ui/src`) resolves only inside this
monorepo. Installed from a package it points at nothing, Tailwind scans no
components, and every one of them renders **unstyled** — while the app's own
utility classes keep working, so it looks fine until you look closely.

The app declares it, after the imports, because CSS requires `@import` first:

```css
@import "tailwindcss";
@import "@dapplelight/signet-tokens/editorial.css";
@import "@dapplelight/signet-tokens/base.css";

@source "../node_modules/@dapplelight/signet-ui/dist";
```

`create-signet-app` emits this. `create-signet-app`'s test asserts the built
bundle contains `data-slot` and `.bg-primary`, which is what catches a
regression here — the theme variables alone are not evidence that components
were scanned.
