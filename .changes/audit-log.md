### signet-db: audit log with request context, redaction, query and retention

- `auditLog()` gains nullable `meta`, `ip`, `user_agent` and `request_id` columns and indexes on `at` and `actor_id`. **Migration:** add them to an existing table (`ALTER TABLE audit_log ADD COLUMN meta text; ... ip text; ... user_agent text; ... request_id text;`, `jsonb` for `meta` on Postgres) before upgrading; see the README's "Upgrading an existing `audit_log`".
- New `audit(ctx, action, target, meta)` for events that are not row writes, `queryAudit(db, { actorId, action, target, from, to, limit, offset })` (newest first, with `total`), and `purgeAudit(db)` with `createDb(..., { auditConfig: { retentionDays } })`.
- `audited(db, { actor, request })` stores the request; `AdminContext` takes `request`.
- Behaviour change: `before` and `after` snapshots (and `meta`) now redact fields named like secrets (`password`, `token`, `secret`, `apiKey`, ...) as `"[redacted]"`. Add names with `auditConfig.redact`.

### signet-server: auditContext middleware

- New `./middleware/audit`: `auditContext({ trust, actor })` records actor, client IP (under `ClientIpTrust`), user agent and request id on `c.get("audit")`. `adminRoutes` passes it to signet-db's admin handler as `ctx.request`.
