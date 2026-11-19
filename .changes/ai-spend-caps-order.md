### signet-db: `aiSpend().caps()` returns the same order on every database

It sorted with `ORDER BY id`, and a Postgres server using a locale collation put `user:a:day` before `user:*:day`. It now sorts by plain string order on every backend.
