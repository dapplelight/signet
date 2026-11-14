/**
 * Phone one-time codes: request, then verify. Server flow only; the SMS
 * provider is a pluggable `SmsSender`.
 *
 * Codes are stored as an HMAC (keyed by your secret and the phone number) with
 * an expiry and an attempt counter, so a leaked store yields no usable codes.
 * Requests are rate-limited per phone and per IP; verify is single use and
 * capped at `maxAttempts`. Nothing here logs a code.
 *
 * `passcode.ts`'s PBKDF2 is not used: a 6-digit code has a million values, so
 * a slow hash adds nothing; the attempt cap is the control.
 */

import type { KeyValue } from "../adapters/index.js"
import type { RateLimitStore } from "../middleware/rate-limit.js"
import { hmacSha256, timingSafeEqual } from "./session.js"

/** Sends one SMS. `to` is E.164 (`+919876543210`). */
export type SmsSender = { send(to: string, message: string): Promise<void> }

/**
 * Prints the SMS to the console, for local development only: that is the one
 * place a code is ever written out. Throws when `appEnv` is production or
 * staging, like `isDevAuthEnabled`.
 */
export function devSmsSender(
  opts: { appEnv?: string; log?: (line: string) => void } = {},
): SmsSender {
  const appEnv = opts.appEnv ?? "local"
  if (appEnv === "production" || appEnv === "staging")
    throw new Error(`SECURITY: devSmsSender prints codes; not allowed in ${appEnv}.`)
  const log = opts.log ?? console.log
  return {
    async send(to, message) {
      log(`[dev sms] to ${to}: ${message}`)
    },
  }
}

/**
 * E.164 from user input, or null. National Indian numbers are accepted in
 * their usual forms (`98765 43210`, `098765-43210`, `919876543210`);
 * anything else must start with `+` or `00`.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  let s = input.trim().replace(/[\s().-]/g, "")
  if (s.startsWith("00")) s = `+${s.slice(2)}`
  if (!s.startsWith("+")) {
    if (!/^\d+$/.test(s)) return null
    if (/^[6-9]\d{9}$/.test(s)) s = `+91${s}`
    else if (/^0[6-9]\d{9}$/.test(s)) s = `+91${s.slice(1)}`
    else if (/^91[6-9]\d{9}$/.test(s)) s = `+${s}`
    else return null
  }
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null
  if (s.startsWith("+91") && !/^\+91[6-9]\d{9}$/.test(s)) return null
  return s
}

/** Masked for display and logs: `+91******3210`. */
export function maskPhone(phone: string): string {
  return phone.length <= 7
    ? "****"
    : `${phone.slice(0, 3)}${"*".repeat(phone.length - 7)}${phone.slice(-4)}`
}

export type PhoneOtpOptions = {
  kv: KeyValue
  /** Keys the stored code hashes. 32+ characters, per environment. */
  secret: string
  sender: SmsSender
  /**
   * Counts requests. Use an exact store (`kvRateLimitStore` over Upstash or
   * `memoryKv`, or the Durable Object store): this is a security control.
   */
  rateLimit: RateLimitStore
  /** Default 6. */
  codeLength?: number
  /** Default 300 (5 minutes). */
  ttlSeconds?: number
  /** Wrong guesses allowed per code. Default 5. */
  maxAttempts?: number
  /** Requests per phone. Default 3 per 15 minutes. */
  perPhone?: { max: number; windowSeconds: number }
  /** Requests per IP. Default 10 per hour. */
  perIp?: { max: number; windowSeconds: number }
  /**
   * Verifies per IP, so one address cannot spread guesses across many
   * numbers. Every verify uses a slot, successful ones too (the count is taken
   * before the code is checked, so a parallel burst cannot get past it).
   * Default 30 per hour. Past it, verify answers TOO_MANY_ATTEMPTS without
   * checking the code. Named for its purpose: it bounds failed guesses.
   */
  verifyFailuresPerIp?: { max: number; windowSeconds: number }
  /** The SMS text. Default "Your code is 123456. It expires in 5 minutes." */
  message?: (code: string, ttlSeconds: number) => string
  /** KeyValue key prefix. Default "signet-otp". */
  prefix?: string
}

export type OtpRequestResult =
  | { ok: true; phone: string; expiresInSeconds: number }
  | { ok: false; code: "INVALID_PHONE" }
  | { ok: false; code: "RATE_LIMITED"; retryAfterSeconds: number }

export type OtpVerifyResult =
  | { ok: true; phone: string }
  | { ok: false; code: "INVALID_PHONE" | "CODE_EXPIRED" | "INVALID_CODE" | "TOO_MANY_ATTEMPTS" }

type Stored = { hash: string; exp: number }

function randomCode(length: number): string {
  // Rejection sampling: no modulo bias.
  let out = ""
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < 250 && out.length < length) out += String(b % 10)
    }
  }
  return out
}

const keys = (o: PhoneOtpOptions, phone: string) => {
  const p = o.prefix ?? "signet-otp"
  return { code: `${p}:c:${phone}`, attempts: `${p}:n:${phone}` }
}

