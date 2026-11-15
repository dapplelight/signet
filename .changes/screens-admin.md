### signet-ui: admin screen from the schema

- New `@dapplelight/signet-ui/screens/admin-screens`: `AdminScreen`, an admin
  panel generated from signet-db's `defineAdmin` metadata, served by
  signet-server's `adminRoutes`. Table list; server-side sort, typed filters
  (`{ column: { op: value } }` chips), text search and cursor pages; a
  soft-deleted toggle; a record panel whose form is built from the column
  types (enum, boolean, number, money, date, JSON, text) with server field
  errors on the fields; create, bulk delete, row actions with confirmation,
  and the audit trail from an `auditLog()` table.
- `createAdminApi({ baseUrl, fetch, headers })` implements `AdminApi` over
  fetch; failures become `AdminApiError` with `fieldErrors`.
- Parts are exported (`AdminPanel`, `AdminNav`, `AdminHeader`,
  `AdminToolbar`, `AdminFilterButton`, `AdminTable`, `AdminRowActions`,
  `AdminPager`, `AdminRecordSheet`, `AdminRecordForm`, `AdminAuditTrail`)
  with `useAdmin()`; every string is in `DEFAULT_ADMIN_LABELS` and the
  `labels` prop; `className` on every part, `classNames` on the screen,
  `render` swaps part elements, `renderCell` / `renderField` replace cells and
  fields; the open table and record are controlled or uncontrolled.
- signet-mcp indexes `screens/` exports for `compose_component`.
