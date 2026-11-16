/**
 * Experiment routes on signet-db's `createExperiments` (typed by shape, so
 * this package does not depend on signet-db): the app reads its variant and
 * records exposures; admins create, start, stop, read results and roll out
 * a winner.
 *
 * ```ts
 * const subject = (c: Context) => ({ id: c.get("session")?.sub ?? c.req.header("x-app-user") })
 * app.route("/api/experiments", experimentRoutes({ experiments, subject }))
 * app.route("/api/admin/experiments", experimentAdminRoutes({
 *   experiments, authorize: (c) => c.get("session")?.role === "admin",
 *   actor: (c) => ({ type: "user", id: c.get("session").sub }),
 * }))
 * ```
 */

import { type Context, Hono } from "hono"
import { ApiException } from "./errors.js"
import { type Actor, adminGate, jsonBody, storeError } from "./store-helpers.js"

type Subject = {
  id: string
  plan?: string
  attributes?: Record<string, string | number | boolean | null | undefined>
}

/** What the routes need from signet-db's `createExperiments(...)`, as it is. */
export type ExperimentStore = {
  get(key: string): Promise<unknown>
  list(): Promise<unknown[]>
  create(key: string, input: never, opts: { actor: Actor }): Promise<unknown>
  update(key: string, input: never, opts: { actor: Actor }): Promise<unknown>
  start(key: string, opts: { actor: Actor }): Promise<unknown>
  stop(key: string, opts: { actor: Actor }): Promise<unknown>
  rollout(key: string, variant: string, opts: { actor: Actor }): Promise<unknown>
  assign(key: string, subject: Subject): Promise<unknown>
  expose(key: string, subject: Subject): Promise<unknown>
  results(key: string, opts?: { goal?: string; alpha?: number }): Promise<unknown>
}

export type ExperimentRoutesOptions = {
  experiments: ExperimentStore
  /**
   * Who is asking: the signed-in user's id, or the device's anonymous id,
   * with plan and attributes from the session (never the query). No id is 401.
   */
  subject: (c: Context) => Subject | null | undefined | Promise<Subject | null | undefined>
}

/**
 * The app's routes. Mount with `app.route("/api/experiments", experimentRoutes(opts))`.
 *
 *   GET  /:key            the caller's variant, nothing recorded: { assignment }
 *   POST /:key/exposure   the caller saw it: { assignment } with `first`
 *
 * An unknown experiment is 404.
 */
export function experimentRoutes(opts: ExperimentRoutesOptions) {
  const app = new Hono()
  app.onError(storeError)
  const who = async (c: Context) => {
    const s = await opts.subject(c)
    if (!s?.id) throw new ApiException(401, "Sign in first.", "UNAUTHORIZED")
    return s
  }
  const found = (a: unknown) => {
    if (!a) throw new ApiException(404, "No such experiment.", "NOT_FOUND")
    return a
  }
  return app
    .get("/:key", async (c) =>
      c.json({
        assignment: found(await opts.experiments.assign(c.req.param("key"), await who(c))),
      }),
    )
    .post("/:key/exposure", async (c) =>
      c.json({
        assignment: found(await opts.experiments.expose(c.req.param("key"), await who(c))),
      }),
    )
}

export type ExperimentAdminOptions = {
  experiments: ExperimentStore
  /** Deny by default: every route calls it, and anything but true is 403. */
  authorize: (c: Context) => unknown
  /** Who made the change, for the audit log. */
  actor: (c: Context) => Actor | Promise<Actor>
}

const INPUT = ["variants", "goal", "description", "audience", "salt"] as const
const pick = (b: Record<string, unknown>) =>
  Object.fromEntries(INPUT.filter((k) => b[k] !== undefined).map((k) => [k, b[k]])) as never

/**
 * Admin routes. Mount with `app.route("/api/admin/experiments", experimentAdminRoutes(opts))`.
 *
 *   GET   /                 every experiment
 *   POST  /                 { key, variants, goal, description?, audience?, salt? }: a draft
 *   GET   /:key             { experiment, results } (results null without the events table)
 *   PATCH /:key             change a draft
 *   POST  /:key/start       start or resume
 *   POST  /:key/stop        stop; everyone gets the control
 *   POST  /:key/rollout     { variant }: everyone gets it
 *
 * Signet-db errors become the envelope: BAD_VALUE is 400 VALIDATION_FAILED,
 * a wrong move (stop a draft) 409 CONFLICT, an unknown key 404.
 */
export function experimentAdminRoutes(opts: ExperimentAdminOptions) {
  const { experiments } = opts
  const app = new Hono()
  app.onError(storeError)
  app.use(adminGate(opts.authorize))
  const actor = async (c: Context) => ({ actor: await opts.actor(c) })
  return app
    .get("/", async (c) => c.json({ experiments: await experiments.list() }))
    .post("/", async (c) => {
      const b = await jsonBody(c)
      if (typeof b.key !== "string")
        throw new ApiException(400, "key is required.", "VALIDATION_FAILED", {
          formErrors: [],
          fieldErrors: { key: ["Required"] },
        })
      return c.json({ experiment: await experiments.create(b.key, pick(b), await actor(c)) }, 201)
    })
    .get("/:key", async (c) => {
      const key = c.req.param("key")
      const experiment = await experiments.get(key)
      if (!experiment) throw new ApiException(404, "No such experiment.", "NOT_FOUND")
      const goal = c.req.query("goal")
      let results: unknown = null
      try {
        results = await experiments.results(key, goal ? { goal } : {})
      } catch (e) {
        if ((e as { code?: unknown }).code !== "BAD_CONFIG") throw e
      }
      return c.json({ experiment, results })
    })
    .patch("/:key", async (c) =>
      c.json({
        experiment: await experiments.update(
          c.req.param("key"),
          pick(await jsonBody(c)),
          await actor(c),
        ),
      }),
    )
    .post("/:key/start", async (c) =>
      c.json({ experiment: await experiments.start(c.req.param("key"), await actor(c)) }),
    )
    .post("/:key/stop", async (c) =>
      c.json({ experiment: await experiments.stop(c.req.param("key"), await actor(c)) }),
    )
    .post("/:key/rollout", async (c) => {
      const variant = (await jsonBody(c)).variant
      if (typeof variant !== "string" || !variant)
        throw new ApiException(400, "variant is required.", "VALIDATION_FAILED", {
          formErrors: [],
          fieldErrors: { variant: ["Required"] },
        })
      return c.json({
        experiment: await experiments.rollout(c.req.param("key"), variant, await actor(c)),
      })
    })
}

/** For `hc<ExperimentRoutes>`, imported with `import type`. */
export type ExperimentRoutes = ReturnType<typeof experimentRoutes>
