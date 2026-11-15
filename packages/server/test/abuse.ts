/**
 * The abuse kit: captcha verifiers against a mocked siteverify (Turnstile and
 * hCaptcha), requireCaptcha on routes, disposable-email checks and
 * normalisation, blockDisposableEmail, requireAiSpend and the AI spend admin
 * routes. The spend store here is an in-memory stand-in shaped like
 * signet-db's createAiSpend; the real one runs in signet-db's tests.
 */
import { Hono } from "hono"
import {
  CAPTCHA_TEST_PASS,
  captchaVerifier,
  requireCaptcha,
  SITEVERIFY_URLS,
} from "../src/abuse/captcha"
import {
  blockDisposableEmail,
  disposableEmailChecker,
  emailDomain,
  isDisposableEmail,
  normalizeEmail,
} from "../src/abuse/email"
import { type AiSpendStore, aiSpendAdminRoutes, requireAiSpend } from "../src/http/ai-spend"
import { errorHandler } from "../src/http/errors"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const throws = (fn: () => unknown) => {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

// ------------------------------------------------------------------ captcha

type Call = { url: string; form: URLSearchParams }
function mockFetch(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), form: new URLSearchParams(init.body as URLSearchParams) }
    calls.push(call)
    return reply(call)
  }) as unknown as typeof fetch
  return { f, calls }
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } })

{
  const { f, calls } = mockFetch(({ form }) =>
    form.get("response") === "good"
      ? json({ success: true, hostname: "app.example.com", action: "signup" })
      : json({ success: false, "error-codes": ["invalid-input-response"] }),
  )
  const v = captchaVerifier({ provider: "turnstile", secret: "s3cret", fetch: f })
  const good = await v.verify("good", { ip: "203.0.113.9" })
  ok("turnstile: a good token passes", good.ok && good.hostname === "app.example.com")
  ok(
    "turnstile: posts secret, response and remoteip to its siteverify",
    calls[0]?.url === SITEVERIFY_URLS.turnstile &&
      calls[0].form.get("secret") === "s3cret" &&
      calls[0].form.get("response") === "good" &&
      calls[0].form.get("remoteip") === "203.0.113.9",
    calls[0],
  )
  const badToken = await v.verify("bad")
  ok(
    "turnstile: a refused token is invalid with the provider's codes",
    !badToken.ok &&
      badToken.reason === "invalid" &&
      badToken.errorCodes[0] === "invalid-input-response",
  )
  const n = calls.length
  const missing = await v.verify("")
  ok(
    "missing token: no network call",
    !missing.ok && missing.reason === "missing" && calls.length === n,
  )
  const huge = await v.verify("x".repeat(3000))
  ok(
    "oversized token: refused without a call",
    !huge.ok && huge.reason === "invalid" && calls.length === n,
  )

  const host = captchaVerifier({
    provider: "turnstile",
    secret: "s",
    fetch: f,
    hostname: ["other.example.com"],
  })
  const h = await host.verify("good")
  ok("hostname mismatch is refused", !h.ok && h.errorCodes[0] === "hostname-mismatch")
  const act = captchaVerifier({ provider: "turnstile", secret: "s", fetch: f, action: "login" })
  const a = await act.verify("good")
  ok("action mismatch is refused", !a.ok && a.errorCodes[0] === "action-mismatch")
  const actOk = captchaVerifier({ provider: "turnstile", secret: "s", fetch: f, action: "signup" })
  ok("matching action passes", (await actOk.verify("good")).ok)
}

{
  const { f, calls } = mockFetch(() => json({ success: true, hostname: "h.example" }))
  const v = captchaVerifier({ provider: "hcaptcha", secret: "hs", siteKey: "site-1", fetch: f })
  ok("hcaptcha: a good token passes", (await v.verify("tok")).ok)
  ok(
    "hcaptcha: posts to its siteverify with the site key",
    calls[0]?.url === SITEVERIFY_URLS.hcaptcha && calls[0].form.get("sitekey") === "site-1",
  )
}

