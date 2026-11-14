/**
 * Phase 2 auth backend: key rotation, stored sessions (devices, revoke,
 * fixation), phone OTP, API-key manager, and the per-user MCP tools.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { Hono, type MiddlewareHandler } from "hono"
import { kvRateLimitStore, memoryKv } from "../src/adapters"
import { createApiKey, kvApiKeyStore, listApiKeys, revokeApiKey } from "../src/auth/api-keys"
import { requireApiKey, requireSession, sessionRoutes } from "../src/auth/hono"
import { authTools } from "../src/auth/mcp"
import {
  devSmsSender,
  normalizePhone,
  type PhoneOtpOptions,
  requestPhoneOtp,
  verifyPhoneOtp,
} from "../src/auth/otp"
import { checkSession, issueSession, verifySession } from "../src/auth/session"
import {
  cachedSessionStore,
  deviceLabel,
  kvSessionStore,
  rotateSession,
  type SessionStore,
  startSession,
  validateSession,
} from "../src/auth/sessions"
import { mountMcp } from "../src/mcp/hono"
import type { VerifiedToken } from "../src/oauth-rs/verify"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean | undefined, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const OLD = "old-secret-that-is-at-least-32-characters"
const NEW = "new-secret-that-is-at-least-32-characters"
const UA_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

// --- key rotation, stateless ---
{
  const oldOpts = { cookieName: "sid", secret: OLD }
  const rotated = { cookieName: "sid", secret: NEW, previousSecrets: [OLD] }
  const token = await issueSession(oldOpts, "u1")
  const checked = await checkSession(token, rotated)
  ok("rotation: token signed with the previous key still verifies", checked?.payload.sub === "u1")
  ok("rotation: and comes back re-signed", !!checked?.resigned && checked.resigned !== token)
  const again = await checkSession(checked?.resigned, { cookieName: "sid", secret: NEW })
  ok(
    "rotation: the re-signed token verifies with the new key alone, same exp",
    again?.payload.exp === checked?.payload.exp && !again?.resigned,
  )
  ok(
    "rotation: without previousSecrets the old token is refused",
    (await verifySession(token, { cookieName: "sid", secret: NEW })) === null,
  )
  ok(
    "rotation: a current-key token is not re-signed",
    !(await checkSession(await issueSession(rotated, "u1"), rotated))?.resigned,
  )
  const app = new Hono()
    .use("*", requireSession(rotated))
    .get("/", (c) => c.text((c.get("session" as never) as { sub: string }).sub))
  const res = await app.request("/", { headers: { cookie: `sid=${token}` } })
  const set = res.headers.get("set-cookie") ?? ""
  ok(
    "rotation: requireSession accepts the old key and re-sends the cookie",
    res.status === 200 && set.startsWith(`sid=${checked?.resigned}`),
    set,
  )
  ok(
    "rotation: tampered token is refused under every key",
    (await checkSession(`${token}x`, rotated)) === null,
  )
}

// --- device label ---
ok("deviceLabel: Chrome on macOS", deviceLabel(UA_MAC) === "Chrome on macOS", deviceLabel(UA_MAC))
ok("deviceLabel: Safari on iOS", deviceLabel(UA_IPHONE) === "Safari on iOS", deviceLabel(UA_IPHONE))
ok("deviceLabel: missing UA", deviceLabel(undefined) === "Unknown device")
ok("deviceLabel: CLI UA", deviceLabel("curl/8.4.0") === "curl")

// --- stored sessions ---
const kv = memoryKv()
const store = kvSessionStore(kv)
const opts = { cookieName: "sid", secret: NEW, store }

{
  const a = await startSession(opts, { sub: "u1", userAgent: UA_MAC, ip: "1.2.3.4" })
  const b = await startSession(opts, { sub: "u1", userAgent: UA_IPHONE })
  const c = await startSession(opts, { sub: "u1" })
  await startSession(opts, { sub: "u2" })
  ok(
    "sessions: a fresh session validates",
    (await validateSession(a.token, opts))?.record.id === a.record.id,
  )
  ok(
    "sessions: stateless verifySession refuses a stored-session token",
    (await verifySession(a.token, opts)) === null,
  )
  const list = await store.listByUser("u1")
  ok("sessions: list by user has only that user's sessions", list.length === 3, list)
  ok(
    "sessions: record has device and ip",
    list.find((r) => r.id === a.record.id)?.device === "Chrome on macOS" &&
      list.find((r) => r.id === a.record.id)?.ip === "1.2.3.4",
  )

  await store.revoke(b.record.id)
  ok("revoke one: that session is dead", (await validateSession(b.token, opts)) === null)
  ok("revoke one: others live", (await validateSession(a.token, opts)) !== null)

  const n = await store.revokeAll("u1", { except: a.record.id })
  ok("revoke all but current: counts the others", n === 1, n)
  ok("revoke all but current: current lives", (await validateSession(a.token, opts)) !== null)
  ok("revoke all but current: other is dead", (await validateSession(c.token, opts)) === null)
  ok("revoke all but current: list is just current", (await store.listByUser("u1")).length === 1)

  await store.revokeAll("u1")
  ok("revoke all: current is dead too", (await validateSession(a.token, opts)) === null)
  ok("revoke all: other users untouched", (await store.listByUser("u2")).length === 1)
}

{
  // fixation: sign-in never adopts the incoming id, and kills it
  const planted = await startSession(opts, { sub: "u3" })
  const signedIn = await startSession(opts, { sub: "u3", previousToken: planted.token })
  ok("fixation: sign-in mints a new session id", signedIn.record.id !== planted.record.id)
  ok(
    "fixation: the pre-sign-in session is revoked",
    (await validateSession(planted.token, opts)) === null,
  )

  const rotated = await rotateSession(signedIn.token, opts)
  ok(
    "privilege change: rotateSession gives a new id",
    !!rotated && rotated.record.id !== signedIn.record.id,
  )
  ok(
    "privilege change: old token stops working",
    (await validateSession(signedIn.token, opts)) === null,
  )
  ok(
    "privilege change: new token works",
    (await validateSession(rotated?.token, opts))?.record.sub === "u3",
  )
  ok(
    "privilege change: a dead token cannot rotate",
    (await rotateSession(signedIn.token, opts)) === null,
  )
}

{
  // key rotation on stored sessions
  const s = await startSession({ ...opts, secret: OLD }, { sub: "u4" })
  const v = await validateSession(s.token, { ...opts, previousSecrets: [OLD] })
  ok("stored + rotation: old-key cookie accepted and re-signed", !!v?.resigned)
}

{
  // lastSeen touch is throttled and cannot resurrect a revoked session
  const s = await startSession(opts, { sub: "u5" })
  const writes: string[] = []
  const spy: SessionStore = {
    ...store,
    touch: async (r, seen) => {
      writes.push(r.id)
      await store.touch(r, seen)
    },
  }
  await validateSession(s.token, { ...opts, store: spy })
  ok("touch: not written inside touchEverySeconds", writes.length === 0)
  await validateSession(s.token, { ...opts, store: spy, touchEverySeconds: 0 }, { ip: "5.6.7.8" })
  ok("touch: written when due", writes.length === 1)
  ok("touch: list shows the new ip", (await store.listByUser("u5"))[0]?.ip === "5.6.7.8")
  await store.revoke(s.record.id)
  await store.touch(s.record, { lastSeenAt: Date.now(), ip: null })
  ok(
    "touch: a late touch does not bring a revoked session back",
    (await store.get(s.record.id)) === null,
  )
}

{
  // cache: saves reads; own revokes clear it at once
  let reads = 0
  const counting: SessionStore = {
    ...store,
    get: async (id) => {
      reads++
      return store.get(id)
    },
  }
  const cached = cachedSessionStore(counting, { seconds: 60 })
  const copts = { ...opts, store: cached }
  const s = await startSession(copts, { sub: "u6" })
  await validateSession(s.token, copts)
  await validateSession(s.token, copts)
  ok("cache: second validation does not hit the store", reads === 1, reads)
  await cached.revoke(s.record.id)
  ok(
    "cache: a revoke through the cache takes effect at once",
    (await validateSession(s.token, copts)) === null,
  )
}

// --- "your devices" routes ---
{
  const routesKv = memoryKv()
  const rstore = kvSessionStore(routesKv)
  const ropts = { cookieName: "sid", secret: NEW, store: rstore }
  const app = new Hono().route("/s", sessionRoutes(ropts))
  const mine = await startSession(ropts, { sub: "r1", userAgent: UA_MAC })
  const other = await startSession(ropts, { sub: "r1", userAgent: UA_IPHONE })
  const third = await startSession(ropts, { sub: "r1" })
  const stranger = await startSession(ropts, { sub: "r2" })
  const cookie = { cookie: `sid=${mine.token}` }

  ok("routes: no cookie is 401", (await app.request("/s")).status === 401)
  const listed = (await (await app.request("/s", { headers: cookie })).json()) as {
    sessions: Array<{ id: string; current: boolean; sub?: string; device: string }>
  }
  ok(
    "routes: list marks the current session and hides sub",
    listed.sessions.length === 3 &&
      listed.sessions
        .filter((s) => s.current)
        .map((s) => s.id)
        .join() === mine.record.id &&
      listed.sessions.every((s) => s.sub === undefined),
    listed,
  )
  ok(
    "routes: cannot revoke someone else's session (404)",
    (await app.request(`/s/${stranger.record.id}`, { method: "DELETE", headers: cookie }))
      .status === 404 && (await validateSession(stranger.token, ropts)) !== null,
  )
  const del = await app.request(`/s/${other.record.id}`, { method: "DELETE", headers: cookie })
  ok(
    "routes: revoke one of mine",
    del.status === 200 && (await validateSession(other.token, ropts)) === null,
  )
  const others = await app.request("/s/revoke-others", { method: "POST", headers: cookie })
  ok(
    "routes: sign out everywhere else",
    ((await others.json()) as { revoked: number }).revoked === 1 &&
      (await validateSession(third.token, ropts)) === null &&
      (await validateSession(mine.token, ropts)) !== null,
  )
  const self = await app.request(`/s/${mine.record.id}`, { method: "DELETE", headers: cookie })
  ok(
    "routes: revoking the current session clears the cookie",
    self.status === 200 && (self.headers.get("set-cookie") ?? "").includes("Max-Age=0"),
  )
  ok("routes: and it is then 401", (await app.request("/s", { headers: cookie })).status === 401)
}

// --- phone OTP ---
ok("phone: 10-digit Indian", normalizePhone("98765 43210") === "+919876543210")
ok("phone: trunk 0", normalizePhone("098765-43210") === "+919876543210")
ok("phone: 91 without plus", normalizePhone("919876543210") === "+919876543210")
ok("phone: +91 with spaces", normalizePhone("+91 98765 43210") === "+919876543210")
ok("phone: 00 international", normalizePhone("0044 20 7946 0958") === "+442079460958")
ok("phone: E.164 US", normalizePhone("+1 (415) 555-0100") === "+14155550100")
ok("phone: Indian landline-looking mobile rejected", normalizePhone("+91 12345 67890") === null)
ok(
  "phone: garbage rejected",
  normalizePhone("call me") === null && normalizePhone("12345") === null,
)

{
  const sent: Array<{ to: string; message: string }> = []
  const logs: string[] = []
  const origLog = console.log
  const origErr = console.error
  const origWarn = console.warn
  const capture = (...a: unknown[]) => logs.push(a.map(String).join(" "))
  let now = Date.now()
  const realNow = Date.now
  const otpKv = memoryKv()
  const base: PhoneOtpOptions = {
    kv: otpKv,
    secret: NEW,
    sender: { send: async (to, message) => void sent.push({ to, message }) },
    rateLimit: kvRateLimitStore(memoryKv()),
  }
  const lastCode = () => sent.at(-1)?.message.match(/\d{6}/)?.[0] ?? ""

  console.log = capture
  console.error = capture
  console.warn = capture
  try {
    const r = await requestPhoneOtp(base, { phone: "9876543210", ip: "1.1.1.1" })
    const code = lastCode()
    ok("otp: request sends to the E.164 number", r.ok && sent[0]?.to === "+919876543210")
    const stored = [...((await otpKv.get("signet-otp:c:+919876543210")) ?? "")].join("")
    ok("otp: the code is not stored in plain text", stored.length > 0 && !stored.includes(code))
    ok(
      "otp: wrong code",
      (
        await verifyPhoneOtp(base, {
          phone: "+919876543210",
          code: "000000" === code ? "111111" : "000000",
        })
      ).ok === false,
    )
    const good = await verifyPhoneOtp(base, { phone: "098765 43210", code })
    ok(
      "otp: right code verifies (any spelling of the number)",
      good.ok && good.phone === "+919876543210",
      good,
    )
    const reuse = await verifyPhoneOtp(base, { phone: "9876543210", code })
    ok("otp: single use", !reuse.ok && reuse.code === "CODE_EXPIRED", reuse)

    // attempts cap
    await requestPhoneOtp(base, { phone: "9876500001", ip: "1.1.1.2" })
    const capped = lastCode()
    const wrong = capped === "123456" ? "654321" : "123456"
    const results: string[] = []
    for (let i = 0; i < 5; i++) {
      const v = await verifyPhoneOtp(base, { phone: "9876500001", code: wrong })
      results.push(v.ok ? "ok" : v.code)
    }
    ok(
      "otp: fifth wrong guess destroys the code",
      results.slice(0, 4).every((x) => x === "INVALID_CODE") && results[4] === "TOO_MANY_ATTEMPTS",
      results,
    )
    const after = await verifyPhoneOtp(base, { phone: "9876500001", code: capped })
    ok("otp: the right code is useless after the cap", !after.ok, after)

    // expiry
    await requestPhoneOtp({ ...base, ttlSeconds: 60 }, { phone: "9876500002", ip: "1.1.1.3" })
    const expiring = lastCode()
    now = realNow() + 61_000
    Date.now = () => now
    const late = await verifyPhoneOtp(base, { phone: "9876500002", code: expiring })
    Date.now = realNow
    ok("otp: expired code is refused", !late.ok && late.code === "CODE_EXPIRED", late)

    // rate limits
    const rl = { ...base, rateLimit: kvRateLimitStore(memoryKv()) }
    const perPhone: boolean[] = []
    for (let i = 0; i < 4; i++)
      perPhone.push((await requestPhoneOtp(rl, { phone: "9876500003", ip: `2.2.2.${i}` })).ok)
    ok("otp: per-phone limit (3 per window)", perPhone.join() === "true,true,true,false", perPhone)
    const perIp: boolean[] = []
    for (let i = 0; i < 3; i++)
      perIp.push(
        (
          await requestPhoneOtp(
            { ...rl, perIp: { max: 2, windowSeconds: 3600 } },
            { phone: `98765100${10 + i}`, ip: "3.3.3.3" },
          )
        ).ok,
      )
    ok("otp: per-IP limit", perIp.join() === "true,true,false", perIp)
    const limited = await requestPhoneOtp(rl, { phone: "9876500003", ip: "9.9.9.9" })
    ok(
      "otp: rate-limited result carries retryAfterSeconds and sends nothing",
      !limited.ok && limited.code === "RATE_LIMITED" && limited.retryAfterSeconds > 0,
    )
    ok(
      "otp: invalid phone sends nothing",
      (await requestPhoneOtp(base, { phone: "nope" })).ok === false,
    )

    // per-IP cap on FAILED verifies: one IP cannot spray guesses across numbers
    const vopts: PhoneOtpOptions = {
      ...base,
      kv: memoryKv(),
      rateLimit: kvRateLimitStore(memoryKv()),
      verifyFailuresPerIp: { max: 3, windowSeconds: 3600 },
    }
    const phones = ["9876600001", "9876600002", "9876600003", "9876600004", "9876600005"]
    const codes: Record<string, string> = {}
    for (const [i, p] of phones.entries()) {
      await requestPhoneOtp(vopts, { phone: p, ip: `6.6.6.${i}` })
      codes[p] = lastCode()
    }
    const wrongFor = (p: string) => (codes[p] === "000000" ? "111111" : "000000")
    // successes do not count
    const okFirst = await verifyPhoneOtp(vopts, {
      phone: phones[0]!,
      code: codes[phones[0]!]!,
      ip: "7.7.7.7",
    })
    const spray: string[] = []
    for (const p of phones.slice(1, 4)) {
      const v = await verifyPhoneOtp(vopts, { phone: p, code: wrongFor(p), ip: "7.7.7.7" })
      spray.push(v.ok ? "ok" : v.code)
    }
    ok(
      "otp verify per-IP: successes are not counted, failures are",
      okFirst.ok && spray.every((x) => x === "INVALID_CODE"),
      spray,
    )
    const blocked = await verifyPhoneOtp(vopts, {
      phone: phones[4]!,
      code: codes[phones[4]!]!,
      ip: "7.7.7.7",
    })
    ok(
      "otp verify per-IP: past the limit even a right code gets TOO_MANY_ATTEMPTS",
      !blocked.ok && blocked.code === "TOO_MANY_ATTEMPTS",
      blocked,
    )
    const elsewhere = await verifyPhoneOtp(vopts, {
      phone: phones[4]!,
      code: codes[phones[4]!]!,
      ip: "8.8.8.8",
    })
    ok(
      "otp verify per-IP: the blocked try used none of the phone's attempts or its code",
      elsewhere.ok,
      elsewhere,
    )
    const noIp = await verifyPhoneOtp(vopts, { phone: phones[1]!, code: codes[phones[1]!]! })
    ok("otp verify per-IP: no ip means no shared bucket", noIp.ok, noIp)
  } finally {
    console.log = origLog
    console.error = origErr
    console.warn = origWarn
    Date.now = realNow
  }
  const codes = sent.map((s) => s.message.match(/\d{6}/)?.[0]).filter(Boolean) as string[]
  ok(
    "otp: no code ever reaches the console",
    codes.length > 0 && !logs.some((l) => codes.some((c) => l.includes(c))),
    logs,
  )
  let threw = false
  try {
    devSmsSender({ appEnv: "production" })
  } catch {
    threw = true
  }
  ok("otp: devSmsSender refuses to run in production", threw)
}

// --- API keys ---
{
  const keyKv = memoryKv()
  const keys = kvApiKeyStore(keyKv)
  const { token, key } = await createApiKey(keys, {
    sub: "k1",
    name: "CI",
    prefix: "app",
    scopes: ["read"],
  })
  ok("apikey: token has the prefix", token.startsWith("app_") && token.length === 68)
  ok("apikey: returned info has no hash", !("hash" in key) && key.start === token.slice(0, 10))
  const dump =
    JSON.stringify(await Promise.all([...["signet-key:u:k1"]].map((k) => keyKv.get(k)))) +
    JSON.stringify((await keys.listByUser("k1"))[0])
  ok("apikey: only the hash is stored, never the token", !dump.includes(token))
  const listed = await listApiKeys(keys, "k1")
  ok(
    "apikey: list shows name, start, scopes and no secret",
    listed.length === 1 &&
      listed[0]?.name === "CI" &&
      !JSON.stringify(listed).includes(token) &&
      !("hash" in (listed[0] ?? {})),
  )

  const app = new Hono()
    .use("/read/*", requireApiKey({ store: keys, prefix: "app", scopes: ["read"] }))
    .use("/write/*", requireApiKey({ store: keys, prefix: "app", scopes: ["write"] }))
    .get("/read/x", (c) => c.json(c.get("apiKey" as never)))
    .get("/write/x", (c) => c.text("w"))
  const auth = { authorization: `Bearer ${token}` }
  const r = await app.request("/read/x", { headers: auth })
  const body = (await r.json()) as Record<string, unknown>
  ok(
    "apikey: authenticates with the right scope",
    r.status === 200 && body.name === "CI" && !("hash" in body),
  )
  ok(
    "apikey: missing scope is 403",
    (await app.request("/write/x", { headers: auth })).status === 403,
  )
  ok(
    "apikey: unknown key is 401",
    (await app.request("/read/x", { headers: { authorization: `Bearer app_${"0".repeat(64)}` } }))
      .status === 401,
  )
  ok("apikey: no key is 401", (await app.request("/read/x")).status === 401)
  ok("apikey: lastUsedAt recorded", ((await listApiKeys(keys, "k1"))[0]?.lastUsedAt ?? 0) > 0)

  ok(
    "apikey: someone else cannot revoke it",
    (await revokeApiKey(keys, "intruder", key.id)) === false,
  )
  ok("apikey: owner revokes it", (await revokeApiKey(keys, "k1", key.id)) === true)
  ok("apikey: revoked key is 401", (await app.request("/read/x", { headers: auth })).status === 401)
  await keys.touch({ ...key, hash: "x" }, Date.now())
  ok("apikey: list is empty after revoke", (await listApiKeys(keys, "k1")).length === 0)

  const short = await createApiKey(keys, {
    sub: "k1",
    name: "temp",
    prefix: "app",
    scopes: ["read"],
    expiresInSeconds: 60,
  })
  const realNow = Date.now
  Date.now = () => realNow() + 61_000
  const expired = await app.request("/read/x", {
    headers: { authorization: `Bearer ${short.token}` },
  })
  Date.now = realNow
  ok("apikey: expired key is 401", expired.status === 401)
}

// --- MCP tools ---
{
  const mkv = memoryKv()
  const sessions = kvSessionStore(mkv)
  const apiKeys = kvApiKeyStore(mkv)
  const sopts = { cookieName: "sid", secret: NEW, store: sessions }
  const s1 = await startSession(sopts, { sub: "m1", userAgent: UA_MAC })
  const s2 = await startSession(sopts, { sub: "m1", userAgent: UA_IPHONE })
  const other = await startSession(sopts, { sub: "m2" })
  const { token, key } = await createApiKey(apiKeys, { sub: "m1", name: "agent", prefix: "app" })

  const fakeAuth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("authorization")?.replace(/^Bearer /, "")
    if (sub) {
      const t: VerifiedToken = { claims: { iss: "i", sub, aud: "a", exp: 0 }, scopes: [] }
      c.set("token" as never, t as never)
    }
    await next()
  }
  const app = new Hono()
  mountMcp(app, "/mcp", {
    name: "auth",
    version: "1",
    middleware: [fakeAuth],
    confirm: { key: "k".repeat(32) },
    tools: authTools({ sessions, apiKeys }),
  })
  const connect = async (user?: string, approve?: boolean) => {
    const client = new Client(
      { name: "t", version: "0" },
      {
        versionNegotiation: { mode: { pin: "2026-07-28" } },
        ...(approve !== undefined ? { capabilities: { elicitation: { form: {} } } } : {}),
      },
    )
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://t.local/mcp"), {
        fetch: async (u, i) => {
          const req = new Request(u, i)
          if (user) req.headers.set("authorization", `Bearer ${user}`)
          return app.fetch(req)
        },
      }),
    )
    if (approve !== undefined)
      client.setRequestHandler("elicitation/create", async () =>
        approve ? { action: "accept", content: { confirm: true } } : { action: "decline" },
      )
    return client
  }
  const text = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0]?.text ?? ""
  const structured = (r: unknown) =>
    (r as { structuredContent?: Record<string, unknown> }).structuredContent

  const anon = await connect()
  const ar = await anon.callTool({ name: "list_my_sessions", arguments: {} })
  ok("mcp: no user is refused", structured(ar)?.code === "UNAUTHORIZED", ar)
  await anon.close()

  const plain = await connect("m1")
  const names = (await plain.listTools()).tools
    .map((t) => t.name)
    .sort()
    .join()
  ok(
    "mcp: four tools",
    names === "list_api_keys,list_my_sessions,revoke_api_key,revoke_session",
    names,
  )
  const ls = text(await plain.callTool({ name: "list_my_sessions", arguments: {} }))
  ok(
    "mcp: list_my_sessions lists only mine",
    ls.includes(s1.record.id) && ls.includes(s2.record.id) && !ls.includes(other.record.id),
  )
  const lk = text(await plain.callTool({ name: "list_api_keys", arguments: {} }))
  ok(
    "mcp: list_api_keys never shows the secret or hash",
    lk.includes(key.id) && !lk.includes(token) && !lk.includes("hash"),
  )
  const noAsk = await plain.callTool({ name: "revoke_session", arguments: { id: s2.record.id } })
  ok(
    "mcp: revoke without elicitation needs approval and does nothing",
    structured(noAsk)?.code === "APPROVAL_REQUIRED" && (await sessions.get(s2.record.id)) !== null,
    noAsk,
  )
  await plain.close()

  const declining = await connect("m1", false)
  await declining.callTool({ name: "revoke_api_key", arguments: { id: key.id } })
  ok("mcp: declined revoke keeps the key", (await listApiKeys(apiKeys, "m1")).length === 1)
  await declining.close()

  const approving = await connect("m1", true)
  const notMine = await approving.callTool({
    name: "revoke_session",
    arguments: { id: other.record.id },
  })
  ok(
    "mcp: cannot revoke another user's session",
    text(notMine) === "No such session." && (await sessions.get(other.record.id)) !== null,
  )
  await approving.callTool({ name: "revoke_session", arguments: { id: s2.record.id } })
  ok("mcp: approved revoke_session signs it out", (await validateSession(s2.token, sopts)) === null)
  await approving.callTool({ name: "revoke_api_key", arguments: { id: key.id } })
  ok("mcp: approved revoke_api_key revokes", (await listApiKeys(apiKeys, "m1")).length === 0)
  await approving.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
