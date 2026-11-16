### signet-db: pricing experiments on placements

- `createOfferings(db, { ..., experiments })`: a placement can run a pricing
  experiment (`setPlacement(p, { ..., experiment })`) whose variants serve
  offerings or pinned versions (`value: { offering, version? }`; no value is
  the placement's own). `current(placement, audience, subjectId)` assigns
  sticky through `createExperiments`, records the exposure, and returns
  `experiment: { key, variant, reason }`.
- New `./pricing`: `createPricing(db, { tables, offerings, experiments })`
  with `readout(key)` (per variant: conversion with lift and z-test, trial
  conversion, revenue and revenue per exposed user from the customer
  timeline, followed through identity merges, and an LTV estimate from
  observed churn) and `rollout(key, variant)` (the winner's offering becomes
  the placement's offering and the experiment stops). `pricingReadout` is the
  same math as a pure function.
- Migration: `placements` has a new nullable `experiment` column. On an
  existing database run `ALTER TABLE placements ADD COLUMN experiment text`.

### signet-server: pricing experiment routes

- `monetisationRoutes`: `GET /offerings/:placement` (and the impression and
  redeem routes) pass the subject so a placement's pricing experiment assigns
  and records the exposure.
- `monetisationAdminRoutes({ pricing })`: `GET /pricing/:experiment` (the
  readout) and `POST /pricing/:experiment/rollout` `{ variant }`, deny by
  default; `PUT /placements/:placement` takes `experiment`.

### signet-ui: experiment form, pricing readout and status admin

- `screens/experiment-screens`: `ExperimentForm` (key, variants and weights,
  JSON value or offering picker, goal event, audience, start and stop) and
  `PricingExperimentResults` (per-variant offering, conversion, trial
  conversion, revenue per exposed user and an LTV estimate, one-click
  rollout).
- `screens/status-screens`: `StatusAdmin` with exported parts
  `MaintenanceForm`, `ComponentStatusList`, `IncidentForm` and
  `IncidentUpdateForm`: the maintenance switch with message and until,
  component statuses, and incidents opened, updated and resolved
  (append-only updates).
