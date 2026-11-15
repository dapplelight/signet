### signet-tokens: theme builder and per-component density

- New `./theme` export: `buildTheme({ brand, base?, mode?, density? })` derives every colour token (primary, surfaces, text, borders, status accents, charts, focus, and money on `finance`) for light and dark from one brand colour, in OKLCH. Text tokens are guaranteed WCAG 4.5:1 on the surfaces they sit on (focus and charts 3:1); any token moved to get there is listed in `adjustments`.
- `toCss(theme)` writes a theme file that imports its base and overrides its colours; `toDesignTokens` / `fromDesignTokens` write and read W3C Design Tokens (DTCG 2025.10) JSON; `toFigmaVariables` gives the Figma Variables API body.
- Density: `data-density="compact" | "comfortable" | "spacious"` on any element, and `--density-<slot>` tokens (button, input, textarea, select-trigger, badge, card, tabs-list, dialog-content, sidebar) for one component everywhere. The themes' `--spacing` now carries two multipliers that default to 1, so every shipped theme looks exactly as before.

### signet-mcp: build_theme

- New `build_theme` tool: a theme from a brand colour as CSS, Design Tokens or Figma Variables, with its adjustments and a contrast re-check.

### signet-cli: signet theme

- `signet theme <hex> [--base] [--mode] [--density] [--format css|tokens|figma] [--out]`, and `--import tokens.json` to turn a token file back into CSS.
