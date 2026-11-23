### signet-ai: parallel calls near the budget cap no longer all get through

- Twenty parallel `extract` calls at a ledger one call short of its cap used to all pass the check and run the bill 19 calls' cost over. `extract` now holds `budget.maxCostUsd` with the new `ledger.reserve(estimateUsd, now?, key?)` before calling the model and settles it to the real cost afterwards (a failed call releases its hold). The memory store and the Durable Object store (`BudgetCounter`) let exactly one through; `BudgetStore` gains an optional atomic `reserve`, and `record` accepts a negative amount to release a hold.
- `kvBudgetStore` has no atomic check-and-add, so it stays best-effort and is documented as such.
- A call without `budget.maxCostUsd` holds nothing; set it when parallel calls must not overshoot.
- Migration: none. Redeploy your Worker so the Durable Object class picks up the new `reserve` operation; no migration tag change.
