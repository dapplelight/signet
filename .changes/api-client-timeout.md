### signet-lib: createApiClient timeoutMs

- `createApiClient({ timeoutMs })` aborts a request whose response headers have not arrived in time and throws `TimeoutError` (408, code `TIMEOUT`). Default none: unset, nothing changes. A caller's own `signal` that aborts stays an abort.
- A 2xx JSON response whose body does not parse now throws `ApiError("Response was not valid JSON")` instead of a raw `SyntaxError`.
