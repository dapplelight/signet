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
- Admin screens and back-office APIs: `defineAdmin(schema, { authorize })`
  from `./admin`, never hand-rolled unscoped queries. `authorize` decides;
  leave the secret-column defaults on and add `hidden` for anything else
  private.
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

## Plans, entitlements and flags

- Check access with `ent.can(subject, feature)` and `ent.limit(subject,
  key)`; never compare plan names in app code, since overrides and lapsed
  subscriptions change the answer.
- Metered actions call `ent.consume(subject, key, n)` before doing the work
  and stop when `ok` is false.
- Feed every signet-payments event to `ent.applyBillingEvent(event)`; it
  ignores non-subscription, duplicate and out-of-order events.
- Tools from `entitlementTools(...)`: `get_plan`, `check_entitlement`,
  `usage`, `list_flags` read. `grant_feature`, `set_plan` and `set_flag`
  exist only with `allowWrites`, always ask a person to approve, and return
  `APPROVAL_REQUIRED` with nothing changed when the client cannot ask. Show
  the person the summary; do not retry to get around it.

## Acting as an admin agent

Tools come from `adminTools(admin, { db, ctx, approve })`.

- Call `admin_schema` first: it lists the tables, columns, filter operators
  and ops you may use. Hidden columns do not exist as far as you can tell.
- `admin_<table>_list` pages with `nextCursor`; keep the same `sort` and
  `order` when you pass it back.
- `_create`, `_update`, `_delete` and actions ask the person to approve.
  `APPROVAL_REQUIRED` or `APPROVAL_DECLINED` means nothing changed.
- `FORBIDDEN` is final for this caller; do not retry it another way.

## Growth

- `createGrowth(db, { tables: growthTables() })`. Never store or log an invite
  token; it is shown once. Branch on `acceptInvite`'s `reason`, do not throw.
- Reward a referrer only when `convertReferral(...).first` is true, then call
  `markRewarded`; both are once-only.
- `growthTools(...)` writes (`create_invite`, `revoke_invite`,
  `set_feedback_status`) always ask a person to approve.

## Privacy (DPDP)

- Check `privacy.has(subject, purpose)` before processing for a purpose that
  needs consent; never infer consent from a missing record.
- Withdrawal must be as easy as giving: wire `withdraw` wherever `give` is.
- `privacyTools(...)` only opens requests and withdraws consent, always with
  approval. Do not call `fulfil` from an agent.
