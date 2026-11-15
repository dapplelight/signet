/**
 * statusRoutes(), statusAdminRoutes() and maintenanceMode(): the public
 * summary is cacheable, admin is deny by default, input is validated, and
 * maintenance mode answers 503 with Retry-After and the envelope while the
 * allowlist (paths, admins) passes. The store is an in-memory stand-in
 * shaped like signet-db's createStatus.
 */
import { type Context, Hono } from "hono"
import { errorHandler } from "../src/http/errors"
import { type StatusStore, statusAdminRoutes, statusRoutes } from "../src/http/status"
import { maintenanceMode } from "../src/middleware/maintenance"
import { requestId } from "../src/middleware/request-id"

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

let maint: { on: boolean; message: string | null; until: Date | null } = {
  on: false,
  message: null,
  until: null,
}
let reads = 0
const components = new Map<string, unknown>()
const status: StatusStore = {
  async summary() {
    return {
      status: "operational",
      components: [...components.values()],
      incidents: [],
      maintenance: maint,
    }
  },
  async components() {
    return [...components.values()]
  },
  async incidents(opts) {
    return [{ days: opts?.days }]
  },
  async setComponent(key, input: { name?: unknown }) {
    if (!components.has(key) && !input.name)
      throw new FakeDbError("BAD_VALUE", "A new component needs a name.")
    components.set(key, { key, ...input })
    return components.get(key)
  },
  async removeComponent(key) {
    return components.delete(key)
  },
  async openIncident(input) {
    return { id: "i1", ...(input as object) }
  },
  async updateIncident(id) {
    if (id !== "i1") throw new FakeDbError("NOT_FOUND", "No incident.")
    return { id, status: "resolved" }
  },
  async maintenance() {
    reads++
    return maint
  },
  async setMaintenance(input) {
    maint = { on: input.on, message: input.message ?? null, until: input.until ?? null }
    return maint
  },
}

let clock = 1_000_000
const app = new Hono()
app.onError(errorHandler({ isProduction: () => false }))
app.use(requestId())
app.use(
  maintenanceMode({
    state: () => status.maintenance(),
    paths: ["/health", "/status", "/admin"],
    allow: (c: Context) => c.req.header("x-role") === "admin",
    cacheMs: 1000,
    now: () => clock,
  }),
)
app.get("/health", (c) => c.text("ok"))
app.get("/api/thing", (c) => c.json({ ok: true }))
app.get("/administer", (c) => c.json({ ok: true }))
app.route("/status", statusRoutes({ status }))
app.route(
  "/admin",
  statusAdminRoutes({
    status,
    authorize: (c) => c.req.header("x-role") === "admin",
    actor: () => ({ type: "user", id: "a1" }),
  }),
)
const req = (path: string, init: RequestInit & { role?: string } = {}) =>
  app.request(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.role ? { "x-role": init.role } : {}) },
  })
const admin = (path: string, init: RequestInit = {}) => req(path, { ...init, role: "admin" })

console.log("statusRoutes")
{
  const r = await req("/status")
  ok("public summary", r.status === 200 && (await r.json()).status === "operational")
  ok("cacheable", r.headers.get("cache-control") === "public, max-age=30")
}

console.log("statusAdminRoutes")
{
  ok("not admin: 403", (await req("/admin/components")).status === 403)
  const noName = await admin("/admin/components/api", { method: "PUT", body: "{}" })
  ok(
    "new component without name: 400",
    noName.status === 400 && (await noName.json()).code === "VALIDATION_FAILED",
  )
  ok(
    "put component",
    (await admin("/admin/components/api", { method: "PUT", body: JSON.stringify({ name: "API" }) }))
      .status === 200,
  )
  ok(
    "list components",
    ((await (await admin("/admin/components")).json()).components as unknown[]).length === 1,
  )
  ok(
    "delete component",
    (await admin("/admin/components/api", { method: "DELETE" })).status === 200,
  )
  ok(
    "delete missing: 404",
    (await admin("/admin/components/api", { method: "DELETE" })).status === 404,
  )
  ok(
    "incidents ?days",
    (await (await admin("/admin/incidents?days=7")).json()).incidents[0].days === 7,
  )
  ok("incidents bad days: 400", (await admin("/admin/incidents?days=-1")).status === 400)
  ok(
    "open incident: 201",
    (await admin("/admin/incidents", { method: "POST", body: JSON.stringify({ title: "x" }) }))
      .status === 201,
  )
  ok(
    "update unknown incident: 404",
    (await admin("/admin/incidents/nope/updates", { method: "POST", body: "{}" })).status === 404,
  )
  ok(
    "maintenance needs on: 400",
    (await admin("/admin/maintenance", { method: "PUT", body: "{}" })).status === 400,
  )
  ok(
    "maintenance bad until: 400",
    (
      await admin("/admin/maintenance", {
        method: "PUT",
        body: JSON.stringify({ on: true, until: "soon" }),
      })
    ).status === 400,
  )
}

console.log("maintenanceMode")
{
  ok("off: requests pass", (await req("/api/thing")).status === 200)
  const set = await admin("/admin/maintenance", {
    method: "PUT",
    body: JSON.stringify({
      on: true,
      message: "Upgrading",
      until: new Date(clock + 120_000).toISOString(),
    }),
  })
  ok("turned on from admin", set.status === 200 && (await set.json()).maintenance.on === true)
  ok("cached state still off within cacheMs", (await req("/api/thing")).status === 200)
  clock += 1500
  const r = await req("/api/thing")
  const body = await r.json()
  ok("on: 503", r.status === 503)
  ok(
    "envelope with MAINTENANCE, message and requestId",
    body.success === false &&
      body.code === "MAINTENANCE" &&
      body.error === "Upgrading" &&
      !!body.requestId,
    body,
  )
  ok(
    "Retry-After counts down to until",
    r.headers.get("retry-after") === "119",
    r.headers.get("retry-after"),
  )
  ok("health check passes", (await req("/health")).status === 200)
  ok("status page passes", (await req("/status")).status === 200)
  ok("a prefix does not match a longer word", (await req("/administer")).status === 503)
  ok("admin passes anywhere", (await req("/api/thing", { role: "admin" })).status === 200)
  const before = reads
  await req("/api/thing")
  ok("state read is cached", reads === before)
  maint = { on: true, message: null, until: null }
  clock += 1500
  const d = await req("/api/thing")
  ok(
    "no until: default Retry-After 300 and default message",
    d.headers.get("retry-after") === "300" && (await d.json()).error.includes("maintenance"),
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
