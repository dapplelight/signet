### create-signet-app: observability in the full template

- The full template can turn on request logs, a span per request and `/health/live` and `/health/ready` with `OBSERVABILITY=on` (`traceMiddleware`, `requestLog`, `healthRoutes` and the logger `mixin`, wired through `createApp`'s new `observability` option). It is off by default: with the variable unset, the routes and log output are unchanged and there is no `/health`.
- New guide "Trace a Request Across Logs, Sentry and Spans", linking logs, Sentry and spans by `traceId`, Workers tracing (otel-cf-workers and Cloudflare native), AI cost, health and what is never recorded. The observability package pages now point to it, and the `skipPaths` examples use `/health/live` and `/health/ready`.
