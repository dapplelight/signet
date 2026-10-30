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

Copy a theme file, change the values, and keep every variable the contract
lists. `@dapplelight/signet-ui` reads only these variables, so the components
follow.

## License

MIT
