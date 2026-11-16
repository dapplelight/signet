### create-signet-app: web template ships i18n (i18next)

New web apps keep every string in `src/locales/en.json` and read it with `useTranslation()` (`i18next` + `react-i18next`, app dependencies; Signet's own packages stay library-free). The browser language picks the file, English is the fallback, and `?pseudo=1` in dev shows accented, padded text so missed strings and cut-off text stand out in review screenshots. A new language is a new JSON file plus one line in `src/lib/i18n.ts`.

### mcp: scaffold_files includes the web template's PWA and i18n dependencies

`scaffold_files` for the web template now lists the same dependencies as `create-signet-app`.
