/**
 * Typed client: zValidator on the server, createRpcClient (signet-lib) over
 * hc on the client. The @ts-expect-error lines are the type tests: `bun run
 * typecheck` fails if a wrong field ever compiles.
 */
import { Hono } from "hono"
import { hc } from "hono/client"
import { z } from "zod"
import { createRpcClient } from "../../lib/src/api/client"
import { ApiError, AuthError } from "../../lib/src/api/errors"
import { memoryKv } from "../src/adapters"
import { type SessionRoutes, sessionRoutes } from "../src/auth/hono"
import { kvSessionStore, startSession } from "../src/auth/sessions"
import { ApiException, errorHandler } from "../src/http/errors"
import { entitlementRoutes, flagRoutes } from "../src/http/routes"
import { zValidator } from "../src/http/validate"
import { requestId } from "../src/middleware/request-id"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean | undefined, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const rejects = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e
  }
  return undefined
}

// --- the server: Signet's route groups plus the app's own ---
const store = kvSessionStore(memoryKv())
const sessionOpts = { cookieName: "sid", secret: "a-secret-that-is-at-least-32-characters", store }
const plans = { free: { features: ["export"] as const, limits: { seats: 1 } } }
type Resolved = { plan: keyof typeof plans; features: string[]; graceUntil: Date | null }

const Note = z.object({
  title: z.string().min(1),
  tags: z.array(z.string()).default([]),
})
const seen: { reqIds: string[]; flaky: number } = { reqIds: [], flaky: 0 }

const app = new Hono()
  .use("*", requestId())
  .use("*", async (c, next) => {
    seen.reqIds.push(c.get("reqId" as never) as string)
    await next()
  })
  .route("/api/sessions", sessionRoutes(sessionOpts))
  .route(
    "/api/entitlements",
    entitlementRoutes({
      entitlements: {
        get: async (subject): Promise<Resolved> => ({
          plan: subject === "u1" ? "free" : "free",
          features: ["export"],
          graceUntil: new Date(0),
        }),
        usage: async () => [{ key: "seats" as const, used: 1, limit: 1 }],
      },
      subject: (c) => c.req.header("x-user") ?? "anon",
    }),
  )
  .route(
    "/api/flags",
    flagRoutes({
      flags: { all: async (s: { id: string }) => ({ beta: { value: s.id === "u1" } }) },
      subject: (c) => ({ id: c.req.header("x-user") ?? "anon" }),
    }),
  )
  .post("/api/notes", zValidator("json", Note), (c) => {
    const note = c.req.valid("json")
    return c.json({ id: "n1", ...note }, 201)
  })
  .get(
    "/api/notes/:id",
    zValidator("param", z.object({ id: z.string().regex(/^n\d+$/) })),
    zValidator("query", z.object({ full: z.enum(["yes", "no"]).optional() })),
    (c) => {
      const { id } = c.req.valid("param")
      if (id === "n404") throw new ApiException(404, "No such note", "NOTE_NOT_FOUND")
      return c.json({ id, full: c.req.valid("query").full === "yes" })
    },
  )
  .get("/api/flaky", (c) => {
    seen.flaky++
    if (seen.flaky < 3) {
      c.header("Retry-After", "0")
      throw new ApiException(503, "Try again", "UNAVAILABLE")
    }
    return c.json({ attempts: seen.flaky })
  })
  .get("/api/me", (c) => c.json({ auth: c.req.header("authorization") ?? null }))
app.onError(errorHandler({ isProduction: () => false }))
type AppType = typeof app
const viaApp = async (input: RequestInfo | URL, init?: RequestInit) =>
  app.request(String(input), init)

const api = createRpcClient(hc<AppType>, {
  baseUrl: "http://localhost",
  headers: () => ({ authorization: "Bearer t1", "x-user": "u1" }),
  fetch: viaApp,
})

// --- type tests: compiled by `tsc -p tsconfig.test.json`, never run ---
async function typeTests() {
  // @ts-expect-error wrong field name
  await api.api.notes.$post({ json: { titel: "x" } })
  // @ts-expect-error wrong field type
  await api.api.notes.$post({ json: { title: 1 } })
  // @ts-expect-error query value outside the enum
  await api.api.notes[":id"].$get({ param: { id: "n1" }, query: { full: "maybe" } })
  // @ts-expect-error missing param
  await api.api.notes[":id"].$get({ query: {} })
  // A schema default is optional on the way in, present on the way out.
  const note = await (await api.api.notes.$post({ json: { title: "x" } })).json()
  const tags: string[] = note.tags
  // @ts-expect-error not in the response
  note.body
  // Signet's groups: dates arrive as strings, the app's own types flow through.
  const ent = await (await api.api.entitlements.$get()).json()
  const plan: "free" = ent.plan
  const grace: string | null = ent.graceUntil
  // @ts-expect-error a Date is not what JSON delivers
  const asDate: Date | null = ent.graceUntil
  const flags = await (await api.api.flags.$get()).json()
  const beta: boolean = flags.beta.value
  // A group on its own, from the exported type.
  const sessions = createRpcClient(hc<SessionRoutes>, { baseUrl: "/api/sessions" })
  const list = await (await sessions.index.$get()).json()
  const current: boolean | undefined = list.sessions[0]?.current
  await sessions[":id"].$delete({ param: { id: "s1" } })
  // @ts-expect-error no such route
  await sessions.everything.$delete()
  return [tags, plan, grace, asDate, beta, current]
}
void typeTests

