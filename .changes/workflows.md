### signet-db: durable workflows

- New `./workflows`: `defineWorkflow(name, async (step, input) => ...)` and `createWorkflows(db, { tables, workflows })`. Steps: `step.run` (memoised, retries with backoff), `step.sleep` / `step.sleepUntil`, `step.waitForEvent(name, { timeout })`, `step.approval({ approvers, timeout })`. Engine: `start`, `tick` (lease-claimed, safe across concurrent runners), `poll`, `get`, `list`, `sendEvent`, `approve` / `reject`, `pendingApprovals`, `cancel`, `prune`. Runs resume from the database after a restart.
- New `workflowTables()` in `./columns/sqlite` and `./columns/pg`.
- New error codes `STEP_FAILED` and `NONDETERMINISTIC`.

### signet-server: workflow routes

- New `./http/workflows`: `workflowRoutes({ workflows, subject, isAdmin?, canStart? })` for signet-db's durable workflows: start, run status and step history, send event, approve/reject an approval step, cancel, an admin list of runs and the caller's approval inbox. Takes the engine structurally; no signet-db dependency.

### signet-ui: workflow screens

- New `./screens/workflow-screens`: `WorkflowRunTimeline` (status, what the run waits on, steps in order with retries and approval decisions, cancel) and `ApprovalInboxCard` (approve or reject with an optional reason), shaped like signet-db's workflow results. Demo: `screens-ops.html?screen=workflows` in the showcase.
