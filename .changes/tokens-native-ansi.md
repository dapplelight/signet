### signet-tokens: `./native` and `./ansi`

- New `./native`: every theme's tokens as plain JS for React Native (`nativeTheme(name, mode)`, `NATIVE_THEMES`, `THEME_NAMES`), with colours as `#rrggbb` or `rgba()` strings and radii, spacing and font sizes as numbers. Generated from the theme CSS by `bun run gen:native`; the test fails when the committed data drifts from the stylesheets or a theme leaves a CONTRACT.md colour unresolved.
- New `./ansi`: `ansi(name, { mode, depth })` gives `fg`/`bg` painters per token in truecolor or the nearest xterm 256 colour, with translucent tokens flattened onto the background. `nearest256`, `ansiCode` and `RESET` are exported too.
