# Using @dapplelight/signet-db as an agent

Two cases: you are **writing app code** that uses the package, or you are
**an agent acting on a user's data** through the tools it generates.

## Writing app code

- Read the schema first: `describeSchema(schema)` (text) or
  `describeSchema(schema, { format: "json" })`. It marks owner (`userId`),
  soft-delete, money and encrypted columns, keys and relations.
- Every request-path read or write goes through `scoped(db, { userId })`.
  Do not query `db.orm` directly for user data; if you must, add
  `ops.where(table, extra)` to the query.
- Money is integer minor units plus a currency column. Never store or add
  floats; use `addMoney`, `sumMoney`, `formatMoney`.
- Encrypted columns cannot be filtered on. Read them through `scoped`.
- Validate request bodies with `toZod(table, { mode: "insert" | "update" })`.
- Wrap writes that change something a person cares about in
  `audited(...)`; machine jobs use `{ actor: { type: "system", id } }`.
- New migration? Run `signet-db-check` on the new SQL files before committing.
- Errors are `SignetDbError`; branch on `e.code`, and the message says how to
  fix it.

## Acting on a user's data

Tools come from `agentTools(db, { tables, userId, allowWrites, maxRows })`.

- You only ever see one user's rows; there is no tool to reach another user.
- `<table>_list`, `<table>_get`, `<table>_search` read. Results are capped
  at `maxRows`; page with `offset`. Soft-deleted rows and encrypted fields
  are not returned.
- `<table>_insert` and `<table>_update` exist only when the app enabled
  writes. Call them with `dryRun: true` first, show the person the result,
  and write only after they agree.
- Every write is recorded in the audit log as `{ type: "agent", id }`.
- A `BAD_INPUT` error lists the fields to fix; `NOT_FOUND` means the row is
  not this user's or does not exist; search before retrying.
