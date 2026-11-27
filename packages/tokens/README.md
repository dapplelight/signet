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

## React Native and Expo

`@dapplelight/signet-tokens/native` is the same themes as plain JS (hex or
`rgba()` strings, numbers for radius, spacing and font size), with no React or
React Native import. `nativeTheme` takes what `useColorScheme()` returns:

```tsx
import { useColorScheme, View, Text } from "react-native"
import { nativeTheme } from "@dapplelight/signet-tokens/native"

export function Card() {
  const t = nativeTheme("editorial", useColorScheme()) // "light" | "dark" | null | "unspecified"
  return (
    <View style={{ backgroundColor: t.colors.card, borderRadius: t.radius.lg, padding: t.spacing * 4 }}>
      <Text style={{ color: t.colors.cardForeground, fontSize: t.fontSize.base }}>Hello</Text>
    </View>
  )
}
```

Colour names are the contract's, in camelCase (`--color-card-foreground` is
`cardForeground`). `NATIVE_THEMES` holds every theme and mode at once, and
`THEME_NAMES` lists them, for a theme picker. There is deliberately no
`useNativeTheme` hook: it would pull `react-native` into this package. Wrap
the call above in your own if you want one.

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

### Check a custom theme

Tailwind drops a utility whose variable is missing without a word, so a hole in
a hand-made theme shows up as a transparent component. `validateTheme` names
the holes; `@import`s are not followed, so pass the full text:

```ts
import { validateTheme } from "@dapplelight/signet-tokens/theme"

const { ok, missing, extra } = validateTheme(css)
// missing: required variables the CSS never defines. extra: `--color-*` names
// outside the contract, usually a typo like --color-primay (palette steps such as --color-warm-500 are
// skipped). ok ignores extra.
```

## Density

`data-density="compact"` (or `comfortable`, `spacious`) on any element tightens
or loosens the spacing of everything inside it. `--density-button: 0.8` (and
`input`, `card`, `badge`, ... see CONTRACT.md) on `:root` does it for one
component everywhere. Nothing set means the theme's normal spacing, unchanged.

## License

MIT
