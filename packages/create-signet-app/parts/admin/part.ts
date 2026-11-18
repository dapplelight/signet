import type { Part } from "../../src/compose.js"

export default {
  description: "the operator's admin panel over every table, by platform role",
  needs: ["auth", "orgs"],
} satisfies Part
