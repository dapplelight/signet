### signet-ai (minor) and signet-db (minor): canSpend says which limit fired

- Breaking: `ledger.canSpend` returns `{ ok: true }` or `{ ok: false, limit: "global" | "key", retryAfterSeconds }` instead of a boolean. Migration: replace `if (await ledger.canSpend(...))` with `if ((await ledger.canSpend(...)).ok)`.
- Upgrade signet-ai (0.6.0) and signet-db (0.3.0) together. The new object is always truthy, so signet-ai 0.5.x checking `if (!room)` against the new signet-db ledger would allow every call and caps would never refuse.
- The extractor's `AI_BUDGET_EXCEEDED` error now says whether the global or the per-key limit stopped the call, and carries `retryAfter` (seconds until the oldest spend leaves the window), which `errorHandler` sends as `Retry-After`.
- `BudgetStore` gains an optional `oldestAt(key, windowSeconds, now)`; the memory, KV and Durable Object stores implement it. A custom store without it makes `retryAfterSeconds` a whole window.
- signet-db: `createAiSpend().ledger.canSpend` returns the same shape; `retryAfterSeconds` is the time until the day or month resets.
