### signet-lib: typed client timeouts and streaming

- `createRpcClient` takes `timeoutMs`: each attempt's wait for response headers is bounded, and the request is aborted through its `AbortSignal` (raced too, so a custom `fetch` that ignores the signal still times out). `timeout(ms, init?)` passed as hc's `init` replaces it for one call; `timeout(0)` turns it off.
- New `TimeoutError` (and `isTimeoutError`): an `ApiError` with status 408 and code `TIMEOUT`, carrying `timeoutMs` and the request id. A timed-out GET or HEAD counts toward `retries`; other methods are never retried. A caller's own abort stays an abort.
- `ApiError.name` is now typed `string` rather than the literal `"ApiError"`, so subclasses can name themselves.
- New streaming readers in `./api`: `readText`, `readNdjson<T>`, `readSse` and `readSseJson<T>`, async iterators over any `Response`. `readSseJson` stops at `[DONE]` and reads signet-ai's `streamChat` response directly. Breaking out of a loop cancels the body.

### signet-ai: persistent caches and cost saved

- The cache key now covers the model: `createExtractor` adds its provider chain (`name/model` of each provider, in order) to the schema, instructions and input. `cacheKey` takes an optional fourth `model` argument; without it the key is unchanged. Existing cached entries miss once after upgrading.
- `kvCache` also takes a Cloudflare Workers KV namespace directly (`kvCache(env.AI_CACHE)`), writing with `expirationTtl` floored at KV's 60-second minimum; expiry is still checked on read.
- A cache hit is reported to `onUsage` with `cacheHit: true`, `costUsd: 0` and `savedUsd`, the original call's cost. `UsageReport` gains both optional fields, and `analyticsUsage` writes them as props.
- A cache that throws no longer fails the call: a failed read is a miss and a failed write is dropped, each emitting `ai.cache_error` to `onEvent`. Before, a failed write after a paid answer could fail over and pay again.

### signet-db: AI answer cache

- New `aiCache()` table in `./columns/sqlite` and `./columns/pg`, and `dbCache(db, table)` plus `pruneAiCache(db, table)` in the core: a persistent `Cache` for signet-ai's `createExtractor` on SQLite, D1 or Postgres. Expired or unreadable rows are misses; with a cipher on the db the entry is stored encrypted.

### signet-mcp: recipes

- The `add-api-client` recipe is found by "timeout", "streaming", "sse" and "ndjson"; `add-ai-extraction` includes signet-ai's "Persistent caches" section and `add-db` the "AI answer cache" section.
