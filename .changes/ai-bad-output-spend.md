### signet-ai: invalid model output now counts toward the budget

- `extract` records cost, `onUsage` and the budget ledger before validating the output. A call whose output fails the schema is still billed by the provider, so it now counts toward the window cap instead of being invisible. No migration needed.
