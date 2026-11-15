/**
 * Public API toolkit: OpenAPI from zValidator routes, the HTML docs page,
 * HTTP caching helpers and the webhook admin routes.
 */
import { Hono } from "hono"
import { z } from "zod"
import { memoryKv } from "../src/adapters"
import {
  cacheControlValue,
  cachedResponse,
  etagMatches,
  httpCache,
  mergeVary,
} from "../src/http/cache"
import { errorHandler } from "../src/http/errors"
import { apiDoc, apiDocsHtml, openApiSpec, serveOpenApi } from "../src/http/openapi"
import { zValidator } from "../src/http/validate"
import { type WebhookStore, webhookRoutes } from "../src/http/webhooks"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean | undefined, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, JSON.stringify(d)))
}

// ---------------------------------------------------------------- OpenAPI
const Note = z.object({ id: z.string(), title: z.string(), createdAt: z.date() })
const NoteInput = z.object({
  title: z.string().min(1).describe("Shown in lists"),
  tags: z.array(z.string()).default([]),
})
const app = new Hono()
app.onError(errorHandler({ isProduction: () => false }))
app.use("*", async (_c, next) => next())
app.get(
  "/notes",
  zValidator("query", z.object({ q: z.string().optional(), limit: z.coerce.number().int() })),
  (c) => c.json([]),
)
app.post(
  "/notes",
  apiDoc({
    summary: "Create a note",
    tags: ["Notes"],
    responses: { 201: { description: "Created", schema: Note } },
  }),
  zValidator("json", NoteInput),
  (c) => c.json({}, 201),
)
app.get("/notes/:id{[0-9a-z]+}", apiDoc({ response: Note }), (c) => c.json({}))
app.delete(
  "/notes/:id",
  zValidator("param", z.object({ id: z.string().describe("The note id") })),
  (c) => c.json({}),
)
app.get("/health", apiDoc({ security: false }), (c) => c.text("ok"))
app.get("/internal", apiDoc(false), (c) => c.text("x"))
app.post("/upload", zValidator("form", z.object({ name: z.string() })), (c) => c.text("x"))
app.get("/files/*", (c) => c.text("x"))
const sub = new Hono().get("/hello", apiDoc({ summary: "Mounted" }), (c) => c.text("hi"))
app.route("/v1", sub)
serveOpenApi(app, {
  info: { title: "Notes <API>", version: "1.2.0" },
  security: { session: { cookieName: "sid" }, apiKey: { prefix: "app" } },
})

