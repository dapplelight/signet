### signet-server: 0.6.0 publishes the observability exports

- `./http/observability`, `./observability/trace`, `./observability/request-log` and `./observability/health` were added without a version bump, so npm did not have them. 0.6.0 publishes them. No breaking change; `@dapplelight/signet-mcp` now depends on `^0.6.0`.
