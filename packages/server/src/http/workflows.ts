/**
 * HTTP routes for signet-db's durable workflows (`createWorkflows`): start a
 * run, read its status and step history, send an event, approve or reject an
 * approval step, cancel, and an admin list of every run. Requires `hono`.
 *
 * Takes the engine structurally, so this package does not depend on
 * signet-db. Put the app's auth middleware in front; `subject` is the
 * signed-in user.
 *
 *   app.use("/api/workflows/*", requireStoredSession(sessionOpts))
 *   app.route("/api/workflows", workflowRoutes({
 *     workflows: wf,
 *     subject: (c) => c.get("session").payload.sub,
 *     isAdmin: (c) => c.get("session").payload.role === "admin",
 *   }))
 *
 *   GET  /runs                          admin: every run (?status, ?workflow, ?before, ?limit); others: their own
 *   POST /runs                          { workflow, input } start a run (needs `canStart`, default admins only)
 *   GET  /runs/:id                      the run and its steps; for admins, its starter and its approvers
 *   POST /runs/:id/cancel               admins and the starter
 *   POST /runs/:id/steps/:step/approve  { reason? } a listed approver
 *   POST /runs/:id/steps/:step/reject   { reason? } a listed approver
 *   POST /events                        { name, payload?, runId? } admins only
 *   GET  /approvals                     approval steps waiting on the caller
 *
 * A run the caller may not see reads as 404, so ids cannot be probed.
 */

import { type Context, Hono } from "hono"
import { ApiException } from "./errors.js"

type RunLike = { id: string; createdBy: string | null }
type StepLike = { approvers: string[] | null }

/** What `workflowRoutes` needs from signet-db's `createWorkflows(...)`. */
export type WorkflowEngineLike<Run extends RunLike, Step extends StepLike, Decision, Pending> = {
  start(workflow: string, input: unknown, opts: { createdBy?: string }): Promise<Run>
  get(id: string): Promise<{ run: Run; steps: Step[] } | null>
  list(opts: {
    /** signet-db's RunStatus; the query string is passed through. */
    status?: never
    workflow?: string
    createdBy?: string
    limit?: number
    before?: string
  }): Promise<Run[]>
  sendEvent(name: string, payload?: unknown, opts?: { runId?: string }): Promise<unknown>
  decide(
    runId: string,
    stepId: string,
    d: { by: string; approved: boolean; reason?: string },
  ): Promise<Decision | null>
  pendingApprovals(approver: string): Promise<Pending[]>
  cancel(runId: string, opts?: { by?: string }): Promise<boolean>
}

export type WorkflowRoutesOptions<E> = {
  workflows: E
  subject: (c: Context) => string | Promise<string>
  /** Sees and cancels every run, sends events. Default nobody. */
  isAdmin?: (c: Context) => boolean | Promise<boolean>
  /** Who may start `workflow` over HTTP. Default admins only. */
  canStart?: (c: Context, workflow: string) => boolean | Promise<boolean>
}

// By shape: signet-db's SignetDbError, so this module does not import it.
const dbError = (e: unknown, code: string) =>
  e instanceof Error && e.name === "SignetDbError" && (e as { code?: unknown }).code === code

const body = async (c: Context): Promise<Record<string, unknown>> => {
  const text = await c.req.text()
  if (!text) return {}
  try {
    const v = JSON.parse(text)
    if (v && typeof v === "object" && !Array.isArray(v)) return v
  } catch {}
  throw new ApiException(400, "The body must be a JSON object", "BAD_REQUEST")
}

const str = (v: unknown, field: string, required = false): string | undefined => {
  if (v === undefined && !required) return undefined
  if (typeof v !== "string" || !v || v.length > 500)
    throw new ApiException(400, `"${field}" must be a non-empty string`, "BAD_REQUEST")
  return v
}

