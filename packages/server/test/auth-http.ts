import { Hono } from "hono"
import { z } from "zod"
import { createApiToken } from "../src/auth/bearer"
import { requireAuth, requireSession, requireSharedToken } from "../src/auth/hono"
import { issueSession, sessionCookie } from "../src/auth/session"
import { errorHandler } from "../src/http/errors"
import { parseBody, parseParams, parseQuery } from "../src/http/validate"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const session = { secret: "a-test-secret-that-is-at-least-32-chars", cookieName: "sid" }
const cookieFor = async (sub?: string) =>
  sessionCookie(await issueSession(session, sub), session).split(";")[0]

// --- requireSession ---
const s = new Hono<{ Variables: { session: { sub?: string } } }>()
  .use("*", requireSession(session))
  .get("/", (c) => c.text(c.get("session").sub ?? "anon"))
ok("requireSession: no cookie is 401", (await s.request("/")).status === 401)
ok(
  "requireSession: forged cookie is 401",
  (await s.request("/", { headers: { cookie: "sid=e30.forged" } })).status === 401,
)
const sOk = await s.request("/", { headers: { cookie: await cookieFor("u1") } })
ok(
  "requireSession: valid cookie passes and sets session",
  sOk.status === 200 && (await sOk.text()) === "u1",
)

// --- requireSharedToken ---
const t = new Hono()
  .use(
    "*",
    requireSharedToken(() => "shared-secret-token"),
  )
  .get("/", (c) => c.text("ok"))
ok("requireSharedToken: missing is 401", (await t.request("/")).status === 401)
ok(
  "requireSharedToken: wrong token is 401",
  (await t.request("/", { headers: { authorization: "Bearer nope" } })).status === 401,
)
ok(
  "requireSharedToken: right token passes",
  (await t.request("/", { headers: { authorization: "Bearer shared-secret-token" } })).status ===
    200,
)
const unset = new Hono()
  .use(
    "*",
    requireSharedToken(() => undefined),
  )
  .get("/", (c) => c.text("ok"))
ok(
  "requireSharedToken: unset secret fails closed",
  (await unset.request("/", { headers: { authorization: "Bearer " } })).status === 401,
)

// --- requireAuth (API token or session) ---
const { token, hash } = await createApiToken("app")
const used: string[] = []
const a = new Hono<{ Variables: { user: { id: string } } }>()
  .use(
    "*",
    requireAuth({
      session,
      tokenPrefix: "app",
      findUserByTokenHash: async (h) => (h === hash ? { id: "token-user" } : null),
      findUserBySub: async (sub) => (sub === "u1" ? { id: "session-user" } : null),
      onTokenUsed: (h) => used.push(h),
    }),
  )
  .get("/", (c) => c.text(c.get("user").id))
const viaToken = await a.request("/", { headers: { authorization: `Bearer ${token}` } })
ok("requireAuth: API token resolves the user", (await viaToken.text()) === "token-user")
ok("requireAuth: onTokenUsed gets the hash", used[0] === hash)
ok(
  "requireAuth: unknown API token is 401 (no session fallback)",
  (
    await a.request("/", {
      headers: { authorization: "Bearer app_deadbeef", cookie: await cookieFor("u1") },
    })
  ).status === 401,
)
const viaCookie = await a.request("/", { headers: { cookie: await cookieFor("u1") } })
ok("requireAuth: session cookie resolves the user", (await viaCookie.text()) === "session-user")
ok(
  "requireAuth: session without sub is 401",
  (await a.request("/", { headers: { cookie: await cookieFor() } })).status === 401,
)
ok(
  "requireAuth: session for a deleted user is 401",
  (await a.request("/", { headers: { cookie: await cookieFor("gone") } })).status === 401,
)
ok("requireAuth: nothing is 401", (await a.request("/")).status === 401)

// --- parseBody / parseQuery / parseParams ---
const v = new Hono()
  .post("/body", async (c) => c.json(await parseBody(c, z.object({ name: z.string().min(2) }))))
  .get("/q", (c) => c.json(parseQuery(c, z.object({ tag: z.array(z.string()).or(z.string()) }))))
  .get("/p/:id", (c) => c.json(parseParams(c, z.object({ id: z.uuid() }))))
v.onError(errorHandler({ isProduction: () => true }))
const post = (body: string) =>
  v.request("/body", { method: "POST", body, headers: { "content-type": "application/json" } })
const good = await post('{"name":"Ann"}')
ok("parseBody: valid body passes", good.status === 200 && (await good.json()).name === "Ann")
const badJson = await post("{nope")
ok("parseBody: invalid JSON is 400 INVALID_JSON", (await badJson.json()).code === "INVALID_JSON")
const invalid = await (await post('{"name":"A"}')).json()
ok(
  "parseBody: field errors land in details.fieldErrors",
  invalid.code === "VALIDATION_FAILED" && invalid.details?.fieldErrors?.name?.length === 1,
  invalid,
)
const formLevel = await (await post("[]")).json()
ok(
  "parseBody: a root-level issue lands in formErrors",
  formLevel.details?.formErrors?.length === 1,
  formLevel,
)
ok(
  "parseQuery: a repeated key is an array",
  JSON.stringify((await (await v.request("/q?tag=a&tag=b")).json()).tag) === '["a","b"]',
)
ok("parseQuery: a single key is a string", (await (await v.request("/q?tag=a")).json()).tag === "a")
ok("parseParams: bad uuid is 400", (await v.request("/p/not-a-uuid")).status === 400)
ok(
  "parseParams: good uuid passes",
  (await v.request("/p/0b5e4a1c-6d7e-4f80-9a1b-2c3d4e5f6a7b")).status === 200,
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
