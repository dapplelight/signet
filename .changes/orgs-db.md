### signet-db: organisations and tenant scope

- New `./orgs`: `createOrgs` for organisations (slug, custom domain, theme, brand colour), memberships with roles, role → permission sets with per-org custom roles, invites with expiring single-use tokens, and no-escalation and last-owner checks. `DEFAULT_ORG_ROLES`, `ORG_PERMISSIONS`, `defineRoles`, `hasPermission`, `canGrant`, `OrgError`.
- `orgTables()` in `./columns/sqlite` and `./columns/pg`: `organizations`, `memberships`, `invitations`, `orgRoles`.
- `scoped(db, { orgId })` and `scoped(db, { userId, orgId })`: org-scoped reads and writes, deny-by-default for tables without `orgId` (`NOT_TENANT_TABLE`, `CROSS_ORG_WRITE`).
- `defineAdmin`: `ctx.orgId` limits the admin API to one org; `tenant: true` requires it.
