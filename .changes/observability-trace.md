### server: request tracing and request logs

- New `./observability/trace`: `traceMiddleware` starts one OpenTelemetry server span per request (method, route pattern, status, errors recorded and rethrown, incoming `traceparent` honoured), with `withSpan` and `traceContext`. It uses only `@opentelemetry/api`, now an optional peer, and is a no-op without it or without an SDK.
- New `./observability/request-log`: `requestLog` logs `request.started`, `request.completed` and `request.failed` with method, route, status, `durationMs`, `reqId` and `traceId`, and marks slow requests with `slow: true`.
- `createLogger` takes a `mixin` function whose fields are added to every line. Default off; output is unchanged without it.
- `SentryScope.traceId` is sent as the `trace_id` tag.
