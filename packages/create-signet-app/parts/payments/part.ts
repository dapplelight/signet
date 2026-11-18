import type { Part } from "../../src/compose.js"

export default {
  description: "plans, entitlements, the billing page and gateway webhooks",
  needs: ["auth"],
  // The billing page reads the plans, which use signet-db's definePlans.
  web: { deps: { "@dapplelight/signet-db": "^0.2.0" } },
  api: { deps: { "@dapplelight/signet-payments": "^0.1.0" } },
  env: () => ["BILLING=fake"],
  tables: ["subject_plans", "entitlement_overrides", "usage_counters"],
  uiCopies: { "api/plans.ts": "src/lib/plans.ts" },
} satisfies Part
