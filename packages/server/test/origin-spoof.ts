/**
 * Tickets #2517 and #2521. `trust: "cloudflare"` believes `cf-connecting-ip`
 * only on Cloudflare Workers. On a Bun or Node origin that can be reached
 * directly, a client sets that header itself, so it is ignored there (no IP,
 * `onNoIp` applies) unless the app promises the origin is locked to Cloudflare
 * with `{ cloudflare: { originLocked: true } }`.
 *
 * Each case sends 50 requests with a fresh random `cf-connecting-ip` and
 * counts how many the per-IP limit refused: 45 (limit 5) when the header is
 * ignored, 0 when it is believed (each fake IP gets its own bucket).
 */
import { Hono } from "hono"
import { captchaVerifier, requireCaptcha } from "../src/abuse/captcha"
import { kvRateLimitStore, memoryKv } from "../src/adapters"
import { requestPhoneOtp } from "../src/auth/otp"
import { clientIp, rateLimit } from "../src/middleware/rate-limit"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const N = 50
const MAX = 5
const randomIp = () =>
  Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 254)).join(".")
const spoof = () => ({ headers: { "cf-connecting-ip": randomIp() } })

const realAgent = navigator.userAgent
const runtime = (ua: string) =>
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true })

type Trust = "cloudflare" | { cloudflare: { originLocked: true } }
const cases: [string, Trust, string, number][] = [
  // [label, trust, user agent, refusals expected out of N spoofed IPs]
  ["Bun, trust cloudflare: header ignored", "cloudflare", realAgent, N - MAX],
  ["Workers stub, trust cloudflare: header honoured", "cloudflare", "Cloudflare-Workers", 0],
  ["Bun, originLocked: header honoured", { cloudflare: { originLocked: true } }, realAgent, 0],
]

for (const [label, trust, ua, want] of cases) {
  runtime(ua)

  // --- rateLimit({ max: 5, trust }) ---
  {
    const app = new Hono().use("*", rateLimit({ max: MAX, trust })).get("/", (c) => c.text("ok"))
    let limited = 0
    for (let i = 0; i < N; i++) if ((await app.request("/", spoof())).status === 429) limited++
    ok(`rateLimit, ${label}: 429 count ${want}`, limited === want, limited)
  }

  // --- requireCaptcha: the verifier is told whatever IP the client claimed ---
  {
    const seen = new Set<string | null | undefined>()
    const base = captchaVerifier({ provider: "test" })
    const verifier = {
      ...base,
      verify: (t: string | null | undefined, o?: { ip?: string | null }) => (
        seen.add(o?.ip), base.verify(t, o)
      ),
    }
    const app = new Hono()
      .use("*", requireCaptcha({ verifier, trust }))
      .get("/", (c) => c.text("ok"))
    for (let i = 0; i < N; i++)
      await app.request("/", {
        headers: { ...spoof().headers, "x-captcha-token": "signet-captcha-test-pass" },
      })
    ok(
      `requireCaptcha, ${label}: verifier saw ${want ? 1 : N} distinct IPs`,
      seen.size === (want ? 1 : N),
      seen.size,
    )
  }

  // --- phone OTP: IP from clientIp(c, trust); no IP lands in the unknown bucket ---
  {
    const kv = memoryKv()
    const otp = {
      kv,
      secret: "x".repeat(32),
      sender: { send: async () => {} },
      rateLimit: kvRateLimitStore(kv),
      perIp: { max: MAX, windowSeconds: 3600 },
      perUnknownIp: { max: MAX, windowSeconds: 3600 },
    }
    let limited = 0
    const app = new Hono().post("/otp", async (c) => {
      // a different phone each time, so only the per-IP buckets can refuse
      const phone = `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`
      const r = await requestPhoneOtp(otp, { phone, ip: clientIp(c, trust) })
      if (!r.ok && r.code === "RATE_LIMITED") limited++
      return c.json({ ok: r.ok })
    })
    for (let i = 0; i < N; i++) await app.request("/otp", { method: "POST", ...spoof() })
    ok(`phone OTP, ${label}: RATE_LIMITED count ${want}`, limited === want, limited)
  }
}

// the same real IP is still limited where the header is believed
runtime("Cloudflare-Workers")
{
  const app = new Hono()
    .use("*", rateLimit({ max: MAX, trust: "cloudflare" }))
    .get("/", (c) => c.text("ok"))
  let limited = 0
  for (let i = 0; i < N; i++)
    if ((await app.request("/", { headers: { "cf-connecting-ip": "203.0.113.5" } })).status === 429)
      limited++
  ok("Workers stub: one real IP is limited after max", limited === N - MAX, limited)
}
runtime(realAgent)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