const spec = openApiSpec(app, {
  info: { title: "Notes", version: "1" },
  security: { session: { cookieName: "sid" }, apiKey: { prefix: "app" } },
})
const op = (p: string, m: string) => (spec.paths[p]?.[m] ?? {}) as Record<string, any>
ok("openapi 3.1", spec.openapi === "3.1.0")
ok(
  "error envelope is a component",
  (spec.components.schemas as any).Error.required.join() === "success,error",
)
ok(
  "security schemes: cookie and bearer",
  JSON.stringify(spec.components.securitySchemes) ===
    JSON.stringify({
      sessionCookie: { type: "apiKey", in: "cookie", name: "sid" },
      apiKey: {
        type: "http",
        scheme: "bearer",
        description: "An API key (`app_…`) in `Authorization: Bearer`.",
      },
    }),
  spec.components.securitySchemes,
)
ok(
  "global security: either scheme",
  JSON.stringify(spec.security) === '[{"sessionCookie":[]},{"apiKey":[]}]',
)
const list = op("/notes", "get")
ok(
  "query params from the validator",
  list.parameters?.map((p: any) => `${p.name}:${p.in}:${p.required}:${p.schema.type}`).join() ===
    "q:query:false:string,limit:query:true:integer",
  list.parameters,
)
ok(
  "operationId from method + path",
  list.operationId === "getNotes" && op("/notes/{id}", "get").operationId === "getNotesById",
)
ok(
  "400, 401 and default are the envelope",
  list.responses["400"].$ref === "#/components/responses/Error" &&
    list.responses["401"].$ref &&
    list.responses.default.$ref,
)
const create = op("/notes", "post")
ok(
  "json body is the input schema (default not required)",
  create.requestBody.content["application/json"].schema.required.join() === "title",
  create.requestBody,
)
ok(
  "schema .describe() kept",
  create.requestBody.content["application/json"].schema.properties.title.description ===
    "Shown in lists",
)
ok("apiDoc summary and tags", create.summary === "Create a note" && create.tags[0] === "Notes")
ok(
  "a 2xx in responses replaces the default 200",
  !create.responses["200"] &&
    create.responses["201"].content["application/json"].schema.properties.createdAt,
)
const get = op("/notes/{id}", "get")
ok(
  "hono regex param → {id}, required string",
  get.parameters?.[0]?.name === "id" &&
    get.parameters[0].in === "path" &&
    get.parameters[0].required,
  get,
)
ok(
  "response schema on 200",
  get.responses["200"].content["application/json"].schema.properties.title.type === "string",
)
ok("no validator: no 400", !get.responses["400"])
ok(
  "param validator description",
  op("/notes/{id}", "delete").parameters[0].description === "The note id",
)
ok(
  "security: false is public",
  JSON.stringify(op("/health", "get").security) === "[]" && !op("/health", "get").responses["401"],
)
ok(
  "apiDoc(false) and wildcards are left out",
  !spec.paths["/internal"] && !Object.keys(spec.paths).some((p) => p.includes("*")),
)
ok("form body is multipart", !!op("/upload", "post").requestBody.content["multipart/form-data"])
ok("mounted routes included", op("/v1/hello", "get").summary === "Mounted")
ok(
  "the spec and docs routes are not in the spec",
  !spec.paths["/openapi.json"] && !spec.paths["/docs"],
)
const noSec = openApiSpec(app, {
  info: { title: "x", version: "1" },
  include: ({ path }) => path !== "/upload",
})
ok(
  "no schemes: no security, no 401",
  !noSec.security && !(noSec.paths["/notes"]?.get as any)?.responses["401"],
)
ok("include filters", !noSec.paths["/upload"])

const served = await app.request("/openapi.json")
const servedJson = (await served.json()) as typeof spec
ok(
  "GET /openapi.json",
  served.status === 200 && servedJson.info.version === "1.2.0" && !!servedJson.paths["/notes"],
)
const docs = await app.request("/docs")
const html = await docs.text()
ok(
  "GET /docs is HTML",
  docs.headers.get("content-type")?.startsWith("text/html") && html.startsWith("<!doctype html>"),
)
ok(
  "docs list every operation",
  ["GET /notes", "POST /notes", "DELETE /notes/{id}", "GET /v1/hello"].every((s) =>
    html.includes(s),
  ),
)
ok("docs escape the title", html.includes("Notes &lt;API&gt;") && !html.includes("Notes <API>"))
ok("docs have no script", !html.includes("<script"))
ok(
  "docs show auth and the error envelope",
  html.includes("cookie <code>sid</code>") && html.includes("Error envelope"),
)
ok(
  "apiDocsHtml links a theme stylesheet",
  apiDocsHtml(spec, { stylesheet: "/theme.css" }).includes('href="/theme.css"'),
)

// ---------------------------------------------------------------- caching
ok("cache-control default revalidates", cacheControlValue({}) === "public, no-cache")
ok(
  "cache-control full",
  cacheControlValue({ maxAge: 60, sMaxAge: 300, staleWhileRevalidate: 30, staleIfError: 600 }) ===
    "public, max-age=60, s-maxage=300, stale-while-revalidate=30, stale-if-error=600",
)
ok(
  "private drops s-maxage",
  cacheControlValue({ private: true, maxAge: 10, sMaxAge: 99 }) === "private, max-age=10",
)
ok("no-store wins", cacheControlValue({ noStore: true, maxAge: 10 }) === "no-store")
ok(
  "mergeVary dedupes case-insensitively",
  mergeVary("Accept, cookie", "Cookie", "Authorization") === "Accept, cookie, Authorization",
)
ok(
  "mergeVary: * absorbs",
  mergeVary("Accept", "*") === "*" && mergeVary(null, "Cookie") === "Cookie",
)
ok(
  "etagMatches is weak",
  etagMatches('"a"', 'W/"a", "b"') &&
    etagMatches('W/"b"', '"b"') &&
    !etagMatches('"a"', '"c"') &&
    etagMatches('"a"', "*") &&
    !etagMatches('"a"', null),
)

