<p align="center"><img src="https://raw.githubusercontent.com/dapplelight/signet/main/docs/brand/mark-color.svg" width="72" height="72" alt="Signet"></p>

# @dapplelight/signet-ui

41 React components on Tailwind v4, in the shadcn style, styled only through
[Signet theme tokens](https://www.npmjs.com/package/@dapplelight/signet-tokens).
Swap the theme file and every component changes; no component is edited.

Part of [Signet](https://github.com/dapplelight/signet). Docs:
https://dapplelight.github.io/signet/

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

- The shadcn set: button, input, dialog, sheet, popover, select, tabs, table,
  toast and the rest.
- Extras: a virtualised `data-table`, `combobox`, `stat-strip`,
  `responsive-sheet`, `markdown` (safe by default), `emoji-picker`.
- `domain/` components that carry product vocabulary, such as `trend-chip`,
  kept out of the main barrel.

The full export list is in
[API.md](https://github.com/dapplelight/signet/blob/main/API.md).

## License

MIT