// --- runtime ---
{
  const res = await api.api.notes.$post({ json: { title: "Hello" } })
  const body = await res.json()
  ok("json: valid body reaches the handler, default applied", res.status === 201, body)
  ok("json: response typed and parsed", body.title === "Hello" && body.tags.length === 0, body)
}
{
  const e = await rejects(api.api.notes.$post({ json: { title: "" } }))
  ok("json: invalid body throws ApiError", e instanceof ApiError && e.status === 400, e)
  const err = e as ApiError
  ok("json: VALIDATION_FAILED envelope", err.code === "VALIDATION_FAILED", err.code)
  ok(
    "json: field errors in details",
    (err.details?.fieldErrors.title?.length ?? 0) > 0,
    err.details,
  )
  ok("json: requestId from the envelope", typeof err.requestId === "string" && !!err.requestId)
}
{
  const e = (await rejects(
    api.api.notes.$post({ json: { title: "x", tags: [1] } as never }),
  )) as ApiError
  ok("json: nested path in fieldErrors", !!e.details?.fieldErrors["tags.0"], e.details)
}
{
  const res = await api.api.notes[":id"].$get({ param: { id: "n7" }, query: { full: "yes" } })
  const body = await res.json()
  ok("param + query: parsed", body.id === "n7" && body.full === true, body)
  const bad = (await rejects(
    api.api.notes[":id"].$get({ param: { id: "x" }, query: {} }),
  )) as ApiError
  ok("param: invalid → 400 VALIDATION_FAILED", bad?.code === "VALIDATION_FAILED", bad)
  const q = (await rejects(
    api.api.notes[":id"].$get({ param: { id: "n1" }, query: { full: "maybe" as "yes" } }),
  )) as ApiError
  ok("query: invalid → 400 with the field", !!q?.details?.fieldErrors.full, q?.details)
  const nf = (await rejects(
    api.api.notes[":id"].$get({ param: { id: "n404" }, query: {} }),
  )) as ApiError
  ok("ApiException → ApiError with code", nf?.status === 404 && nf.code === "NOTE_NOT_FOUND", nf)
}
{
  const raw = await app.request("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{nope",
  })
  const body = (await raw.json()) as { success: boolean; code: string }
  ok("malformed JSON → 400 envelope", raw.status === 400 && body.success === false, body)
}
{
  const body = await (await api.api.me.$get()).json()
  ok("headers(): auth header sent", body.auth === "Bearer t1", body)
  const before = seen.reqIds.length
  await api.api.me.$get({}, { headers: { "x-request-id": "mine-1" } })
  ok("request id: caller's kept", seen.reqIds[before] === "mine-1", seen.reqIds[before])
  await api.api.me.$get()
  ok(
    "request id: generated per call",
    /^[0-9a-f-]{36}$/.test(seen.reqIds[before + 1] ?? ""),
    seen.reqIds[before + 1],
  )
}
{
  const e = await rejects(api.api.flaky.$get())
  ok("retries: off by default", e instanceof ApiError && e.status === 503 && seen.flaky === 1)
  seen.flaky = 0
  const start = seen.reqIds.length
  const retrying = createRpcClient(hc<AppType>, {
    baseUrl: "http://localhost",
    retries: 2,
    fetch: viaApp,
  })
  const body = await (await retrying.api.flaky.$get()).json()
  ok("retries: a 503 GET is retried until it succeeds", body.attempts === 3, body)
  const ids = seen.reqIds.slice(start)
  ok("retries: one request id across attempts", ids.length === 3 && new Set(ids).size === 1, ids)
  seen.flaky = -10
  const before = seen.flaky
  await rejects(retrying.api.notes.$post({ json: { title: "" } }))
  ok("retries: a POST is never retried", seen.flaky === before)
}
{
  const ent = await (await api.api.entitlements.$get()).json()
  ok("entitlements: GET / returns the store's value", ent.plan === "free", ent)
  ok("entitlements: Date serialised", ent.graceUntil === new Date(0).toISOString(), ent)
  const usage = await (await api.api.entitlements.usage.$get()).json()
  ok("entitlements: GET /usage", usage[0]?.key === "seats", usage)
  const flags = await (await api.api.flags.$get()).json()
  ok("flags: GET / evaluated for the subject", flags.beta.value === true, flags)
}
{
  const { token } = await startSession(sessionOpts, { sub: "u9" })
  const sessions = createRpcClient(hc<SessionRoutes>, {
    baseUrl: "http://localhost/api/sessions",
    headers: () => ({ cookie: `sid=${token}` }),
    fetch: viaApp,
  })
  const list = await (await sessions.index.$get()).json()
  ok("sessions: typed group client lists mine", list.sessions[0]?.current === true, list)
  let calls = 0
  const anon = createRpcClient(hc<SessionRoutes>, {
    baseUrl: "http://localhost/api/sessions",
    onAuthError: () => calls++,
    fetch: viaApp,
  })
  const e = await rejects(anon.index.$get())
  ok("401 → AuthError and onAuthError once", e instanceof AuthError && calls === 1, e)
}

console.log(`\nrpc: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
