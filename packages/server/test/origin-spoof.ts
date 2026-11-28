/**
 * Ticket #2517, reproduction only (no product change). `trust: "cloudflare"`
 * believes `cf-connecting-ip` on every request. On a Bun or Node origin that
 * can be reached directly, a client sets that header itself and so picks its
 * own per-IP bucket.
 *
 * Each case sends 50 requests with a fresh random `cf-connecting-ip` and
 * counts how many the per-IP limit refused. The secure answer is 45 refusals
 * (limit 5); today it is 0. These assertions pin TODAY's behaviour, so the
 * suite stays green. When clientIp() gets its guard, flip them to expect the limit.
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

// --- rateLimit({ max: 5, trust: "cloudflare" }) ---
{
  const app = new Hono()
    .use("*", rateLimit({ max: MAX, trust: "cloudflare" }))
    .get("/", (c) => c.text("ok"))
  let limited = 0
  for (let i = 0; i < N; i++) if ((await app.request("/", spoof())).status === 429) limited++
  ok(
    `rateLimit: ${N} spoofed IPs, max ${MAX}: 429 count is 0 today (confirms #2517)`,
    limited === 0,
    limited,
  )
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
    .use("*", requireCaptcha({ verifier, trust: "cloudflare" }))
    .get("/", (c) => c.text("ok"))
  for (let i = 0; i < N; i++)
    await app.request("/", {
      headers: { ...spoof().headers, "x-captcha-token": "signet-captcha-test-pass" },
    })
  ok(
    `requireCaptcha: ${N} spoofed IPs reach the verifier as ${seen.size} distinct IPs today`,
    seen.size === N,
    seen.size,
  )
}

// --- phone OTP per-IP bucket, IP taken from clientIp(c, "cloudflare") ---
{
  const kv = memoryKv()
  const otp = {
    kv,
    secret: "x".repeat(32),
    sender: { send: async () => {} },
    rateLimit: kvRateLimitStore(kv),
    perIp: { max: MAX, windowSeconds: 3600 },
  }
  let limited = 0
  const app = new Hono().post("/otp", async (c) => {
    // a different phone each time, so only the per-IP bucket can refuse
    const phone = `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`
    const r = await requestPhoneOtp(otp, { phone, ip: clientIp(c, "cloudflare") })
    if (!r.ok && r.code === "RATE_LIMITED") limited++
    return c.json({ ok: r.ok })
  })
  for (let i = 0; i < N; i++) await app.request("/otp", { method: "POST", ...spoof() })
  ok(
    `phone OTP perIp: ${N} spoofed IPs, max ${MAX}: RATE_LIMITED count is 0 today`,
    limited === 0,
    limited,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
