import { createApiToken, hashIncomingToken, sha256Hex, verifySharedToken } from "../src/auth/bearer"
import { betterAuthDefaults, socialProviders } from "../src/auth/better-auth"
import { checkEnv, isDevAuthEnabled, requireEnv } from "../src/auth/guards"
import { hashPasscode, verifyPasscode } from "../src/auth/passcode"
import {
  clearCookie,
  issueSession,
  readSessionCookie,
  sessionCookie,
  timingSafeEqual,
  verifySession,
} from "../src/auth/session"

let pass = 0,
  fail = 0
const ok = (name: string, cond: boolean, detail = "") => {
  cond ? (pass++, console.log("  PASS", name)) : (fail++, console.log("  FAIL", name, detail))
}

const opts = {
  cookieName: "sig_session",
  secret: "test-secret-abc123-test-secret-abc123",
  ttlSeconds: 60,
  sameSite: "none" as const,
}

// session roundtrip
const t = await issueSession(opts, "user-42")
ok("issue/verify roundtrip", (await verifySession(t, opts))?.sub === "user-42")
ok(
  "tampered signature rejected",
  (await verifySession(`${t.split(".")[0]}.deadbeef`, opts)) === null,
)
ok(
  "tampered payload rejected",
  (await verifySession(`eyJhIjoxfQ.${t.split(".")[1]}`, opts)) === null,
)
ok(
  "wrong secret rejected",
  (await verifySession(t, { ...opts, secret: "other-secret-other-secret-other-secret" })) === null,
)
ok(
  "short session secret throws",
  await issueSession({ ...opts, secret: "short" }).then(
    () => false,
    () => true,
  ),
)
ok(
  "timingSafeEqual: length mismatch",
  !timingSafeEqual("abc", "abcd") && !timingSafeEqual("abcd", "abc"),
)
ok("timingSafeEqual: equal", timingSafeEqual("abcd", "abcd"))
ok("null token rejected", (await verifySession(null, opts)) === null)
ok("garbage rejected", (await verifySession("not-a-token", opts)) === null)
const expired = await issueSession({ ...opts, ttlSeconds: -10 })
ok("expired rejected", (await verifySession(expired, opts)) === null)

// cookie
const c = sessionCookie(t, opts)
ok(
  "cookie HttpOnly+Secure+SameSite=None",
  c.includes("HttpOnly") && c.includes("Secure") && c.includes("SameSite=None"),
)
ok("cookie roundtrip", readSessionCookie(`other=x; ${c.split(";")[0]}`, opts) === t)
ok("clearCookie Max-Age=0", clearCookie(opts).includes("Max-Age=0"))
ok("domain honoured", sessionCookie(t, { ...opts, domain: ".ex.com" }).includes("Domain=.ex.com"))

// timing safe
ok("timingSafeEqual true", timingSafeEqual("abc", "abc"))
ok("timingSafeEqual false", !timingSafeEqual("abc", "abd") && !timingSafeEqual("abc", "ab"))

// passcode
const stored = await hashPasscode("hunter2")
ok("passcode stored as iterations:salt:hash", /^100000:[0-9a-f]{32}:[0-9a-f]{64}$/.test(stored))
ok("old salt:hash format still verifies", await verifyPasscode("hunter2", stored.slice(7)))
ok("bad iteration count rejected", !(await verifyPasscode("hunter2", `0${stored.slice(6)}`)))
ok("correct passcode", await verifyPasscode("hunter2", stored))
ok("wrong passcode", !(await verifyPasscode("hunter3", stored)))
ok("empty passcode", !(await verifyPasscode("", stored)) && !(await verifyPasscode(null, stored)))
ok("malformed stored", !(await verifyPasscode("hunter2", "garbage")))
ok("salt differs per call", (await hashPasscode("hunter2")) !== stored)

// bearer
const { token, hash } = await createApiToken("app")
ok("token prefixed", token.startsWith("app_") && token.length === 68)
ok("hash matches", hash === (await sha256Hex(token)))
const H = (v: string) => new Headers({ authorization: v })
ok("hashIncomingToken", (await hashIncomingToken(H(`Bearer ${token}`), "app")) === hash)
ok("wrong prefix rejected", (await hashIncomingToken(H("Bearer xyz_abc"), "app")) === null)
ok("no header rejected", (await hashIncomingToken(new Headers(), "app")) === null)
ok("shared token ok", verifySharedToken(H("Bearer s3cret"), "s3cret"))
ok("shared token wrong", !verifySharedToken(H("Bearer nope"), "s3cret"))
ok("shared token no expected", !verifySharedToken(H("Bearer x"), undefined))

