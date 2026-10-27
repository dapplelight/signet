import { Hono } from "hono"
import { z } from "zod"
import { getRuntimeEnv, initRuntimeEnv, resetRuntimeEnv } from "../src/env/runtime"
import { createEnv } from "../src/env/schema"
import { corsMiddleware } from "../src/middleware/cors"
import { clientIp, memoryStore, rateLimit } from "../src/middleware/rate-limit"
import { requestId } from "../src/middleware/request-id"
import { STRICT_CSP, secureHeaders } from "../src/middleware/secure-headers"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean) => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n))
}

// --- runtime env ---
resetRuntimeEnv()
process.env.FROM_PROCESS = "p"
ok("reads process.env", getRuntimeEnv().FROM_PROCESS === "p")
initRuntimeEnv({ FROM_WORKER: "w", FROM_PROCESS: "overridden" })
ok("injected values visible", getRuntimeEnv().FROM_WORKER === "w")
ok(
  "injected wins over process.env (app-a lost these under Bun)",
  getRuntimeEnv().FROM_PROCESS === "overridden",
)
resetRuntimeEnv()
ok("reset clears injected", getRuntimeEnv().FROM_WORKER === undefined)

// --- lazy env validation ---
const schema = z.object({ REQUIRED_KEY: z.string().min(3), PORT: z.coerce.number().default(3001) })
let validated = false
const env = createEnv(schema, {
  source: () => {
    validated = true
    return { REQUIRED_KEY: "abc" }
  },
})
ok("NOT validated at construction (CF deploy-safe)", validated === false)
ok("validates on first access", env.REQUIRED_KEY === "abc" && validated)
ok("zod defaults applied", env.PORT === 3001)
let threw = ""
try {
  createEnv(schema, { source: () => ({ REQUIRED_KEY: "x" }) }).REQUIRED_KEY
} catch (e) {
  threw = String(e)
}
ok("invalid env throws naming the field", threw.includes("REQUIRED_KEY"))
const warns: string[] = []
createEnv(z.object({ A: z.string(), B: z.string().optional() }), {
  source: () => ({ A: "1" }),
  warn: (m) => warns.push(m),
  optionalFeatures: [["B", "some feature"]],
}).A
ok(
  "warns about missing optional feature",
  warns[0]?.includes("B") && warns[0].includes("some feature"),
)

// --- rate limit ---
const store = memoryStore()
const app = new Hono()
  .use("*", rateLimit({ store, max: 2, windowSeconds: 60 }))
  .get("/", (c) => c.json({ ok: true }))
const call = () => app.request("/", { headers: { "cf-connecting-ip": "1.2.3.4" } })
const r1 = await call(),
  r2 = await call(),
  r3 = await call()
ok("allows up to max", r1.status === 200 && r2.status === 200)
ok("blocks past max with 429", r3.status === 429)
ok(
  "429 uses the shared error envelope",
  ((await r3.json()) as { success: boolean }).success === false,
)
ok("sets Retry-After", r3.headers.get("Retry-After") !== null)
ok("sets X-RateLimit-Remaining", r1.headers.get("X-RateLimit-Remaining") === "1")
const other = await app.request("/", { headers: { "cf-connecting-ip": "9.9.9.9" } })
ok("different IP has its own counter", other.status === 200)
const scoped = new Hono()
  .use("*", rateLimit({ store, scope: "login", max: 2 }))
  .get("/", (c) => c.text("x"))
ok(
  "different scope has its own counter",
  (await scoped.request("/", { headers: { "cf-connecting-ip": "1.2.3.4" } })).status === 200,
)

// clientIp precedence — cf-connecting-ip is unspoofable, xff is not
const ipApp = new Hono().get("/", (c) => c.text(clientIp(c)))
ok(
  "prefers cf-connecting-ip over spoofable xff",
  (await (
    await ipApp.request("/", {
      headers: { "cf-connecting-ip": "real", "x-forwarded-for": "spoofed" },
    })
  ).text()) === "real",
)
ok(
  "falls back to first xff entry",
  (await (
    await ipApp.request("/", {
      headers: { "x-forwarded-for": "a, b, c" },
    })
  ).text()) === "a",
)

// --- secure headers ---
const sh = new Hono()
  .use("*", secureHeaders({ relaxedPaths: ["/docs"] }))
  .get("/", (c) => c.json({}))
  .get("/docs", (c) => c.text("ui"))
const root = await sh.request("/")
ok(
  "nosniff + DENY",
  root.headers.get("X-Content-Type-Options") === "nosniff" &&
    root.headers.get("X-Frame-Options") === "DENY",
)
ok("strict CSP on API paths", root.headers.get("Content-Security-Policy") === STRICT_CSP)
ok("HSTS set", root.headers.get("Strict-Transport-Security")?.includes("31536000") === true)
ok(
  "relaxed CSP on docs path",
  (await sh.request("/docs")).headers.get("Content-Security-Policy")?.includes("jsdelivr") === true,
)
const noHsts = new Hono().use("*", secureHeaders({ hstsMaxAge: 0 })).get("/", (c) => c.text("x"))
ok(
  "hstsMaxAge 0 omits HSTS",
  (await noHsts.request("/")).headers.get("Strict-Transport-Security") === null,
)

// --- request id ---
const rid = new Hono<{ Variables: { reqId: string } }>()
  .use("*", requestId())
  .get("/", (c) => c.text(String(c.get("reqId"))))
ok("generates an id", (await rid.request("/")).headers.get("X-Request-Id")?.length === 36)
const echoed = await rid.request("/", { headers: { "x-request-id": "upstream-123" } })
ok(
  "honours upstream id",
  (await echoed.text()) === "upstream-123" && echoed.headers.get("X-Request-Id") === "upstream-123",
)

// --- cors ---
resetRuntimeEnv()
initRuntimeEnv({ WEB_URL: "https://app.example.com" })
const corsApp = new Hono()
  .use("*", corsMiddleware({ originEnvKeys: ["WEB_URL"] }))
  .get("/", (c) => c.json({}))
const allowedRes = await corsApp.request("/", { headers: { origin: "https://app.example.com" } })
ok(
  "allows configured origin",
  allowedRes.headers.get("Access-Control-Allow-Origin") === "https://app.example.com",
)
ok("credentials allowed", allowedRes.headers.get("Access-Control-Allow-Credentials") === "true")
const evil = await corsApp.request("/", { headers: { origin: "https://evil.com" } })
ok(
  "does NOT reflect an unknown origin",
  evil.headers.get("Access-Control-Allow-Origin") !== "https://evil.com",
)
ok(
  "dev origin allowed by default",
  (await corsApp.request("/", { headers: { origin: "http://localhost:5173" } })).headers.get(
    "Access-Control-Allow-Origin",
  ) === "http://localhost:5173",
)
resetRuntimeEnv()

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
