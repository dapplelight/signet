### signet-ai (minor) and signet-db: canSpend says which limit fired

- Breaking: `ledger.canSpend` returns `{ ok: true }` or `{ ok: false, limit: "global" | "key", retryAfterSeconds }` instead of a boolean. Migration: replace `if (await ledger.canSpend(...))` with `if ((await ledger.canSpend(...)).ok)`.
- The extractor's `AI_BUDGET_EXCEEDED` error now says whether the global or the per-key limit stopped the call, and carries `retryAfter` (seconds until the oldest spend leaves the window), which `errorHandler` sends as `Retry-After`.
- `BudgetStore` gains an optional `oldestAt(key, windowSeconds, now)`; the memory, KV and Durable Object stores implement it. A custom store without it makes `retryAfterSeconds` a whole window.
- signet-db: `createAiSpend().ledger.canSpend` returns the same shape; `retryAfterSeconds` is the time until the day or month resets.
