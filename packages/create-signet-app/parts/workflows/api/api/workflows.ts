import { createWorkflows, defineWorkflow } from "@dapplelight/signet-db/workflows"
import { z } from "zod"
import type { Db } from "./db/index.ts"
import * as schema from "./db/schema.ts"

const request = z.object({
  /** What is being asked, as the approvers see it. */
  summary: z.string().min(1).max(200),
  /** User ids; any one of them decides. */
  approvers: z.array(z.string().min(1)).min(1).max(20),
})

/**
 * The example: someone asks, one of the approvers approves or rejects, and
 * the run ends with the decision (a week without one counts as rejected).
 * Copy it for your own: put each side effect in `step.run`, so a replay after
 * a restart does not repeat it.
 */
export const approvalRequest = defineWorkflow("approval-request", async (step, input: unknown) => {
  const { summary, approvers } = request.parse(input)
  const decision = await step.approval({ approvers, summary, timeout: 7 * 86_400_000 })
  return { approved: decision.approved, by: decision.by ?? null, reason: decision.reason ?? null }
})

/** Every workflow the app runs. A run of one not listed here fails. */
export const WORKFLOWS = [approvalRequest]

/**
 * The engine over the workflow tables. services.ts serves it to the routes;
 * server.ts runs another over the same database, ticking every second.
 */
export const createAppWorkflows = (db: Db) =>
  createWorkflows(db, { tables: schema, workflows: WORKFLOWS })