let user = "u1"
const capp = new Hono()
capp.get("/plans", httpCache({ maxAge: 300 }), (c) => c.json({ plans: ["free"] }))
capp.get("/me", httpCache({ private: true, vary: ["Accept-Language"] }), (c) => c.json({ user }))
capp.get("/own", httpCache({ maxAge: 5 }), (c) => {
  c.header("Cache-Control", "no-store")
  c.header("ETag", '"mine"')
  return c.json({})
})
capp.post("/plans", httpCache({ maxAge: 300 }), (c) => c.json({ ok: true }))
capp.get("/missing", httpCache({ maxAge: 300 }), (c) => c.json({}, 404))
const r1 = await capp.request("/plans")
const tag = r1.headers.get("ETag") ?? ""
ok(
  "GET: Cache-Control and a strong ETag",
  r1.headers.get("Cache-Control") === "public, max-age=300" && /^"[0-9a-f]{32}"$/.test(tag),
  tag,
)
ok("body intact", JSON.stringify(await r1.json()) === '{"plans":["free"]}')
const r304 = await capp.request("/plans", { headers: { "If-None-Match": `W/${tag}` } })
ok("If-None-Match → 304 with no body", r304.status === 304 && (await r304.text()) === "")
ok(
  "304 keeps ETag and Cache-Control, drops Content-Type",
  r304.headers.get("ETag") === tag &&
    r304.headers.get("Cache-Control") === "public, max-age=300" &&
    !r304.headers.get("Content-Type"),
)
const head = await capp.request("/plans", { method: "HEAD" })
ok("HEAD gets the headers", head.headers.get("ETag") === tag)
const me = await capp.request("/me")
ok(
  "per user: private + Vary Cookie, Authorization",
  me.headers.get("Cache-Control") === "private, no-cache" &&
    me.headers.get("Vary") === "Cookie, Authorization, Accept-Language",
  me.headers.get("Vary"),
)
const meTag = me.headers.get("ETag")
user = "u2"
const me2 = await capp.request("/me", { headers: { "If-None-Match": meTag ?? "" } })
ok("another body → no 304", me2.status === 200 && me2.headers.get("ETag") !== meTag)
const own = await capp.request("/own", { headers: { "If-None-Match": '"mine"' } })
ok(
  "handler's own Cache-Control and ETag win",
  own.status === 304 && own.headers.get("Cache-Control") === "no-store",
)
const post = await capp.request("/plans", { method: "POST" })
ok("POST untouched", !post.headers.get("ETag") && !post.headers.get("Cache-Control"))
ok("404 untouched", !(await capp.request("/missing")).headers.get("ETag"))

