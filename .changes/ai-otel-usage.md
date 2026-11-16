### signet-ai: usage to spans and spend

- New `./otel`: `otelUsage()` puts `gen_ai.*` token attributes, `signet.cost_usd`, `signet.cache_hit` and `signet.saved_usd` on the active OpenTelemetry span (the budget key only with `includeKey`). `onUsageAll(...hooks)` runs several `onUsage` hooks, each isolated. `spendUsage({ spend, subject })` records each call's cost per user or org in the spend ledger.
- `@opentelemetry/api` is an optional peer; without an SDK registered `otelUsage` does nothing. No exporter is included. If you bundle `./otel` (esbuild, wrangler, Vite), install `@opentelemetry/api` or mark it external, since the bundler resolves it at build time.