// guards
ok("dev auth off by default", !isDevAuthEnabled({}))
ok("dev auth on locally", isDevAuthEnabled({ DEV_AUTH_ENABLED: "true", APP_ENV: "local" }))
let threw = false
try {
  isDevAuthEnabled({ DEV_AUTH_ENABLED: "true", APP_ENV: "production" })
} catch {
  threw = true
}
ok("dev auth THROWS in production", threw)
threw = false
try {
  isDevAuthEnabled({ DEV_AUTH_ENABLED: "true", APP_ENV: "staging" })
} catch {
  threw = true
}
ok("dev auth THROWS in staging", threw)
ok(
  "requireEnv names all missing",
  (() => {
    try {
      requireEnv({ A: "1" }, ["A", "B", "C"])
    } catch (e) {
      return String(e).includes("B, C")
    }
    return false
  })(),
)
ok("checkEnv soft fail", checkEnv({}, ["X"]).ok === false)

// better-auth defaults
const d = betterAuthDefaults({ WEB_URL: "https://a.com", COOKIE_DOMAIN: ".a.com" })
ok("same-origin cookies by default", d.advanced.defaultCookieAttributes.sameSite === "lax")
ok(
  "cross-origin opt-in",
  betterAuthDefaults({}, { crossOrigin: true }).advanced.defaultCookieAttributes.sameSite ===
    "none",
)
ok("emailAndPassword off by default", d.emailAndPassword.enabled === false)
ok("trustedOrigins drops empties", d.trustedOrigins.length === 1)
// Nothing weakens or changes Better Auth's behaviour unless asked for. These
// were app-a's settings, once shipped as defaults to every app.
const dd = d as Record<string, any>
ok("state-cookie CSRF check kept by default", dd.account?.skipStateCookieCheck !== true)
ok("cookie cache off by default (revocation is immediate)", dd.session.cookieCache === undefined)
ok("session lifetime left to Better Auth by default", dd.session.expiresIn === undefined)
ok("no second auth rate limiter by default", dd.rateLimit === undefined)
const appA = betterAuthDefaults(
  { WEB_URL: "https://a.com" },
  {
    cookieCacheSeconds: 300,
    skipStateCookieCheck: true,
    sessionSeconds: 2592000,
    rateLimit: { window: 60, max: 10 },
  },
) as Record<string, any>
ok(
  "app-a's settings reachable by opting in",
  appA.session.cookieCache?.maxAge === 300 &&
    appA.account?.skipStateCookieCheck === true &&
    appA.session.expiresIn === 2592000 &&
    appA.rateLimit?.max === 10,
)
ok(
  "SESSION_DURATION_SECONDS still honoured",
  (betterAuthDefaults({ SESSION_DURATION_SECONDS: "3600" }) as any).session.expiresIn === 3600,
)
ok(
  "BETTER_AUTH_URL preferred for baseURL",
  betterAuthDefaults({ BETTER_AUTH_URL: "https://api.x", WEB_URL: "https://x" }).baseURL ===
    "https://api.x",
)
ok(
  "baseURL option wins",
  betterAuthDefaults({ BETTER_AUTH_URL: "https://api.x" }, { baseURL: "https://o" }).baseURL ===
    "https://o",
)
const origins = betterAuthDefaults(
  { WEB_URL: "https://x" },
  { trustedOrigins: "https://a,https://b".split(","), extraTrustedOrigins: ["https://c"] },
).trustedOrigins
ok(
  "trustedOrigins option replaces the env list",
  origins.join() === "https://a,https://b,https://c",
  origins.join(),
)
const skips: string[] = []
const sp = socialProviders(
  { google: { clientId: "a", clientSecret: "b" }, github: { clientId: "only" } },
  (p) => skips.push(p),
)
ok("provider with both halves kept", "google" in sp)
ok("half-configured provider skipped + logged", !("github" in sp) && skips[0] === "github")

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
