### signet-ai: budget Durable Object skips idle writes

- `BudgetCounter` now writes to Durable Object storage only when a call recorded spend or pruned an expired bucket. A plain budget check (`spent`, `oldestAt`, a refused `reserve`) no longer writes.
