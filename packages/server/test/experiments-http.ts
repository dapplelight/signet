/**
 * experimentRoutes() and experimentAdminRoutes(): 401 without a subject, 404
 * for an unknown experiment, admin deny by default, input validation, results
 * left out without the events table, and signet-db errors as the envelope.
 * The store is an in-memory stand-in shaped like signet-db's createExperiments;
 * the real one is tested in signet-db.
 */
import { type Context, Hono } from "hono"
import { errorHandler } from "../src/http/errors"
import {
  type ExperimentStore,
  experimentAdminRoutes,
  experimentRoutes,
} from "../src/http/experiments"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

class FakeDbError extends Error {
  readonly name = "SignetDbError"
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const seen: { subject?: unknown; created?: unknown; rollout?: unknown; actor?: unknown } = {}
let withEvents = true
const status: Record<string, string> = {}
const experiments: ExperimentStore = {
  async get(key) {
    return status[key] ? { key, status: status[key] } : null
  },
  async list() {
    return Object.keys(status).map((key) => ({ key }))
  },
  async create(key, input: { variants?: unknown[] }, { actor }) {
    if (!Array.isArray(input.variants) || input.variants.length < 2)
      throw new FakeDbError("BAD_VALUE", "An experiment has 2 to 10 variants.")
    if (status[key]) throw new FakeDbError("CONFLICT", "exists")
    status[key] = "draft"
    seen.created = input
    seen.actor = actor
    return { key, status: "draft" }
  },
  async update(key) {
    if (status[key] !== "draft") throw new FakeDbError("CONFLICT", "not a draft")
    return { key }
  },
  async start(key) {
    if (!status[key]) throw new FakeDbError("NOT_FOUND", "no")
    status[key] = "running"
    return { key, status: "running" }
  },
  async stop(key) {
    if (status[key] !== "running") throw new FakeDbError("CONFLICT", "not running")
    status[key] = "stopped"
    return { key, status: "stopped" }
  },
  async rollout(key, variant) {
    seen.rollout = { key, variant }
    return { key, status: "rolled_out", winner: variant }
  },
  async assign(key, subject) {
    seen.subject = subject
    return status[key] ? { experiment: key, variant: "control", reason: "assigned" } : null
  },
  async expose(key) {
    return status[key] ? { experiment: key, variant: "control", first: true } : null
  },
  async results(key, opts) {
    if (!withEvents) throw new FakeDbError("BAD_CONFIG", "no events")
    return { experiment: key, goal: opts?.goal ?? "signup", variants: [] }
  },
}

type Who = { user?: string; role?: string }
const app = new Hono<{ Variables: { who: Who } }>()
app.onError(errorHandler({ isProduction: () => false }))
app.use(async (c, next) => {
  c.set("who", { user: c.req.header("x-user"), role: c.req.header("x-role") })
  await next()
})
const who = (c: Context) => c.get("who") as Who
app.route(
  "/x",
  experimentRoutes({
    experiments,
    subject: (c) => {
      const u = who(c).user
      return u ? { id: u, plan: "pro" } : null
    },
  }),
)
app.route(
  "/admin",
  experimentAdminRoutes({
    experiments,
    authorize: (c) => who(c).role === "admin",
    actor: (c) => ({ type: "user", id: who(c).user ?? "" }),
  }),
)

const req = (path: string, init: RequestInit & Who = {}) =>
  app.request(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.user ? { "x-user": init.user } : {}),
      ...(init.role ? { "x-role": init.role } : {}),
    },
  })
const admin = (path: string, init: RequestInit = {}) =>
  req(path, { ...init, user: "a1", role: "admin" })

console.log("experimentAdminRoutes")
{
  ok("signed in but not admin: 403", (await req("/admin", { user: "u1" })).status === 403)
  ok("no session: 403", (await req("/admin")).status === 403)
  const missingKey = await admin("/admin", { method: "POST", body: "{}" })
  ok("create without key: 400", missingKey.status === 400)
  const bad = await admin("/admin", {
    method: "POST",
    body: JSON.stringify({ key: "copy", variants: [], goal: "signup" }),
  })
  const badBody = await bad.json()
  ok(
    "store BAD_VALUE: 400 VALIDATION_FAILED",
    bad.status === 400 && badBody.code === "VALIDATION_FAILED",
    badBody,
  )
  ok("bad JSON: 400", (await admin("/admin", { method: "POST", body: "{" })).status === 400)
  const variants = [
    { key: "control", weight: 1 },
    { key: "b", weight: 1 },
  ]
  const made = await admin("/admin", {
    method: "POST",
    body: JSON.stringify({ key: "copy", variants, goal: "signup", junk: true }),
  })
  ok("create: 201", made.status === 201)
  ok(
    "create passes only known fields and the actor",
    JSON.stringify(seen.created) === JSON.stringify({ variants, goal: "signup" }) &&
      (seen.actor as { id: string }).id === "a1",
    seen.created,
  )
  const dup = await admin("/admin", {
    method: "POST",
    body: JSON.stringify({ key: "copy", variants, goal: "signup" }),
  })
  ok("duplicate: 409", dup.status === 409)
  ok("list", ((await (await admin("/admin")).json()).experiments as unknown[]).length === 1)
  const stopDraft = await admin("/admin/copy/stop", { method: "POST" })
  ok(
    "stop a draft: 409 CONFLICT",
    stopDraft.status === 409 && (await stopDraft.json()).code === "CONFLICT",
  )
  ok("patch a draft", (await admin("/admin/copy", { method: "PATCH", body: "{}" })).status === 200)
  ok("start", (await admin("/admin/copy/start", { method: "POST" })).status === 200)
  ok("start unknown: 404", (await admin("/admin/nope/start", { method: "POST" })).status === 404)
  const got = await (await admin("/admin/copy?goal=purchase")).json()
  ok(
    "get has experiment and results for ?goal",
    got.experiment.key === "copy" && got.results.goal === "purchase",
    got,
  )
  withEvents = false
  ok("results null without events", (await (await admin("/admin/copy")).json()).results === null)
  withEvents = true
  ok("get unknown: 404", (await admin("/admin/nope")).status === 404)
  ok(
    "rollout without variant: 400",
    (await admin("/admin/copy/rollout", { method: "POST", body: "{}" })).status === 400,
  )
  const ro = await admin("/admin/copy/rollout", {
    method: "POST",
    body: JSON.stringify({ variant: "b" }),
  })
  ok("rollout", ro.status === 200 && (seen.rollout as { variant: string }).variant === "b")
  ok("stop", (await admin("/admin/copy/stop", { method: "POST" })).status === 200)
}

console.log("experimentRoutes")
{
  ok("no subject: 401", (await req("/x/copy")).status === 401)
  const a = await req("/x/copy", { user: "u1" })
  ok(
    "assignment for the session's subject",
    a.status === 200 &&
      (await a.json()).assignment.variant === "control" &&
      (seen.subject as { id: string; plan: string }).plan === "pro",
  )
  ok("unknown: 404", (await req("/x/nope", { user: "u1" })).status === 404)
  const e = await req("/x/copy/exposure", { method: "POST", user: "u1" })
  ok("exposure", e.status === 200 && (await e.json()).assignment.first === true)
  ok(
    "exposure without subject: 401",
    (await req("/x/copy/exposure", { method: "POST" })).status === 401,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