/**
 * Send a code. A new request replaces any earlier code for that phone and
 * resets its attempts (the per-phone limit bounds the total guesses).
 * `ip` comes from `clientIp(c, trust)`; null shares one "no-ip" bucket.
 */
export async function requestPhoneOtp(
  opts: PhoneOtpOptions,
  input: { phone: string; ip?: string | null },
): Promise<OtpRequestResult> {
  const phone = normalizePhone(input.phone)
  if (!phone) return { ok: false, code: "INVALID_PHONE" }
  const perIp = opts.perIp ?? { max: 10, windowSeconds: 3600 }
  const perPhone = opts.perPhone ?? { max: 3, windowSeconds: 900 }
  // IP first, so a sprayer burns its own bucket before any phone's.
  const ipHit = await opts.rateLimit.hit(
    "otp-ip",
    input.ip ?? "no-ip",
    perIp.max,
    perIp.windowSeconds,
  )
  if (!ipHit.ok) return { ok: false, code: "RATE_LIMITED", retryAfterSeconds: ipHit.resetSeconds }
  const phoneHit = await opts.rateLimit.hit(
    "otp-phone",
    phone,
    perPhone.max,
    perPhone.windowSeconds,
  )
  if (!phoneHit.ok)
    return { ok: false, code: "RATE_LIMITED", retryAfterSeconds: phoneHit.resetSeconds }

  const ttl = opts.ttlSeconds ?? 300
  const code = randomCode(opts.codeLength ?? 6)
  const k = keys(opts, phone)
  const stored: Stored = {
    hash: await hmacSha256(opts.secret, `${phone}:${code}`),
    exp: Date.now() + ttl * 1000,
  }
  await opts.kv.delete(k.attempts)
  await opts.kv.set(k.code, JSON.stringify(stored), { ttlSeconds: ttl })
  const text = opts.message
    ? opts.message(code, ttl)
    : `Your code is ${code}. It expires in ${Math.round(ttl / 60)} minutes.`
  await opts.sender.send(phone, text)
  return { ok: true, phone, expiresInSeconds: ttl }
}

/**
 * Check a code. Single use: a correct code is deleted. Each wrong guess counts;
 * at `maxAttempts` the code is destroyed and a new one must be requested.
 *
 * Verifies are also counted per `ip` (`verifyFailuresPerIp`); an IP over the
 * limit gets TOO_MANY_ATTEMPTS without the code being checked or a phone's
 * attempt being used. The count is exact only on an exact `RateLimitStore`. With no `ip` that limit is skipped: one shared
 * bucket would let anyone lock every user out.
 *
 * Exact on stores with `incr` (Upstash, `memoryKv`). On Workers KV the
 * attempt count is read-modify-write, so concurrent guesses can slip past the
 * cap by a few; keep OTP state in an exact store.
 */
export async function verifyPhoneOtp(
  opts: PhoneOtpOptions,
  input: { phone: string; code: string; ip?: string | null },
): Promise<OtpVerifyResult> {
  // Take a slot BEFORE checking the code and decide from the atomic count, so a
  // parallel burst cannot slip past a flag read earlier. Successful verifies
  // use a slot too: the store can count but not refund.
  if (input.ip) {
    const limit = opts.verifyFailuresPerIp ?? { max: 30, windowSeconds: 3600 }
    const hit = await opts.rateLimit.hit("otp-verify-ip", input.ip, limit.max, limit.windowSeconds)
    if (!hit.ok) return { ok: false, code: "TOO_MANY_ATTEMPTS" }
  }
  return checkCode(opts, input)
}

async function checkCode(
  opts: PhoneOtpOptions,
  input: { phone: string; code: string },
): Promise<OtpVerifyResult> {
  const phone = normalizePhone(input.phone)
  if (!phone) return { ok: false, code: "INVALID_PHONE" }
  const k = keys(opts, phone)
  const raw = await opts.kv.get(k.code)
  let stored: Stored | null = null
  try {
    stored = raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    stored = null
  }
  if (!stored || stored.exp <= Date.now()) return { ok: false, code: "CODE_EXPIRED" }

  const max = opts.maxAttempts ?? 5
  const ttl = Math.max(1, Math.ceil((stored.exp - Date.now()) / 1000))
  // Count the attempt BEFORE comparing, so parallel guesses each use one up.
  let attempts: number
  if (opts.kv.incr) attempts = await opts.kv.incr(k.attempts, ttl)
  else {
    attempts = Number((await opts.kv.get(k.attempts)) ?? 0) + 1
    await opts.kv.set(k.attempts, String(attempts), { ttlSeconds: ttl })
  }
  if (attempts > max) {
    await opts.kv.delete(k.code)
    return { ok: false, code: "TOO_MANY_ATTEMPTS" }
  }

  const given = (input.code ?? "").trim()
  const expected = stored.hash
  const actual = await hmacSha256(opts.secret, `${phone}:${given}`)
  if (!timingSafeEqual(actual, expected)) {
    if (attempts < max) return { ok: false, code: "INVALID_CODE" }
    await opts.kv.delete(k.code)
    return { ok: false, code: "TOO_MANY_ATTEMPTS" }
  }
  await Promise.all([opts.kv.delete(k.code), opts.kv.delete(k.attempts)])
  return { ok: true, phone }
}
