/**
 * Read routes for signet-db's entitlements and flags, typed for `hc`.
 * Requires `hono` as an optional peer.
 *
 * They take the store structurally, so this package does not depend on
 * signet-db, and the response type is the app's own (its plans, its flags).
 * Put the app's auth middleware in front; `subject` reads who is asking.
 *
 *   app.use("/api/entitlements/*", requireStoredSession(sessionOpts))
 *   app.route("/api/entitlements", entitlementRoutes({ entitlements, subject: (c) => c.get("session").payload.sub }))
 */

import { type Context, Hono } from "hono"
import { ApiException } from "./errors.js"

/**
 *   GET /        the plan, features, limits and overrides in effect now
 *   GET /usage   usage against every limit in the current period
 */
export function entitlementRoutes<R, U>(opts: {
  entitlements: { get(subject: string): Promise<R>; usage(subject: string): Promise<U[]> }
  subject: (c: Context) => string | Promise<string>
}) {
  return new Hono()
    .get("/", async (c) => c.json(await opts.entitlements.get(await opts.subject(c))))
    .get("/usage", async (c) => c.json(await opts.entitlements.usage(await opts.subject(c))))
}

/**
 *   GET /   every flag's value (and why) for the caller
 */
export function flagRoutes<S, R>(opts: {
  flags: { all(subject: S): Promise<R> }
  subject: (c: Context) => S | Promise<S>
}) {
  return new Hono().get("/", async (c) => c.json(await opts.flags.all(await opts.subject(c))))
}

/** For `hc<EntitlementRoutes<Resolved<typeof plans>, Usage>>`, imported with `import type`. */
export type EntitlementRoutes<R, U> = ReturnType<typeof entitlementRoutes<R, U>>
/** For `hc<FlagRoutes<FlagSubject, Values>>`, imported with `import type`. */
export type FlagRoutes<S, R> = ReturnType<typeof flagRoutes<S, R>>

/**
 * The person's side of MCP approvals (`kvApprovals` from `../mcp`): see what
 * an agent is waiting on, approve or deny it. Behind the app's auth;
 * `subject` is the signed-in user, who can only decide their own.
 *
 *   GET  /              pending approvals for the caller
 *   POST /:id/approve   approve one; the agent's next identical call runs it
 *   POST /:id/deny      deny one; the agent's next identical call is declined
 *
 * Takes the store structurally, so this module does not load the MCP SDK.
 */
export function approvalRoutes<R extends { principal: string | null }>(opts: {
  approvals: {
    get(id: string): Promise<R | null>
    listPending(principal: string | null): Promise<R[]>
    approve(id: string, by: string): Promise<R | null>
    deny(id: string, by: string): Promise<R | null>
  }
  subject: (c: Context) => string | Promise<string>
}) {
  const { approvals } = opts
  const decide = (to: "approve" | "deny") => async (c: Context) => {
    const sub = await opts.subject(c)
    const id = c.req.param("id") ?? ""
    const r = await approvals.get(id)
    // Someone else's approval reads as missing, not forbidden: no probing ids.
    if (!r || r.principal !== sub) throw new ApiException(404, "No such approval", "NOT_FOUND")
    const done = await approvals[to](id, sub)
    if (!done)
      throw new ApiException(409, "This approval was already decided or has expired", "CONFLICT")
    return c.json(done)
  }
  return new Hono()
    .get("/", async (c) => c.json(await approvals.listPending(await opts.subject(c))))
    .post("/:id/approve", decide("approve"))
    .post("/:id/deny", decide("deny"))
}
