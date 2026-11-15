### signet-db, signet-server, signet-ui: experiments, status page and maintenance mode

- signet-db `./experiments`: `createExperiments` runs A/B/n tests on top of
  feature flags. Weighted variants with sticky assignment from the flags'
  `bucket` (no storage needed), exposure logging once per subject, conversions
  from `analyticsEvents()` goal events after exposure, and `results` with
  per-variant rates, lift and a two-proportion z-test against the control.
  Lifecycle `create` / `update` (draft) / `start` / `stop` / `rollout`. A
  variant's `value` is free JSON, so a placement can later serve an offering
  by variant. Tables: `experimentTables()`.
- signet-db `./status`: `createStatus` for a status page: components,
  incidents with appended updates, the maintenance switch and `summary()`.
  Tables: `statusTables()`.
- signet-server `./http/experiments`: `experimentRoutes` (assignment and
  exposure) and `experimentAdminRoutes` (create, edit, start, stop, results,
  roll out; deny by default).
- signet-server `./http/status`: public `statusRoutes` and
  `statusAdminRoutes` for components, incidents and maintenance.
- signet-server `./middleware/maintenance`: `maintenanceMode` answers 503
  with `Retry-After` and the envelope (`code: "MAINTENANCE"`), with a path
  allowlist and an `allow` callback for admins.
- signet-lib: new error code `MAINTENANCE` with default copy.
- signet-ui `screens/experiment-screens` (`ExperimentList`,
  `ExperimentResults`) and `screens/status-screens` (`StatusPage`).
- signet-mcp: recipe `add-experiments`.
