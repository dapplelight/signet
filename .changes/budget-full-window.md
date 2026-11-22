### signet-ai: a full budget window refuses the next call

- `canSpend` now refuses once spent reaches the cap (global or per key), even with a 0 estimate. Before, a call without `budget.maxCostUsd` got through a window that was exactly full. The cap only holds tightly when calls set `budget.maxCostUsd`; this is now documented.