{
  const down = mockFetch(() => json({}, 500))
  const v = captchaVerifier({ provider: "hcaptcha", secret: "s", fetch: down.f })
  const r = await v.verify("tok")
  ok("provider 500 is unavailable, not a pass", !r.ok && r.reason === "unavailable")
  const thrown = captchaVerifier({
    provider: "turnstile",
    secret: "s",
    fetch: (async () => {
      throw new Error("fetch failed")
    }) as unknown as typeof fetch,
  })
  const t = await thrown.verify("tok")
  ok("network error is unavailable", !t.ok && t.reason === "unavailable")
  const weird = mockFetch(() => json({ success: "true" }))
  const w = captchaVerifier({ provider: "turnstile", secret: "s", fetch: weird.f })
  ok("success must be literally true", !(await w.verify("tok")).ok)
}

{
  const v = captchaVerifier({ provider: "test" })
  ok("test mode: the fixed token passes", (await v.verify(CAPTCHA_TEST_PASS)).ok)
  const r = await v.verify("anything-else")
  ok("test mode: any other token fails", !r.ok && r.reason === "invalid")
  ok(
    "test mode throws in production and staging",
    throws(() => captchaVerifier({ provider: "test", appEnv: "production" })) &&
      throws(() => captchaVerifier({ provider: "test", appEnv: "staging" })),
  )
  ok(
    "a real provider needs a secret",
    throws(() => captchaVerifier({ provider: "turnstile" })),
  )
}

{
  const app = new Hono()
  const seen: unknown[] = []
  app.use("/signup", requireCaptcha({ verifier: captchaVerifier({ provider: "test" }) }))
  app.post("/signup", async (c) => {
    const type = c.req.header("content-type") ?? ""
    seen.push(
      type.includes("json") ? await c.req.json() : Object.fromEntries(await c.req.formData()),
    )
    return c.json({ ok: true })
  })
  app.post("/open", (c) => c.json({ ok: true }))

  const none = await app.request("/signup", { method: "POST" })
  const body = (await none.json()) as { success: boolean; code: string }
  ok(
    "no token: 400 CAPTCHA_REQUIRED in the envelope",
    none.status === 400 && body.code === "CAPTCHA_REQUIRED" && body.success === false,
  )
  const wrong = await app.request("/signup", {
    method: "POST",
    headers: { "x-captcha-token": "nope" },
  })
  ok(
    "wrong token: 403 CAPTCHA_FAILED",
    wrong.status === 403 && ((await wrong.json()) as { code: string }).code === "CAPTCHA_FAILED",
  )
  const viaHeader = await app.request("/signup", {
    method: "POST",
    headers: { "x-captcha-token": CAPTCHA_TEST_PASS, "content-type": "application/json" },
    body: JSON.stringify({ email: "a@example.com" }),
  })
  ok("header token passes", viaHeader.status === 200)
  const viaJson = await app.request("/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "b@example.com", captchaToken: CAPTCHA_TEST_PASS }),
  })
  ok(
    "JSON body token passes, and the route still reads the body",
    viaJson.status === 200 && (seen[1] as { email?: string })?.email === "b@example.com",
    seen,
  )
  const form = new FormData()
  form.set("cf-turnstile-response", CAPTCHA_TEST_PASS)
  form.set("email", "c@example.com")
  const viaForm = await app.request("/signup", { method: "POST", body: form })
  ok(
    "form field token passes, and the route still reads the form",
    viaForm.status === 200 && (seen[2] as { email?: string })?.email === "c@example.com",
  )
  ok(
    "routes without it are untouched",
    (await app.request("/open", { method: "POST" })).status === 200,
  )

  const downApp = new Hono()
  downApp.use(
    requireCaptcha({
      verifier: captchaVerifier({
        provider: "turnstile",
        secret: "s",
        fetch: (async () => json({}, 503)) as unknown as typeof fetch,
      }),
    }),
  )
  downApp.post("/", (c) => c.json({ ok: true }))
  const down = await downApp.request("/", { method: "POST", headers: { "x-captcha-token": "t" } })
  ok("provider down: 503 CAPTCHA_UNAVAILABLE (fails closed)", down.status === 503)
}

