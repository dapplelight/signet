import type { Part } from "../../src/compose.js"

export default {
  description: "DPDP consent and data export / erasure requests",
  needs: ["auth"],
  tables: ["consents", "data_requests"],
} satisfies Part
