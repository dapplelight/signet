### signet-db: AI spend caps hold the estimate before a call

- `createAiSpend` gains `reserve(subject, units)` and `ledger.reserve(estimateUsd, at, key)`. signet-ai's extractor uses it when a call passes `budget.maxCostUsd`, so parallel calls can no longer all pass a cap that has room for one. Without `maxCostUsd` nothing is held and calls can still overshoot by their own cost.

### create-signet-app: the AI summary route sets maxCostUsd

- `POST /api/ai/summary` passes `budget.maxCostUsd`, and a test fires 20 parallel calls at a cap with room for one. In an app you already scaffolded, add `maxCostUsd` (the most one call can cost) to your `extract` calls' `budget`, and update signet-db.
