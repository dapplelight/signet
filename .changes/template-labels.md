### create-signet-app: Signet's built-in component text goes through i18n

The web template wraps the app in `SignetLabels` (`src/components/signet-labels.tsx`), which feeds ui's `LabelsProvider` from `t()`. Every word Signet's components say by themselves ("Close", "Search…", table headers, aria labels) is now in `src/locales/en.json` under `signet`, next to the app's own text. Needs `@dapplelight/signet-ui` ^0.3.2.

### mcp: scaffold_files includes the template's SignetLabels
