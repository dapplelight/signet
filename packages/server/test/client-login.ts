/**
 * Bearer sign-in for non-cookie clients: PKCE authorization code, RFC 8628
 * device code, refresh rotation with reuse detection, revoke.
 */
import { Hono } from "hono"
import { memoryKv } from "../src/adapters"
import {
  type ClientLoginOptions,
  normalizeUserCode,
  pkceChallenge,
  redirectUriAllowed,
} from "../src/auth/client-login"
import { clientLoginRoutes, requireStoredSession } from "../src/auth/hono"
import { kvSessionStore, startSession } from "../src/auth/sessions"
import { memoryStore } from "../src/middleware/rate-limit"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean | undefined, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, JSON.stringify(d)))
}

const SECRET = "test-secret-that-is-at-least-32-characters"
const EXT_REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/"
const store = kvSessionStore(memoryKv())
const sessions = { cookieName: "sid", secret: SECRET, store }
const opts: ClientLoginOptions = {
  sessions,
  kv: memoryKv(),
  rateLimit: memoryStore(),
  clients: {
    "example-extension": { redirectUris: [EXT_REDIRECT] },
    "example-desktop": { redirectUris: ["http://127.0.0.1/callback"] },
    "example-cli": {},
  },
  verificationUri: "https://app.example.test/device",
  approvalsPerUser: { max: 4, windowSeconds: 600 },
}

const app = new Hono()
app.route(
  "/auth",
  clientLoginRoutes({ ...opts, loginUrl: (r) => `/login?next=${encodeURIComponent(r)}` }),
)
app.route("/bare", clientLoginRoutes(opts))
app.get("/me", requireStoredSession({ ...sessions, bearer: true }), (c) =>
  c.json({ sub: (c.get("session" as never) as { record: { sub: string } }).record.sub }),
)
app.get("/cookie-only", requireStoredSession(sessions), (c) => c.json({ ok: true }))

const { token: webToken } = await startSession(sessions, { sub: "user-1", userAgent: "web" })
const cookie = `sid=${webToken}`
const form = (body: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "example-cli/1.0" },
  body: new URLSearchParams(body).toString(),
})
const token = (body: Record<string, string>) => app.request("/auth/token", form(body))
const me = (access: string) =>
  app.request("/me", { headers: { authorization: `Bearer ${access}` } })

