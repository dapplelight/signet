/**
 * observabilityAdminRoutes(): deny by default, every route's named key and
 * empty state, input errors in the envelope, store errors rethrown, and no raw
 * subject id in any response. The store is an in-memory stand-in shaped like
 * signet-db's createAiSpend with an aiSpendLedger.
 */
import { Hono } from "hono"
import { errorHandler } from "../src/http/errors"
import { type AiSpendLedgerStore, observabilityAdminRoutes } from "../src/http/observability"

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

let rows: Array<{ day: string; units: number; calls: number; cacheSavedUnits: number }> = []
let broken = false
const seen: unknown[] = []
const hashOf = (id: string) => `hash-of-${id.length}`
const spend: AiSpendLedgerStore = {
  async series(q) {
    seen.push(q)
    if (broken) throw new Error("db down")
    if (q.subject && q.scope === "org") throw new FakeDbError("BAD_VALUE", "No such org.")
    return rows
  },
  async byModel(q) {
    seen.push(q)
    return rows.length ? [{ model: "a-very-long-model-name-".repeat(10), units: 5, calls: 1 }] : []
  },
  async topSpenders(q) {
    seen.push(q)
    return rows.length ? [{ subject: hashOf("user-secret"), units: 5, calls: 1 }] : []
  },
}

const app = new Hono()
app.onError(errorHandler({ isProduction: () => false }))
app.route(
  "/obs",
  observabilityAdminRoutes({
    spend,
    authorize: (c) =>
      c.req.header("x-role") === "admin" || (c.req.header("x-role") === "truthy" ? "yes" : false),
  }),
)
const get = (path: string, role = "admin") => app.request(path, { headers: { "x-role": role } })

const PATHS = ["/obs/cost/series", "/obs/cost/by-model", "/obs/cost/top", "/obs/cost/cache-savings"]

console.log("authorize")
for (const p of PATHS) {
  const denied = await get(p, "user")
  const body = await denied.json()
  ok(
    `${p}: not admin is 403`,
    denied.status === 403 && body.code === "FORBIDDEN" && body.success === false,
    body,
  )
  ok(`${p}: copy`, body.error === "You do not have permission to do that.")
}
ok(
  "only true passes: a truthy string is 403",
  (await get("/obs/cost/series", "truthy")).status === 403,
)
ok("admin passes", (await get("/obs/cost/series")).status === 200)

console.log("empty")
{
  const keys = ["series", "models", "top", "savings"]
  for (const [i, p] of PATHS.entries()) {
    const r = await get(p)
    const b = await r.json()
    ok(`${p}: 200 with ${keys[i]}`, r.status === 200 && keys[i] !== undefined && keys[i] in b, b)
  }
  const s = (await (await get("/obs/cost/cache-savings")).json()).savings
  ok(
    "empty savings are zero totals",
    s.cacheSavedUnits === 0 && s.spentUnits === 0 && s.series.length === 0,
    s,
  )
  ok(
    "empty series is an empty array",
    (await (await get("/obs/cost/series")).json()).series.length === 0,
  )
}

console.log("data")
{
  rows = [
    { day: "2026-11-14", units: 10, calls: 2, cacheSavedUnits: 4 },
    { day: "2026-11-15", units: 20, calls: 3, cacheSavedUnits: 6 },
  ]
  const s = (await (await get("/obs/cost/cache-savings?days=7")).json()).savings
  ok(
    "savings totals and per day",
    s.cacheSavedUnits === 10 && s.spentUnits === 30 && s.series[1].cacheSavedUnits === 6,
    s,
  )
  const m = (await (await get("/obs/cost/by-model")).json()).models
  ok(
    "long model names pass through whole",
    m[0].model.length === "a-very-long-model-name-".length * 10,
  )
  seen.length = 0
  await get("/obs/cost/series?days=90&scope=user&subject=user-secret")
  ok(
    "series passes days, scope and the raw subject to the store",
    JSON.stringify(seen[0]) === JSON.stringify({ days: 90, scope: "user", subject: "user-secret" }),
    seen,
  )
  seen.length = 0
  await get("/obs/cost/series")
  ok(
    "days defaults to 30 and scope to the store's default",
    JSON.stringify(seen[0]) === JSON.stringify({ days: 30 }),
    seen,
  )
  await get("/obs/cost/top?scope=org&days=5")
  ok(
    "top passes scope and days",
    JSON.stringify(seen[1]) === JSON.stringify({ days: 5, scope: "org" }),
    seen,
  )
  const text = await (await get("/obs/cost/top")).text()
  ok(
    "a subject appears only as its hash",
    text.includes("hash-of-11") && !text.includes("user-secret"),
    text,
  )
}

console.log("validation")
{
  for (const bad of ["0", "401", "-1", "1.5", "abc", ""]) {
    const r = await get(`/obs/cost/series?days=${bad}`)
    const b = await r.json()
    ok(
      `days=${JSON.stringify(bad)}: 400`,
      r.status === 400 &&
        b.code === "VALIDATION_FAILED" &&
        b.details.fieldErrors.days[0] === "days is a whole number from 1 to 400.",
      b,
    )
  }
  ok("days=400 is allowed", (await get("/obs/cost/by-model?days=400")).status === 200)
  const sc = await (await get("/obs/cost/series?scope=team")).json()
  ok("bad scope copy", sc.details?.fieldErrors?.scope?.[0] === "scope is user, org or global.", sc)
  const sub = await (await get("/obs/cost/series?scope=user&subject=")).json()
  ok(
    "empty subject copy",
    sub.details?.fieldErrors?.subject?.[0] === "subject is a user or org id.",
    sub,
  )
  const long = await get(`/obs/cost/series?scope=user&subject=${"x".repeat(201)}`)
  ok("subject over 200 characters: 400", long.status === 400)
  const noScope = await get("/obs/cost/series?subject=u1")
  ok(
    "subject without user or org scope: 400",
    noScope.status === 400 && (await noScope.json()).details.fieldErrors.scope.length === 1,
  )
  const topBad = await get("/obs/cost/top?scope=global")
  ok("top scope global: 400", topBad.status === 400)
}

console.log("store errors")
{
  const r = await get("/obs/cost/series?scope=org&subject=o1")
  const b = await r.json()
  ok(
    "SignetDbError BAD_VALUE is 400 VALIDATION_FAILED",
    r.status === 400 && b.code === "VALIDATION_FAILED" && b.error === "No such org.",
    b,
  )
  broken = true
  const f = await get("/obs/cost/series")
  ok(
    "any other store error goes to the app's errorHandler: 500",
    f.status === 500 && (await f.json()).success === false,
  )
  broken = false
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
