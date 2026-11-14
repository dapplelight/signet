/**
 * adminRoutes: route params reach handle(), the context gate is 401, bad JSON
 * is 400, and a signet-db AdminError (by shape) becomes the error envelope.
 */
import { Hono } from "hono"
import { type AdminHttpRequest, adminRoutes } from "../src/http/admin"
import { errorHandler } from "../src/http/errors"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

/** Stands in for signet-db's AdminError: a SignetDbError with an HTTP status. */
class FakeAdminError extends Error {
  readonly name = "SignetDbError"
  constructor(
    readonly status: 400 | 403,
    readonly code: string,
    message: string,
    readonly details?: { formErrors: string[]; fieldErrors: Record<string, string[]> },
  ) {
    super(message)
  }
}

const seen: { db: unknown; ctx: unknown; req: AdminHttpRequest }[] = []
const admin = {
  async handle(db: string, ctx: { actor: { id: string } }, req: AdminHttpRequest) {
    seen.push({ db, ctx, req })
    if (req.table === "secret")
      throw new FakeAdminError(403, "FORBIDDEN", "Not allowed to list secret.")
    if (req.table === "bad")
      throw new FakeAdminError(400, "VALIDATION_FAILED", "Validation failed", {
        formErrors: [],
        fieldErrors: { title: ["Required"] },
      })
    if (req.table === "boom") throw new Error("db password in here")
    return { status: (req.method === "POST" ? 201 : 200) as 200 | 201, body: { echo: req } }
  },
}

const app = new Hono()
app.onError(errorHandler({ isProduction: () => true }))
app.route(
  "/admin",
  adminRoutes(admin, {
    db: () => "the-db",
    ctx: (c) =>
      c.req.header("x-user") ? { actor: { id: c.req.header("x-user") as string } } : undefined,
  }),
)
const call = (path: string, init: RequestInit = {}, user: string | null = "u1") =>
  app.request(path, { ...init, headers: { ...(user ? { "x-user": user } : {}), ...init.headers } })
const json = async (r: Response) => (await r.json()) as Record<string, any>

const anon = await call("/admin/notes", {}, null)
ok(
  "no context is 401 with the envelope",
  anon.status === 401 && (await json(anon)).code === "UNAUTHORIZED",
)
ok("handle not called without a context", seen.length === 0)

const meta = await json(await call("/admin"))
ok(
  "GET / reaches handle with no table",
  meta.echo.method === "GET" && meta.echo.table === undefined,
)
const list = await json(await call("/admin/notes?limit=5&filter=%7B%7D"))
ok(
  "list gets table and query",
  list.echo.table === "notes" && list.echo.query.limit === "5" && list.echo.query.filter === "{}",
)
ok(
  "db and ctx come from the options",
  seen.at(-1)?.db === "the-db" && (seen.at(-1)?.ctx as any)?.actor.id === "u1",
)
const created = await call("/admin/notes", { method: "POST", body: JSON.stringify({ title: "x" }) })
ok(
  "POST passes the body and status",
  created.status === 201 && (await json(created)).echo.body.title === "x",
)
const patched = await json(await call("/admin/notes/n1", { method: "PATCH", body: '{"a":1}' }))
ok("PATCH /:table/:id", patched.echo.id === "n1" && patched.echo.body.a === 1)
const del = await json(await call("/admin/notes/n1", { method: "DELETE" }))
ok("DELETE /:table/:id", del.echo.method === "DELETE" && del.echo.id === "n1")
const act = await json(await call("/admin/notes/n1/archive", { method: "POST" }))
ok("POST /:table/:id/:action", act.echo.action === "archive" && act.echo.body === undefined)
const badJson = await call("/admin/notes", { method: "POST", body: "{nope" })
ok(
  "bad JSON is 400 INVALID_JSON",
  badJson.status === 400 && (await json(badJson)).code === "INVALID_JSON",
)

const denied = await call("/admin/secret")
const deniedBody = await json(denied)
ok(
  "AdminError keeps status, code and message",
  denied.status === 403 && deniedBody.code === "FORBIDDEN" && deniedBody.success === false,
  deniedBody,
)
const invalid = await json(await call("/admin/bad"))
ok("AdminError details reach the envelope", invalid.details?.fieldErrors?.title?.[0] === "Required")
const boom = await call("/admin/boom")
const boomBody = await json(boom)
ok(
  "other errors stay internal and masked",
  boom.status === 500 && boomBody.error === "Internal server error",
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
