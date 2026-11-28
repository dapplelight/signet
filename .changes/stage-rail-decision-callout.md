### ui: StageRail and DecisionCallout

- `StageRail` (from `stage-rail`): a row of equal segments, one per stage of a run. Done stages are filled, the current one is filled and pulses (not under reduced motion), later ones are empty. Each segment has screen-reader text ("Verify: in progress"). Takes `stages`, `current`, a required `aria-label` and `classNames` (`segment`, `label`).
- `DecisionCallout`, `DecisionCalloutTitle`, `DecisionCalloutReason` (from `decision-callout`): a tinted box for a timeline step, with one bold line for what was decided and one quieter line for why. A plain div, not an Alert, so it is not announced.
- `defaultLabels` gains `stageDone`, `stageCurrent` and `stageUpcoming`. Nothing existing changes.

### create-signet-app: locale keys for StageRail

`src/locales/en.json` gains the `signet` keys `stageDone`, `stageCurrent` and `stageUpcoming`. Needs the new `@dapplelight/signet-ui`.
