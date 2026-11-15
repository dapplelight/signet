### signet-db: audit trail for org writes

- `createOrgs` writes an `auditLog()` entry for org create and settings changes, member add, role change, remove and leave, custom role create, change and delete, and invite create, accept and revoke: actor, action, and before/after snapshots carrying the `orgId`. Never the invite token or its hash. Skipped when the db has no audit table.
