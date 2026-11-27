### signet-server: Sentry backs off after a 429

- `createSentry().captureException` now stops sending when Sentry answers 429, until the `Retry-After` window (60 s if the header is missing) has passed. The window is kept per isolate, so a client built per request still respects it. During the window `captureException` resolves `false` without a fetch. Before, an error storm kept posting into the rate limit and Sentry dropped more events.
