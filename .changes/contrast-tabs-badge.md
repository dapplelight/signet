### signet-ui, signet-tokens: inactive tabs and destructive tints reach 4.5:1

- `TabsTrigger`: inactive text is `text-text-primary/65` (was `/60`) in light
  and `text-text-primary/55` (was `text-text-muted`) in dark. It measured
  4.3:1 on the tab list in editorial and finance light, editorial dark and
  cinematic dark.
- `cinematic.css` light: `--accent-red` is `#be123c` (was `#e11d48`). Red
  text on its own 10% tint (destructive `Badge`, `Button` and `Alert`)
  measured 3.7:1. `--destructive` and `--accent-red-subtle` are unchanged.
- The tokens contrast test now also checks text painted with an opacity
  modifier, reading the alphas from the component source, so a class or a
  token change that drops these below 4.5:1 fails.