const verifier = `${"v".repeat(20)}-._~${"A1".repeat(12)}` // 48 unreserved chars
const challenge = await pkceChallenge(verifier)
ok(
  "pkceChallenge matches the RFC 7636 example",
  (await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")) ===
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
)

const authorize = (q: Record<string, string>, withCookie = true) =>
  app.request(
    `/auth/authorize?${new URLSearchParams(q)}`,
    withCookie ? { headers: { cookie } } : {},
  )
const pkceQuery = {
  client_id: "example-extension",
  redirect_uri: EXT_REDIRECT,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "xyz",
}
const codeFrom = (res: Response) => new URL(res.headers.get("location") ?? "http://x/").searchParams

// ------------------------------------------------------------------ PKCE
{
  const res = await authorize(pkceQuery)
  const q = codeFrom(res)
  ok(
    "authorize: 302 to the registered redirect with code and state",
    res.status === 302 &&
      res.headers.get("location")?.startsWith(EXT_REDIRECT) &&
      q.get("state") === "xyz" &&
      !!q.get("code"),
  )

  const exchange = (code: string, v = verifier, extra: Record<string, string> = {}) =>
    token({
      grant_type: "authorization_code",
      client_id: "example-extension",
      redirect_uri: EXT_REDIRECT,
      code,
      code_verifier: v,
      ...extra,
    })

  const r = await exchange(q.get("code") as string)
  const body = (await r.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    token_type: string
  }
  ok(
    "token: code + verifier -> bearer tokens",
    r.status === 200 &&
      body.token_type === "Bearer" &&
      !!body.access_token &&
      !!body.refresh_token &&
      body.expires_in === 900,
  )
  ok("token response is no-store", r.headers.get("cache-control") === "no-store")
  ok(
    "access token works as Bearer",
    ((await (await me(body.access_token)).json()) as { sub: string }).sub === "user-1",
  )
  ok(
    "bearer is not accepted where bearer is off",
    (
      await app.request("/cookie-only", {
        headers: { authorization: `Bearer ${body.access_token}` },
      })
    ).status === 401,
  )
  ok(
    "cookie still works on a bearer-enabled route",
    (await app.request("/me", { headers: { cookie } })).status === 200,
  )
  ok(
    "code is single use",
    ((await (await exchange(q.get("code") as string)).json()) as { error: string }).error ===
      "invalid_grant",
  )
  const listed = await store.listByUser("user-1")
  ok(
    "the client shows in the sessions list",
    listed.some((s) => s.device === "example-cli"),
    listed.map((s) => s.device),
  )

  // verifier mismatch, and the code is burned by the failed try
  const q2 = codeFrom(await authorize(pkceQuery))
  const bad = await exchange(q2.get("code") as string, "w".repeat(43))
  ok(
    "PKCE verifier mismatch -> invalid_grant",
    bad.status === 400 && ((await bad.json()) as { error: string }).error === "invalid_grant",
  )
  ok(
    "a code that failed its verifier cannot be retried",
    (await exchange(q2.get("code") as string)).status === 400,
  )

  const q3 = codeFrom(await authorize(pkceQuery))
  ok(
    "redirect_uri must match the authorize request",
    (await exchange(q3.get("code") as string, verifier, { redirect_uri: `${EXT_REDIRECT}other` }))
      .status === 400,
  )
  const q4 = codeFrom(await authorize(pkceQuery))
  const otherClient = await token({
    grant_type: "authorization_code",
    client_id: "example-desktop",
    redirect_uri: EXT_REDIRECT,
    code: q4.get("code") as string,
    code_verifier: verifier,
  })
  ok("code bound to its client", otherClient.status === 400)
  ok(
    "short verifier refused",
    ((await (await exchange("x", "short")).json()) as { error: string }).error ===
      "invalid_request",
  )

  const plain = await authorize({ ...pkceQuery, code_challenge_method: "plain" })
  ok(
    "plain PKCE refused, error sent back to the client",
    plain.status === 302 &&
      codeFrom(plain).get("error") === "invalid_request" &&
      !codeFrom(plain).get("code"),
  )
  const noPkce = await authorize({ client_id: "example-extension", redirect_uri: EXT_REDIRECT })
  ok("missing PKCE refused", codeFrom(noPkce).get("error") === "invalid_request")
  const evil = await authorize({ ...pkceQuery, redirect_uri: "https://evil.example/" })
  ok(
    "unregistered redirect_uri: 400, never redirected",
    evil.status === 400 && !evil.headers.get("location"),
  )
  ok("unknown client: 400", (await authorize({ ...pkceQuery, client_id: "nope" })).status === 400)
  const anon = await authorize(pkceQuery, false)
  ok(
    "not signed in: sent to loginUrl with a way back",
    anon.status === 302 && anon.headers.get("location")?.startsWith("/login?next=") === true,
  )
  ok(
    "not signed in, no loginUrl: 401",
    (await app.request(`/bare/authorize?${new URLSearchParams(pkceQuery)}`)).status === 401,
  )

  const desk = await authorize({
    ...pkceQuery,
    client_id: "example-desktop",
    redirect_uri: "http://127.0.0.1:53682/callback",
  })
  ok(
    "loopback redirect on any port (RFC 8252)",
    desk.status === 302 && !!codeFrom(desk).get("code"),
  )
}

ok(
  "loopback: path must match",
  !redirectUriAllowed(["http://127.0.0.1/callback"], "http://127.0.0.1:9/other"),
)
ok(
  "loopback: not for a registered port",
  !redirectUriAllowed(["http://127.0.0.1:8080/cb"], "http://127.0.0.1:8081/cb"),
)
ok(
  "loopback: not https hosts",
  !redirectUriAllowed(["https://app.example/cb"], "https://app.example:444/cb"),
)

// ------------------------------------------------------- refresh rotation
{
  const q = codeFrom(await authorize(pkceQuery))
  const first = (await (
    await token({
      grant_type: "authorization_code",
      client_id: "example-extension",
      redirect_uri: EXT_REDIRECT,
      code: q.get("code") as string,
      code_verifier: verifier,
    })
  ).json()) as { access_token: string; refresh_token: string }
  const refresh = (rt: string, client = "example-extension") =>
    token({ grant_type: "refresh_token", client_id: client, refresh_token: rt })

  ok(
    "refresh token bound to its client",
    (await refresh(first.refresh_token, "example-cli")).status === 400,
  )
  const r2 = await refresh(first.refresh_token)
  const second = (await r2.json()) as { access_token: string; refresh_token: string }
  ok("refresh -> new pair", r2.status === 200 && second.refresh_token !== first.refresh_token)
  ok("new access token works", (await me(second.access_token)).status === 200)
  const reuse = await refresh(first.refresh_token)
  ok("reused refresh token -> invalid_grant", reuse.status === 400)
  ok("reuse revokes the session: access token dead", (await me(second.access_token)).status === 401)
  ok(
    "reuse revokes the session: newest refresh dead too",
    (await refresh(second.refresh_token)).status === 400,
  )
  ok(
    "web cookie session untouched",
    (await app.request("/me", { headers: { cookie } })).status === 200,
  )
}

// ------------------------------------------------------------- revoke
{
  const q = codeFrom(await authorize(pkceQuery))
  const t = (await (
    await token({
      grant_type: "authorization_code",
      client_id: "example-extension",
      redirect_uri: EXT_REDIRECT,
      code: q.get("code") as string,
      code_verifier: verifier,
    })
  ).json()) as { access_token: string; refresh_token: string }
  const res = await app.request("/auth/revoke", form({ token: t.refresh_token }))
  ok("revoke: 200", res.status === 200)
  ok("revoke: access token dead", (await me(t.access_token)).status === 401)
  ok(
    "revoke unknown token: still 200",
    (await app.request("/auth/revoke", form({ token: "nope" }))).status === 200,
  )
}

// ---------------------------------------------------------- device code
{
  const start = async () => {
    const r = await app.request("/auth/device/code", form({ client_id: "example-cli" }))
    return (await r.json()) as {
      device_code: string
      user_code: string
      verification_uri: string
      verification_uri_complete: string
      expires_in: number
      interval: number
    }
  }
  const poll = async (device_code: string) => {
    const r = await token({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: "example-cli",
      device_code,
    })
    return {
      status: r.status,
      body: (await r.json()) as { error?: string; interval?: number; access_token?: string },
    }
  }
  const approve = (user_code: string, withCookie = true) =>
    app.request("/auth/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json", ...(withCookie ? { cookie } : {}) },
      body: JSON.stringify({ user_code }),
    })

  const d = await start()
  ok(
    "device: user code is XXXX-XXXX from the RFC 8628 alphabet",
    /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(d.user_code),
    d.user_code,
  )
  ok(
    "device: verification URIs and timings",
    d.verification_uri === opts.verificationUri &&
      d.verification_uri_complete.includes("user_code=") &&
      d.expires_in === 600 &&
      d.interval === 5,
  )
  ok(
    "device: unknown client refused",
    (await app.request("/auth/device/code", form({ client_id: "nope" }))).status === 401,
  )

  const p1 = await poll(d.device_code)
  ok(
    "device: authorization_pending before approval",
    p1.status === 400 && p1.body.error === "authorization_pending",
  )
  const p2 = await poll(d.device_code)
  ok(
    "device: polling too fast -> slow_down with a longer interval",
    p2.body.error === "slow_down" && p2.body.interval === 10,
    p2.body,
  )

  ok("device: approve needs the web sign-in", (await approve(d.user_code, false)).status === 401)
  ok(
    "device: wrong code -> invalid_code",
    ((await (await approve("BCDF-GHJK")).json()) as { error: string }).error === "invalid_code",
  )
  const a = await approve(d.user_code.toLowerCase().replace("-", " "))
  ok(
    "device: approve accepts the code loosely typed",
    a.status === 200 && ((await a.json()) as { client_id: string }).client_id === "example-cli",
  )
  ok("device: approve is single use", (await approve(d.user_code)).status === 400)

  const p3 = await poll(d.device_code)
  ok("device: approved poll -> tokens", p3.status === 200 && !!p3.body.access_token)
  ok("device: token works", (await me(p3.body.access_token as string)).status === 200)
  ok(
    "device: device code is single use",
    (await poll(d.device_code)).body.error === "invalid_grant",
  )

  // expiry
  const e = await start()
  const realNow = Date.now
  Date.now = () => realNow() + 601_000
  try {
    const p = await poll(e.device_code)
    ok("device: expired_token after expires_in", p.body.error === "expired_token", p.body)
    ok("device: an expired code cannot be approved", (await approve(e.user_code)).status === 400)
  } finally {
    Date.now = realNow
  }

  // approvals per user are counted, against guessing user codes
  const { token: t2 } = await startSession(sessions, { sub: "user-2" })
  const guess = () =>
    app.request("/auth/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `sid=${t2}` },
      body: JSON.stringify({ user_code: "ZZZZ-ZZZZ" }),
    })
  for (let i = 0; i < 4; i++) await guess()
  const limited = await guess()
  ok(
    "device: approvals rate-limited per user",
    limited.status === 429 && !!limited.headers.get("retry-after"),
    limited.status,
  )
}

ok(
  "normalizeUserCode",
  normalizeUserCode(" bcdf-ghjk ") === "BCDFGHJK" && normalizeUserCode("AEIO-UUUU") === null,
)
ok(
  "unsupported grant",
  (
    (await (await token({ grant_type: "password", client_id: "example-cli" })).json()) as {
      error: string
    }
  ).error === "unsupported_grant_type",
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
