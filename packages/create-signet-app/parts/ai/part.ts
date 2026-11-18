import type { Part } from "../../src/compose.js"

export default {
  description: "AI spend caps per user and app, and a sample /api/ai route on signet-ai",
  needs: ["auth"],
  apiOnly: true,
  // signet-ai's main entry needs signet-lib (its error type) as a peer.
  api: { deps: { "@dapplelight/signet-ai": "^0.5.0", "@dapplelight/signet-lib": "^0.4.0" } },
  env: () => [
    "# AI spend caps in cost units (1000000 = one US dollar); a cap stored in ai_spend_caps wins.",
    "AI_CAP_USER_DAY=200000",
    "AI_CAP_GLOBAL_MONTH=50000000",
  ],
  // usage_counters is payments' table too: it stays when either part is chosen.
  tables: ["usage_counters", "ai_spend_caps"],
} satisfies Part
