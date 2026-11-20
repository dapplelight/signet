### signet-payments: ledger posts can carry a balance floor

`post(store, tx, { floor: { "wallet:u1": 0 } })` writes nothing and throws `INSUFFICIENT_BALANCE` if the post would take that account below its floor. It holds when many posts race, on the memory store, SQLite/D1 and Postgres. On Postgres the SQL client needs the new optional `transaction` hook. A repeated `txId` is still a no-op. New guide: Add In-App Currency.
