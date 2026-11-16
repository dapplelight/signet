### ui: SkipLink

- `SkipLink` (from `skip-link`): a "Skip to content" link, hidden until focused with Tab, that jumps to `#main` (or `target`). Label comes from `useLabels().skipToContent`.

### create-signet-app: skip link in the web template, missing label keys

The root layout renders `SkipLink` first and gives `<main>` `id="main"`. `src/locales/en.json` gains the `signet` keys SchemaForm and SkipLink use (`submit`, `addItem`, `removeItem`, `chooseOption`, `skipToContent`). Needs `@dapplelight/signet-ui` ^0.3.5.

### mcp: scaffold_files includes the template's skip link