// -------------------------------------------------------- disposable email

ok(
  "emailDomain lowercases and drops a trailing dot",
  emailDomain(" Me@Example.COM. ") === "example.com",
)
ok("emailDomain: not an address is null", emailDomain("nope") === null && emailDomain("") === null)
ok("normalizeEmail drops +tags", normalizeEmail("Me+promo@Example.com") === "me@example.com")
ok(
  "normalizeEmail drops Gmail dots and maps googlemail",
  normalizeEmail("j.o.e+x@googlemail.com") === "joe@gmail.com" &&
    normalizeEmail("J.Oe@gmail.com") === "joe@gmail.com",
)
ok("normalizeEmail keeps dots elsewhere", normalizeEmail("j.oe@example.com") === "j.oe@example.com")
ok("normalizeEmail keeps a leading +", normalizeEmail("+x@example.com") === "+x@example.com")
ok("bundled list blocks a known domain", isDisposableEmail("x@mailinator.com"))
ok("subdomains of a listed domain are blocked", isDisposableEmail("x@inbox.mailinator.com"))
ok(
  "ordinary domains pass",
  !isDisposableEmail("x@gmail.com") && !isDisposableEmail("x@example.com"),
)
ok("plus-addressed disposable is still blocked", isDisposableEmail("x+1@MAILINATOR.com"))
ok("not an address is not disposable", !isDisposableEmail("mailinator.com"))
{
  const check = disposableEmailChecker({ add: ["burner.example"], allow: ["mailinator.com"] })
  ok(
    "add blocks the app's own domains and their subdomains",
    check("a@burner.example") && check("a@x.burner.example"),
  )
  ok("allow beats the bundled list", !check("a@mailinator.com") && !check("a@sub.mailinator.com"))
  const both = disposableEmailChecker({ add: ["x.example"], allow: ["x.example"] })
  ok("allow beats add", !both("a@x.example"))
}
{
  const app = new Hono()
  app.use("/sign-up/*", blockDisposableEmail({ allow: ["guerrillamail.com"] }))
  app.post("/sign-up/email", async (c) =>
    c.json({ email: ((await c.req.json()) as { email: string }).email }),
  )
  const post = (email: string) =>
    app.request("/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    })
  const blocked = await post("a@mailinator.com")
  const b = (await blocked.json()) as {
    code: string
    details: { fieldErrors: Record<string, string[]> }
  }
  ok(
    "blockDisposableEmail: 400 DISPOSABLE_EMAIL with the field error",
    blocked.status === 400 &&
      b.code === "DISPOSABLE_EMAIL" &&
      !!b.details.fieldErrors.email?.length,
    b,
  )
  const fine = await post("a@example.com")
  ok(
    "a permanent address reaches the route with its body",
    fine.status === 200 && ((await fine.json()) as { email: string }).email === "a@example.com",
  )
  ok("allow passes through the middleware", (await post("a@guerrillamail.com")).status === 200)
}

// ------------------------------------------------------------------ AI spend

const capsStored: Array<Record<string, unknown>> = []
const used = 0
let storeDown = false
const resetsAt = new Date(Date.now() + 3600_000)
const spend: AiSpendStore = {
  async check(subject, estimate = 0) {
    if (storeDown) throw new Error("db down")
    if (subject.userId === "heavy" || used + estimate > 100)
      return {
        ok: false,
        scope: "user",
        subject: "heavy",
        period: "day",
        capUnits: 100,
        usedUnits: 100,
        resetsAt,
      }
    if (subject.orgId === "big")
      return {
        ok: false,
        scope: "org",
        subject: "big",
        period: "month",
        capUnits: 5,
        usedUnits: 9,
        resetsAt,
      }
    return { ok: true }
  },
  async usage(scope, id) {
    return { scope, subject: id ?? "*", day: { used }, month: { used } }
  },
  async top(scope) {
    return [{ subject: `${scope}-1`, used: 10, cap: null }]
  },
  async caps() {
    return capsStored
  },
  async setCap(input, opts) {
    if (input.scope === "global" && input.subject && input.subject !== "*") {
      const e = new Error('A global cap has subject "*".') as Error & { code: string }
      e.name = "SignetDbError"
      e.code = "BAD_VALUE"
      throw e
    }
    const row = { ...input, subject: input.subject ?? "*", updatedBy: opts?.actor?.id ?? null }
    capsStored.push(row)
    return row
  },
  async removeCap(scope, subject, period) {
    const i = capsStored.findIndex(
      (r) => r.scope === scope && r.subject === subject && r.period === period,
    )
    if (i < 0) return false
    capsStored.splice(i, 1)
    return true
  },
}

{
  const app = new Hono()
  app.use(
    "/ai/*",
    requireAiSpend({
      spend,
      subject: (c) => ({ userId: c.req.header("x-user"), orgId: c.req.header("x-org") }),
    }),
  )
  app.post("/ai/ask", (c) => c.json({ answer: 42 }))
  const ask = (h: Record<string, string>) => app.request("/ai/ask", { method: "POST", headers: h })
  ok("under every cap: the route runs", (await ask({ "x-user": "u1" })).status === 200)
  const over = await ask({ "x-user": "heavy" })
  const ob = (await over.json()) as {
    success: boolean
    code: string
    error: string
    details: { formErrors: string[] }
  }
  ok(
    "over the user's daily cap: 429 AI_SPEND_CAP_EXCEEDED naming the cap",
    over.status === 429 &&
      ob.success === false &&
      ob.code === "AI_SPEND_CAP_EXCEEDED" &&
      ob.details.formErrors[0] === "user:day" &&
      ob.error.includes("daily"),
    ob,
  )
  const retry = Number(over.headers.get("retry-after"))
  ok("Retry-After until the period rolls over", retry > 3500 && retry <= 3600, retry)
  const org = await ask({ "x-user": "u1", "x-org": "big" })
  ok(
    "over the org's monthly cap",
    org.status === 429 &&
      ((await org.json()) as { error: string }).error.includes("organisation's monthly"),
  )
  storeDown = true
  const down = await ask({ "x-user": "u1" })
  ok(
    "store down: 503 AI_SPEND_UNAVAILABLE (fails closed)",
    down.status === 503 &&
      ((await down.json()) as { code: string }).code === "AI_SPEND_UNAVAILABLE",
  )
  storeDown = false

  const est = new Hono()
  est.use(requireAiSpend({ spend, subject: () => ({ userId: "u2" }), estimateUnits: 500 }))
  est.post("/", (c) => c.json({}))
  ok(
    "an estimate past the cap is refused up front",
    (await est.request("/", { method: "POST" })).status === 429,
  )
}

{
  let admin = false
  const app = new Hono()
  app.onError(errorHandler({ isProduction: () => false }))
  app.route(
    "/admin",
    aiSpendAdminRoutes({
      spend,
      authorize: () => admin,
      actor: () => ({ type: "user", id: "admin-1" }),
    }),
  )
  const req = (path: string, init: RequestInit = {}) =>
    app.request(`/admin${path}`, { ...init, headers: { "content-type": "application/json" } })

  ok("deny by default: 403 FORBIDDEN", (await req("/usage")).status === 403)
  const truthy = new Hono()
  truthy.onError(errorHandler({ isProduction: () => false }))
  truthy.route("/a", aiSpendAdminRoutes({ spend, authorize: () => "yes" }))
  ok("only literal true authorizes", (await truthy.request("/a/caps")).status === 403)
  admin = true

  const usage = (await (await req("/usage")).json()) as {
    global: { scope: string }
    top: { users: unknown[]; orgs: unknown[] }
  }
  ok(
    "GET /usage: global and top users and orgs",
    usage.global.scope === "global" && usage.top.users.length === 1 && usage.top.orgs.length === 1,
  )
  const one = (await (await req("/usage/user/u1")).json()) as { subject: string }
  ok("GET /usage/:scope/:id", one.subject === "u1")
  ok("unknown scope is 400", (await req("/usage/team/x")).status === 400)

  const put = await req("/caps", {
    method: "PUT",
    body: JSON.stringify({ scope: "user", subject: "u1", period: "day", units: 5000 }),
  })
  const pb = (await put.json()) as { cap: { updatedBy: string } }
  ok("PUT /caps stores a cap with the actor", put.status === 200 && pb.cap.updatedBy === "admin-1")
  ok(
    "PUT /caps units null is unlimited",
    (
      await req("/caps", {
        method: "PUT",
        body: JSON.stringify({ scope: "org", subject: "o1", period: "month", units: null }),
      })
    ).status === 200,
  )
  for (const [name, b] of [
    ["negative units", { scope: "user", period: "day", units: -1 }],
    ["fractional units", { scope: "user", period: "day", units: 1.5 }],
    ["missing units", { scope: "user", period: "day" }],
    ["bad period", { scope: "user", period: "week", units: 1 }],
    ["bad scope", { scope: "team", period: "day", units: 1 }],
  ] as const) {
    const r = await req("/caps", { method: "PUT", body: JSON.stringify(b) })
    ok(
      `PUT /caps refuses ${name} with 400 VALIDATION_FAILED`,
      r.status === 400 && ((await r.json()) as { code: string }).code === "VALIDATION_FAILED",
    )
  }
  const dbErr = await req("/caps", {
    method: "PUT",
    body: JSON.stringify({ scope: "global", subject: "x", period: "day", units: 1 }),
  })
  ok("a signet-db BAD_VALUE is a 400 envelope", dbErr.status === 400)
  ok(
    "invalid JSON is 400",
    (await app.request("/admin/caps", { method: "PUT", body: "{" })).status === 400,
  )
  const listed = (await (await req("/caps")).json()) as { caps: unknown[] }
  ok("GET /caps lists them", listed.caps.length === 2)
  ok(
    "DELETE /caps removes one",
    (await req("/caps/user/u1/day", { method: "DELETE" })).status === 200,
  )
  ok(
    "DELETE a missing cap is 404",
    (await req("/caps/user/u1/day", { method: "DELETE" })).status === 404,
  )
}

{
  // signet-ai's AiError, by shape: a refusal from inside a handler is never a 500.
  const aiError = (code: string, retryAfter?: number) =>
    Object.assign(new Error("AI budget window exhausted"), {
      name: "ApiError",
      code,
      status: 429,
      retryAfter,
    })
  const app = new Hono()
  let reported = 0
  app.onError(errorHandler({ isProduction: () => true, onError: () => void reported++ }))
  app.get("/over", () => {
    throw aiError("AI_BUDGET_EXCEEDED")
  })
  app.get("/over-retry", () => {
    throw aiError("AI_BUDGET_EXCEEDED", 42)
  })
  app.get("/store", () => {
    throw aiError("AI_BUDGET_STORE_FAILED")
  })
  const over = await app.request("/over")
  const ob = (await over.json()) as { success: boolean; code: string }
  ok(
    "errorHandler: AI_BUDGET_EXCEEDED is 429 AI_SPEND_CAP_EXCEEDED, not a 500",
    over.status === 429 &&
      ob.success === false &&
      ob.code === "AI_SPEND_CAP_EXCEEDED" &&
      !over.headers.get("retry-after"),
    ob,
  )
  ok(
    "errorHandler: Retry-After when the error knows it",
    (await app.request("/over-retry")).headers.get("retry-after") === "42",
  )
  const store = await app.request("/store")
  ok(
    "errorHandler: AI_BUDGET_STORE_FAILED is 503 AI_SPEND_UNAVAILABLE",
    store.status === 503 &&
      ((await store.json()) as { code: string }).code === "AI_SPEND_UNAVAILABLE",
  )
  ok("errorHandler: budget refusals are not reported as crashes", reported === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
