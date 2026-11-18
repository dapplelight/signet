### signet-db: outbox drains rows enqueued in the same millisecond

- `drainOutbox` on a Postgres server skipped a message enqueued in the same
  millisecond as the drain: `next_attempt_at` defaults to the database's
  `now()`, kept to the microsecond, while the drain compared it with a
  millisecond JS `Date`. The message waited for the next drain. Rows are now
  due up to the end of the drain's millisecond.