// stale-while-revalidate
const kv = memoryKv()
let renders = 0
let now = Date.now()
const realNow = Date.now
Date.now = () => now
const pending: Promise<unknown>[] = []
const sapp = new Hono()
const slow = () => new Promise((r) => setTimeout(r, 20))
sapp.get("/stats", (c) =>
  cachedResponse(
    c,
    { kv, freshSeconds: 10, staleSeconds: 60, defer: (p) => void pending.push(p) },
    async () => {
      await slow()
      return c.json({ n: ++renders })
    },
  ),
)
sapp.get("/mine", (c) =>
  cachedResponse(
    c,
    { kv, freshSeconds: 10, staleSeconds: 60, varyBy: c.req.header("x-user") ?? "" },
    () => c.json({ user: c.req.header("x-user"), n: ++renders }),
  ),
)
sapp.get("/fail", (c) =>
  cachedResponse(c, { kv, freshSeconds: 10, staleSeconds: 60 }, () =>
    c.json({ n: ++renders }, 500),
  ),
)
const body = async (r: Response) => ((await r.json()) as { n: number }).n
const s1 = await sapp.request("/stats")
ok("first: MISS, rendered", s1.headers.get("X-Cache") === "MISS" && (await body(s1)) === 1)
const s2 = await sapp.request("/stats")
ok(
  "fresh: HIT, not rendered",
  s2.headers.get("X-Cache") === "HIT" && (await body(s2)) === 1 && renders === 1,
)
ok("content-type kept", s2.headers.get("content-type")?.startsWith("application/json"))
now += 15_000
const [s3, s3b] = await Promise.all([sapp.request("/stats"), sapp.request("/stats")])
ok(
  "stale: old body at once",
  s3.headers.get("X-Cache") === "STALE" &&
    s3b.headers.get("X-Cache") === "STALE" &&
    (await body(s3)) === 1,
)
await Promise.all(pending)
ok("one background refresh for concurrent stale hits", renders === 2, renders)
const s4 = await sapp.request("/stats")
const n4 = await body(s4)
ok(
  "after refresh: new body is fresh",
  s4.headers.get("X-Cache") === "HIT" && n4 === 2 && (await body(s3b)) === 1,
)
now += 200_000
const s5 = await sapp.request("/stats")
ok("past stale: MISS, rendered", s5.headers.get("X-Cache") === "MISS" && (await body(s5)) === 3)
const a = await sapp.request("/mine", { headers: { "x-user": "a" } })
const b = await sapp.request("/mine", { headers: { "x-user": "b" } })
ok(
  "varyBy keys per user",
  ((await a.json()) as any).user === "a" &&
    ((await b.json()) as any).user === "b" &&
    b.headers.get("X-Cache") === "MISS",
)
ok(
  "varyBy marks private + Vary",
  a.headers.get("Cache-Control") === "private, no-cache" &&
    a.headers.get("Vary") === "Cookie, Authorization",
)
const a2 = await sapp.request("/mine", { headers: { "x-user": "a" } })
ok("same user hits", a2.headers.get("X-Cache") === "HIT" && ((await a2.json()) as any).user === "a")
await sapp.request("/fail")
const f2 = await sapp.request("/fail")
ok("errors are never cached", f2.headers.get("X-Cache") === "MISS" && f2.status === 500)
const brokenKv = { ...memoryKv(), set: async () => Promise.reject(new Error("429")) }
const bapp = new Hono()
bapp.get("/x", (c) =>
  cachedResponse(c, { kv: brokenKv, freshSeconds: 10, staleSeconds: 60 }, () => c.json({ n: 1 })),
)
const bx = await bapp.request("/x")
ok(
  "failed cache write still returns the 200",
  bx.status === 200 && bx.headers.get("X-Cache") === "MISS",
)
Date.now = realNow

// ---------------------------------------------------------------- webhook routes
type Ep = { id: string; owner: string; url: string; events: string[]; disabled?: boolean }
type Del = { id: string; owner: string; endpointId: string; eventId: string }
const eps: Ep[] = []
const dels: Del[] = [{ id: "d1", owner: "u1", endpointId: "e0", eventId: "evt_1" }]
const dbErr = (code: string, message: string) =>
  Object.assign(new Error(message), { name: "SignetDbError", code })
