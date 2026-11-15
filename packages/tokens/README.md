<p align="center"><img src="https://raw.githubusercontent.com/dapplelight/signet/main/docs/brand/mark-color.svg" width="72" height="72" alt="Signet"></p>

# @dapplelight/signet-tokens

Themes for [Signet](https://github.com/dapplelight/signet) as plain CSS
variables: colour, radius, type, shadow and motion. A theme is one CSS file
that defines the variables in the
[theme contract](https://github.com/dapplelight/signet/blob/main/packages/tokens/CONTRACT.md).
Docs: https://signet.dapplelight.in/

## Themes

| File | Look |
|---|---|
| `editorial.css` | warm paper, ink text, green accent |
| `cinematic.css` | cool neutrals, violet accent |
| `finance.css` | editorial plus money and spend-category slots |

Each has light and dark (the `.dark` class). Every text pair meets WCAG AA,
and a test checks it.

## Use

```css
@import "tailwindcss";
@import "@dapplelight/signet-tokens/editorial.css";
@import "@dapplelight/signet-tokens/base.css";
```

`base.css` adds the body defaults, focus outline, the overlay animations
(`tw-animate-css`) and a reduced-motion rule.

## Make your own theme

From one brand colour:

```ts
import { buildTheme, toCss, toDesignTokens, toFigmaVariables } from "@dapplelight/signet-tokens/theme"

const theme = buildTheme({ brand: "#e11d48", base: "cinematic" }) // mode: "light" | "dark" | "both"
toCss(theme)            // a theme file: imports the base, overrides its colours in light and dark
theme.adjustments       // tokens moved to reach WCAG 4.5:1 (text) or 3:1 (focus, charts)
toDesignTokens(theme)   // W3C Design Tokens JSON; fromDesignTokens(json) reads it back
toFigmaVariables(theme) // body for Figma's POST /v1/files/:key/variables
```

Or `signet theme "#e11d48" --base cinematic > src/brand.css`, and import that
file in place of the base theme. Every text token is checked against every
surface it sits on, so a pale brand comes back darker in light mode, with the
change listed.

By hand: copy a theme file, change the values, and keep every variable the
contract lists. `@dapplelight/signet-ui` reads only these variables, so the
components follow.

## Density

`data-density="compact"` (or `comfortable`, `spacious`) on any element tightens
or loosens the spacing of everything inside it. `--density-button: 0.8` (and
`input`, `card`, `badge`, ... see CONTRACT.md) on `:root` does it for one
component everywhere. Nothing set means the theme's normal spacing, unchanged.

## License

MIT
