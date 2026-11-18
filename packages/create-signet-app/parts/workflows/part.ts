import type { Part } from "../../src/compose.js"

export default {
  description: "durable workflows with approval steps, their runner, and the approvals page",
  needs: ["auth"],
  tables: ["workflow_runs", "workflow_steps", "workflow_events"],
} satisfies Part
