/**
 * auditContext: actor, trusted client IP, user agent and request id land on
 * c.get("audit"), and adminRoutes hands them to the admin handler as ctx.request.
 */
import { Hono } from "hono"
import { type AdminHttpRequest, adminRoutes } from "../src/http/admin"
import { auditContext } from "../src/middleware/audit"
import { requestId } from "../src/middleware/request-id"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const seen: { ctx: any; req: AdminHttpRequest }[] = []
const admin = {
  async handle(_db: unknown, ctx: any, req: AdminHttpRequest) {
    seen.push({ ctx, req })
    return { status: 200 as const, body: {} }
  },
}

const build = (trust: Parameters<typeof auditContext>[0]) => {
  const app = new Hono()
  app.use("*", requestId())
  app.use(
    "*",
    auditContext({
      ...trust,
      actor: (c) => {
        const id = c.req.header("x-user")
        return id ? { type: "user", id } : undefined
      },
    }),
  )
  app.get("/who", (c) => c.json(c.get("audit" as never)))
  app.route(
    "/admin",
    adminRoutes(admin, {
      db: () => "db",
      ctx: (c) => ({ actor: { type: "user", id: c.req.header("x-user") ?? "anon" } }),
    }),
  )
  return app
}
const headers = {
  "x-user": "u1",
  "x-request-id": "req-42",
  "user-agent": "unit-test/1",
  "cf-connecting-ip": "203.0.113.7",
  "x-forwarded-for": "198.51.100.1",
}

const cf = (await (await build({ trust: "cloudflare" }).request("/who", { headers })).json()) as any
ok("records actor", cf.actor?.id === "u1" && cf.actor?.type === "user", cf)
ok(
  "records trusted IP, user agent and request id",
  cf.request.ip === "203.0.113.7" &&
    cf.request.userAgent === "unit-test/1" &&
    cf.request.requestId === "req-42",
  cf,
)

const none = (await (await build({}).request("/who", { headers })).json()) as any
ok("no IP unless a proxy is trusted", none.request.ip === null, none)

const anon = (await (await build({}).request("/who")).json()) as any
ok("anonymous has no actor", anon.actor === undefined && anon.request.requestId !== null, anon)

const long = (await (
  await build({}).request("/who", { headers: { "user-agent": "x".repeat(2000) } })
).json()) as any
ok("user agent is capped", long.request.userAgent.length === 512)

await build({ trust: "cloudflare" }).request("/admin/notes/n1", {
  method: "PATCH",
  body: "{}",
  headers,
})
const got = seen.at(-1)?.ctx
ok(
  "adminRoutes passes request to the handler, keeps the actor",
  got.actor.id === "u1" && got.request.ip === "203.0.113.7" && got.request.requestId === "req-42",
  got,
)

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
