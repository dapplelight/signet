### signet-tokens: validateTheme lists missing and extra theme variables

- New `validateTheme(css)` in `@dapplelight/signet-tokens/theme`. Tailwind drops
  a utility whose variable is undefined without a word, so a theme with a hole
  renders transparent instead of failing. `validateTheme` returns
  `{ ok, missing, extra }`: the contract-required variables the CSS never
  defines, and any `--color-*` name that is not in the contract (usually a typo).
  `ok` is true when nothing required is missing. No migration needed.
