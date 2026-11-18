import type { Part } from "../../src/compose.js"

export default {
  description: "remote paywalls: versioned offerings and placements, served per audience",
  needs: ["payments"],
  apiOnly: true,
  tables: ["offerings", "placements"],
} satisfies Part
