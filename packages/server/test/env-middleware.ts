import { Hono } from "hono"
import { z } from "zod"
import { getRuntimeEnv, initRuntimeEnv, resetRuntimeEnv } from "../src/env/runtime"
import { createEnv } from "../src/env/schema"
import { corsMiddleware } from "../src/middleware/cors"
import {
  type ClientIpTrust,
  clientIp,
  memoryStore,
  type RateLimitStore,
  rateLimit,
} from "../src/middleware/rate-limit"
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
  .use("*", rateLimit({ store, max: 2, windowSeconds: 60, trust: "cloudflare" }))
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
  .use("*", rateLimit({ store, scope: "login", max: 2, trust: "cloudflare" }))
  .get("/", (c) => c.text("x"))
ok(
  "different scope has its own counter",
  (await scoped.request("/", { headers: { "cf-connecting-ip": "1.2.3.4" } })).status === 200,
)

// clientIp trust — only the header the setting names is read
const ipFor = async (trust: ClientIpTrust, headers: Record<string, string>) =>
  await (
    await new Hono().get("/", (c) => c.text(String(clientIp(c, trust)))).request("/", { headers })
  ).text()
ok(
  "cloudflare: reads cf-connecting-ip, ignores xff",
  (await ipFor("cloudflare", { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "6.6.6.6" })) ===
    "1.1.1.1",
)
ok(
  "cloudflare: xff alone is no IP",
  (await ipFor("cloudflare", { "x-forwarded-for": "6.6.6.6" })) === "null",
)
ok(
  "forwardedHops 1: spoofed cf-connecting-ip is ignored",
  (await ipFor(
    { forwardedHops: 1 },
    { "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "9.9.9.9" },
  )) === "9.9.9.9",
)
ok(
  "forwardedHops 1: spoofed left xff entries are ignored",
  (await ipFor({ forwardedHops: 1 }, { "x-forwarded-for": "6.6.6.6, 9.9.9.9" })) === "9.9.9.9",
)
ok(
  "forwardedHops 2: client is 2nd from the right",
  (await ipFor({ forwardedHops: 2 }, { "x-forwarded-for": "6.6.6.6, 9.9.9.9, 10.0.0.1" })) ===
    "9.9.9.9",
)
ok(
  "forwardedHops 2 with one entry: no IP",
  (await ipFor({ forwardedHops: 2 }, { "x-forwarded-for": "9.9.9.9" })) === "null",
)
ok(
  "forwardedHops: garbage entry is no IP",
  (await ipFor({ forwardedHops: 1 }, { "x-forwarded-for": "not-an-ip" })) === "null",
)
ok(
  "none: trusts nothing",
  (await ipFor("none", { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" })) === "null",
)
{
  let threw = false
  try {
    rateLimit({ trust: { forwardedHops: 0 } })
  } catch {
    threw = true
  }
  ok("forwardedHops 0 throws at construction", threw)
}
// IPv6 grouped by /64
const v6 = (ip: string) => ipFor("cloudflare", { "cf-connecting-ip": ip })
ok(
  "ipv6: addresses in one /64 share a key",
  (await v6("2001:db8:0:1::1")) === "2001:db8:0:1::/64" &&
    (await v6("2001:0DB8:0:1:aaaa:bbbb:cccc:dddd")) === "2001:db8:0:1::/64",
)
ok("ipv6: another /64 differs", (await v6("2001:db8:0:2::1")) === "2001:db8:0:2::/64")
ok("ipv6: ::1 loopback", (await v6("::1")) === "0:0:0:0::/64")
ok("ipv6: mapped ipv4 unmaps to plain ipv4", (await v6("::ffff:1.2.3.4")) === "1.2.3.4")
ok("ipv6: mapped ipv4 in hex unmaps too", (await v6("::ffff:102:304")) === "1.2.3.4")
ok(
  "ipv6: different mapped clients get different keys",
  (await v6("::ffff:1.2.3.4")) !== (await v6("::ffff:5.6.7.8")),
)
ok("ipv6: too many groups is no IP", (await v6("1:2:3:4:5:6:7:8:9")) === "null")
ok("ipv6: two :: is no IP", (await v6("1::2::3")) === "null")

// a missing IP never lands in a shared "unknown" bucket with real clients
{
  const seen: string[] = []
  const spy: RateLimitStore = {
    async hit(scope, key) {
      seen.push(`${scope}/${key}`)
      return { ok: true, remaining: 1, resetSeconds: 1 }
    },
  }
  const app = new Hono()
    .use("/a", rateLimit({ store: spy, scope: "a", trust: "cloudflare" }))
    .use("/b", rateLimit({ store: spy, scope: "b", trust: "cloudflare" }))
    .get("/a", (c) => c.text("a"))
    .get("/b", (c) => c.text("b"))
  await app.request("/a")
  await app.request("/b")
  await app.request("/a", { headers: { "cf-connecting-ip": "no-ip" } })
  ok("no IP: keyed per limiter scope", seen[0] === "a/no-ip" && seen[1] === "b/no-ip")
  ok("no IP: a non-IP header value does not become a real key", seen[2] === "a/no-ip")
}

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
ok(
  "relaxed CSP covers sub-paths",
  (await sh.request("/docs/index.html")).headers
    .get("Content-Security-Policy")
    ?.includes("jsdelivr") === true,
)
ok(
  "relaxed CSP is not a bare prefix",
  (await sh.request("/docsx")).headers.get("Content-Security-Policy")?.includes("jsdelivr") ===
    false,
)
ok(
  "COOP and CORP set",
  (await sh.request("/docs")).headers.get("Cross-Origin-Opener-Policy") === "same-origin" &&
    (await sh.request("/docs")).headers.get("Cross-Origin-Resource-Policy") === "same-site",
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
const devOrigin = async () =>
  (await corsApp.request("/", { headers: { origin: "http://localhost:5173" } })).headers.get(
    "Access-Control-Allow-Origin",
  )
ok("dev origin denied when APP_ENV is unset", (await devOrigin()) !== "http://localhost:5173")
resetRuntimeEnv()
initRuntimeEnv({ WEB_URL: "https://app.example.com", APP_ENV: "production" })
ok("dev origin denied in production", (await devOrigin()) !== "http://localhost:5173")
resetRuntimeEnv()
initRuntimeEnv({ WEB_URL: "https://app.example.com", APP_ENV: "local" })
ok("dev origin allowed when APP_ENV=local", (await devOrigin()) === "http://localhost:5173")
resetRuntimeEnv()

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
