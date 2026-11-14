/**
 * Agent tools for jobs as plain MCP tool objects: `list_failed_jobs`, `retry_job`, `pause_job`, `resume_job`, `list_pending_approvals`, `decide_job_approval`.
 *
 * `createMcpServer({ tools: [...jobTools(jobs)] })`. Retrying runs work again
 * (an email, a charge) and an approval decides a step, so both ask the person
 * through `requireApproval` first; pausing is reversible and does not. The MCP SDK is loaded only when `retry_job` runs.
 */

import type { PlainTool, ToolContext } from "../mcp/server.js"
import type { Jobs } from "./jobs.js"

export type JobToolsOptions = {
  /** Skip `requireApproval` for `retry_job` and `decide_job_approval`. Only for a trusted, internal agent. Default false. */
  withoutApproval?: boolean
}

// An error result sent as-is: the same marker `toolResult` sets, without loading the SDK.
const err = (code: string, message: string) =>
  Object.defineProperty(
    {
      isError: true,
      content: [{ type: "text" as const, text: `${code}: ${message}` }],
      structuredContent: { success: false, error: message, code },
    },
    Symbol.for("signet.mcp.rawResult"),
    { value: true, enumerable: false },
  )

const byName = {
  type: "object",
  properties: { name: { type: "string", description: "The job's name." } },
  required: ["name"],
  additionalProperties: false,
} as const

export function jobTools(jobs: Jobs, options: JobToolsOptions = {}): PlainTool[] {
  const approval = async (
    ctx: ToolContext,
    a: { summary: string; details: Record<string, unknown>; args: unknown },
  ) => {
    if (options.withoutApproval) return undefined
    const { requireApproval } = await import("../mcp/interaction.js")
    return requireApproval(ctx, a)
  }
  const pauseTool = (paused: boolean): PlainTool => ({
    name: paused ? "pause_job" : "resume_job",
    description: paused
      ? "Pause a job by name. Its queued runs wait (re-queued every minute) until resumed."
      : "Resume a paused job by name.",
    annotations: { idempotentHint: true },
    inputSchema: byName,
    async run({ name }: { name: string }) {
      if (!jobs.jobs.has(name)) return err("NOT_FOUND", `No job named "${name}".`)
      await (paused ? jobs.pause(name) : jobs.resume(name))
      return { name, paused }
    },
  })
  return [
    {
      name: "list_failed_jobs",
      description:
        "List jobs that failed every attempt (the dead-letter list): id, job, error, input, when.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async run() {
        return { failed: await jobs.listDead() }
      },
    },
    {
      name: "retry_job",
      description:
        "Run a failed job again from attempt 1, by its id from list_failed_jobs. Needs the person's approval.",
      annotations: { destructiveHint: true },
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      async run({ id }: { id: string }, ctx: ToolContext) {
        const entry = (await jobs.listDead()).find((d) => d.id === id)
        if (!entry) return err("NOT_FOUND", `No failed job with id "${id}".`)
        const gate = await approval(ctx, {
          summary: `Retry job ${entry.job} (${id})`,
          details: { error: entry.error.message, input: entry.input },
          args: { id },
        })
        if (gate) return gate
        await jobs.retryDead(id)
        return { id, job: entry.job, retried: true }
      },
    },
    pauseTool(true),
    pauseTool(false),
    {
      name: "list_pending_approvals",
      description:
        "List job steps waiting for a person's approval: id, job, step, summary, when asked.",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async run() {
        return { pending: await jobs.listApprovals() }
      },
    },
    {
      name: "decide_job_approval",
      description:
        "Approve or reject a job step from list_pending_approvals. The person confirms it first.",
      annotations: { destructiveHint: true },
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          step: { type: "string" },
          approved: { type: "boolean" },
        },
        required: ["id", "step", "approved"],
        additionalProperties: false,
      },
      async run(input: { id: string; step: string; approved: boolean }, ctx: ToolContext) {
        const entry = (await jobs.listApprovals()).find(
          (a) => a.id === input.id && a.step === input.step,
        )
        if (!entry) return err("NOT_FOUND", `Nothing is waiting at ${input.id} / ${input.step}.`)
        const gate = await approval(ctx, {
          summary: `${input.approved ? "Approve" : "Reject"}: ${entry.summary}`,
          details: { job: entry.job, step: entry.step },
          args: input,
        })
        if (gate) return gate
        await jobs.approve(input.id, input.step, { approved: input.approved, by: "agent" })
        return { ...input, decided: true }
      },
    },
  ]
}