const seenQuery: unknown[] = []
const store: WebhookStore<Ep, Del> = {
  async list(owner) {
    return eps.filter((e) => e.owner === owner)
  },
  async register(i) {
    if (i.url.startsWith("https://localhost"))
      throw dbErr("BAD_VALUE", "Webhook url must be a public host without credentials.")
    const e = { id: `e${eps.length + 1}`, owner: i.owner, url: i.url, events: i.events }
    eps.push(e)
    return { endpoint: e, secret: "whsec_test" }
  },
  async update(owner, id, patch) {
    const e = eps.find((x) => x.owner === owner && x.id === id)
    if (!e) return null
    if (patch.enabled !== undefined) e.disabled = !patch.enabled
    if (patch.url) e.url = patch.url
    return e
  },
  async remove(owner, id) {
    const n = eps.findIndex((x) => x.owner === owner && x.id === id)
    return n >= 0 ? (eps.splice(n, 1), true) : false
  },
  async rotateSecret(owner, id) {
    return eps.some((x) => x.owner === owner && x.id === id) ? { secret: "whsec_new" } : null
  },
  async deliveries(owner, q) {
    seenQuery.push(q)
    return dels.filter((d) => d.owner === owner)
  },
  async redeliver(owner, id) {
    const d = dels.find((x) => x.owner === owner && x.id === id)
    if (!d) return null
    if (eps.find((e) => e.id === d.endpointId)?.disabled !== false)
      throw dbErr("CONFLICT", "The endpoint is disabled or deleted; enable it first.")
    return { ...d, id: "d2" }
  },
}
const wapp = new Hono()
wapp.onError(errorHandler({ isProduction: () => true }))
wapp.route(
  "/api/webhooks",
  webhookRoutes({ webhooks: store, owner: (c) => c.req.header("x-user") ?? "anon" }),
)
const call = (method: string, path: string, body?: unknown, u = "u1") =>
  wapp.request(`/api/webhooks${path}`, {
    method,
    headers: { "x-user": u, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
const reg = await call("POST", "/endpoints", {
  url: "https://h.example.com/in",
  events: ["order.created"],
})
const regBody = (await reg.json()) as any
ok(
  "register: 201 with the secret once",
  reg.status === 201 && regBody.secret === "whsec_test" && regBody.endpoint.id === "e1",
)
const bad = await call("POST", "/endpoints", { url: "not a url", events: [] })
const badBody = (await bad.json()) as any
ok(
  "register: bad input is the 400 envelope",
  bad.status === 400 &&
    badBody.code === "VALIDATION_FAILED" &&
    !!badBody.details.fieldErrors.url &&
    !!badBody.details.fieldErrors.events,
)
const priv = await call("POST", "/endpoints", { url: "https://localhost/x", events: ["*"] })
ok(
  "store BAD_VALUE → 400 on url",
  priv.status === 400 &&
    ((await priv.json()) as any).details.fieldErrors.url[0].includes("public host"),
)
ok(
  "list is the owner's",
  ((await (await call("GET", "/endpoints")).json()) as Ep[]).length === 1 &&
    ((await (await call("GET", "/endpoints", undefined, "u2")).json()) as Ep[]).length === 0,
)
ok(
  "someone else's endpoint is 404",
  (await call("PATCH", "/endpoints/e1", { enabled: false }, "u2")).status === 404,
)
const patched = await call("PATCH", "/endpoints/e1", { enabled: true })
ok(
  "patch passes only given fields",
  patched.status === 200 && ((await patched.json()) as Ep).disabled === false,
)
ok(
  "rotate-secret",
  ((await (await call("POST", "/endpoints/e1/rotate-secret")).json()) as any).secret ===
    "whsec_new",
)
await call("GET", "/deliveries?status=failed&limit=5")
ok(
  "deliveries query coerced",
  JSON.stringify(seenQuery.at(-1)) === '{"status":"failed","limit":5}',
  seenQuery,
)
ok("bad status is 400", (await call("GET", "/deliveries?status=nope")).status === 400)
const conflict = await call("POST", "/deliveries/d1/redeliver")
ok(
  "redeliver to a disabled endpoint is 409",
  conflict.status === 409 && ((await conflict.json()) as any).code === "CONFLICT",
)
eps.push({ id: "e0", owner: "u1", url: "https://h.example.com", events: ["*"], disabled: false })
const redo = await call("POST", "/deliveries/d1/redeliver")
ok("redeliver: 201", redo.status === 201 && ((await redo.json()) as Del).eventId === "evt_1")
ok(
  "someone else's delivery is 404",
  (await call("POST", "/deliveries/d1/redeliver", undefined, "u2")).status === 404,
)
ok(
  "delete",
  (await call("DELETE", "/endpoints/e1")).status === 200 &&
    (await call("DELETE", "/endpoints/e1")).status === 404,
)
const wspec = openApiSpec(wapp, { info: { title: "w", version: "1" }, security: { apiKey: {} } })
ok(
  "webhook routes document themselves",
  Object.keys(wspec.paths).join() ===
    "/api/webhooks/endpoints,/api/webhooks/endpoints/{id},/api/webhooks/endpoints/{id}/rotate-secret,/api/webhooks/deliveries,/api/webhooks/deliveries/{id}/redeliver",
  Object.keys(wspec.paths),
)
ok("and are tagged", (wspec.paths["/api/webhooks/endpoints"]?.post as any)?.tags[0] === "Webhooks")

console.log(`\npublic-api: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
