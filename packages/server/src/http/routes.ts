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
