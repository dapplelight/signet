/**
 * Agent tools for jobs as plain MCP tool objects: `list_failed_jobs`, `retry_job` (gated by `requireApproval`), `pause_job`, `resume_job`.
 *
 * `createMcpServer({ tools: [...jobTools(jobs)] })`. Retrying runs work again
 * (an email, a charge), so it asks the person first; pausing is reversible
 * and does not. The MCP SDK is loaded only when `retry_job` runs.
 */

import type { PlainTool, ToolContext } from "../mcp/server.js"
import type { Jobs } from "./jobs.js"

export type JobToolsOptions = {
  /** Skip the approval step for `retry_job`. Only for a trusted, internal agent. Default false. */
  retryWithoutApproval?: boolean
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
        if (!options.retryWithoutApproval) {
          const { requireApproval } = await import("../mcp/interaction.js")
          const gate = await requireApproval(ctx, {
            summary: `Retry job ${entry.job} (${id})`,
            details: { error: entry.error.message, input: entry.input },
            args: { id },
          })
          if (gate) return gate
        }
        await jobs.retryDead(id)
        return { id, job: entry.job, retried: true }
      },
    },
    pauseTool(true),
    pauseTool(false),
  ]
}
