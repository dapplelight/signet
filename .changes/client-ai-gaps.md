### signet-lib: typed client timeouts and streaming

- `createRpcClient` takes `timeoutMs`: each attempt's wait for response headers is bounded, and the request is aborted through its `AbortSignal` (raced too, so a custom `fetch` that ignores the signal still times out). `timeout(ms, init?)` passed as hc's `init` replaces it for one call; `timeout(0)` turns it off.
- New `TimeoutError` (and `isTimeoutError`): an `ApiError` with status 408 and code `TIMEOUT`, carrying `timeoutMs` and the request id. A timed-out GET or HEAD counts toward `retries`; other methods are never retried. A caller's own abort stays an abort.
- `ApiError.name` is now typed `string` rather than the literal `"ApiError"`, so subclasses can name themselves.
- New streaming readers in `./api`: `readText`, `readNdjson<T>`, `readSse` and `readSseJson<T>`, async iterators over any `Response`. `readSseJson` stops at `[DONE]` and reads signet-ai's `streamChat` response directly. Breaking out of a loop cancels the body.

### signet-mcp: recipe keywords

- The `add-api-client` recipe is found by "timeout", "streaming", "sse" and "ndjson".