export function workflowRoutes<Run extends RunLike, Step extends StepLike, Decision, Pending>(
  opts: WorkflowRoutesOptions<WorkflowEngineLike<Run, Step, Decision, Pending>>,
) {
  const { workflows: wf } = opts
  const isAdmin = async (c: Context) => (opts.isAdmin ? await opts.isAdmin(c) : false)
  const notFound = () => new ApiException(404, "No such run", "NOT_FOUND")

  const visible = async (c: Context, id: string) => {
    const got = await wf.get(id)
    if (!got) throw notFound()
    const sub = await opts.subject(c)
    const mine =
      got.run.createdBy === sub || got.steps.some((s) => s.approvers?.includes(sub) ?? false)
    if (!mine && !(await isAdmin(c))) throw notFound()
    return { ...got, sub }
  }

  const decide = (approved: boolean) => async (c: Context) => {
    const runId = c.req.param("id") ?? ""
    const stepId = c.req.param("step") ?? ""
    const { sub } = await visible(c, runId)
    const reason = str((await body(c)).reason, "reason")
    try {
      const done = await wf.decide(runId, stepId, { by: sub, approved, reason })
      if (!done)
        throw new ApiException(409, "This step was already decided or timed out", "CONFLICT")
      return c.json(done)
    } catch (e) {
      if (dbError(e, "NOT_FOUND")) throw new ApiException(404, "No such approval step", "NOT_FOUND")
      if (dbError(e, "FORBIDDEN"))
        throw new ApiException(403, "You are not an approver of this step", "FORBIDDEN")
      throw e
    }
  }

  return new Hono()
    .get("/runs", async (c) => {
      const q = c.req.query()
      const limit = q.limit ? Number(q.limit) : undefined
      const filter = {
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.workflow ? { workflow: q.workflow } : {}),
        ...(q.before ? { before: q.before } : {}),
        ...(limit && Number.isFinite(limit) ? { limit } : {}),
      }
      if (await isAdmin(c)) return c.json(await wf.list(filter))
      return c.json(await wf.list({ ...filter, createdBy: await opts.subject(c) }))
    })
    .post("/runs", async (c) => {
      const b = await body(c)
      const name = str(b.workflow, "workflow", true) as string
      const allowed = opts.canStart ? await opts.canStart(c, name) : await isAdmin(c)
      if (!allowed) throw new ApiException(403, "You may not start this workflow", "FORBIDDEN")
      try {
        return c.json(
          await wf.start(name, b.input ?? null, { createdBy: await opts.subject(c) }),
          201,
        )
      } catch (e) {
        if (dbError(e, "NOT_FOUND")) throw new ApiException(404, "No such workflow", "NOT_FOUND")
        throw e
      }
    })
    .get("/runs/:id", async (c) => {
      const { run, steps } = await visible(c, c.req.param("id"))
      return c.json({ run, steps })
    })
    .post("/runs/:id/cancel", async (c) => {
      const { run, sub } = await visible(c, c.req.param("id"))
      if (run.createdBy !== sub && !(await isAdmin(c)))
        throw new ApiException(403, "Only the starter or an admin can cancel this run", "FORBIDDEN")
      if (!(await wf.cancel(run.id, { by: sub })))
        throw new ApiException(409, "This run has already ended", "CONFLICT")
      return c.json({ cancelled: true })
    })
    .post("/runs/:id/steps/:step/approve", decide(true))
    .post("/runs/:id/steps/:step/reject", decide(false))
    .post("/events", async (c) => {
      if (!(await isAdmin(c))) throw new ApiException(403, "Admins only", "FORBIDDEN")
      const b = await body(c)
      const name = str(b.name, "name", true) as string
      const runId = str(b.runId, "runId")
      return c.json(await wf.sendEvent(name, b.payload, runId ? { runId } : {}))
    })
    .get("/approvals", async (c) => c.json(await wf.pendingApprovals(await opts.subject(c))))
}

/** For `hc<WorkflowRoutes<WorkflowRun, WorkflowStep, ApprovalDecision, PendingWorkflowApproval>>` with signet-db's types, imported with `import type`. */
export type WorkflowRoutes<
  Run extends RunLike,
  Step extends StepLike,
  Decision,
  Pending,
> = ReturnType<typeof workflowRoutes<Run, Step, Decision, Pending>>
