/**
 * What every adapter shares: one request function (auth headers from the
 * adapter, retries only where a retry cannot charge twice, errors mapped to
 * PaymentsError), Web Crypto helpers with constant-time compare, minor-unit
 * conversion without floats, and `defineGateway`, which turns a partial
 * implementation into a full `PaymentGateway` that rejects unsupported calls
 * before touching the network.
 */

import { PaymentsError } from "./errors.js"
import type { Capabilities, Feature, HttpOptions, PaymentGateway, RawOptions } from "./types.js"

// ---------------------------------------------------------------- request

export type RequestArgs = {
  gateway: string
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  /** Retry on outage. Callers pass true only for GETs and keyed writes. */
  retryable: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function parse(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function request(args: RequestArgs, http: HttpOptions = {}): Promise<unknown> {
  const f = http.fetch ?? fetch
  const retries = args.retryable ? (http.retries ?? 2) : 0
  const delay = http.retryDelayMs ?? 250
  let last: PaymentsError | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(delay * 2 ** (attempt - 1))
    let res: Response
    try {
      res = await f(args.url, { method: args.method, headers: args.headers, body: args.body })
    } catch (err) {
      last = new PaymentsError(
        "GATEWAY_UNAVAILABLE",
        `${args.gateway}: ${args.method} ${args.url} failed: ${err instanceof Error ? err.message : String(err)}`,
        { gateway: args.gateway },
      )
      continue
    }
    const body = await parse(res)
    if (res.ok) return body
    const extra = { gateway: args.gateway, status: res.status, raw: body }
    const what = `${args.gateway}: ${args.method} ${new URL(args.url).pathname} answered ${res.status}`
    if (res.status === 429 || res.status >= 500) {
      last = new PaymentsError("GATEWAY_UNAVAILABLE", what, extra)
      continue
    }
    if (res.status === 402) throw new PaymentsError("DECLINED", `${what} (declined)`, extra)
    if (res.status === 404) throw new PaymentsError("NOT_FOUND", what, extra)
    throw new PaymentsError(
      "GATEWAY_ERROR",
      `${what}: ${JSON.stringify(body).slice(0, 300)}`,
      extra,
    )
  }
  throw last as PaymentsError
}

export function withQuery(url: string, query?: RawOptions["query"]): string {
  if (!query) return url
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, String(v))
  const s = q.toString()
  return s ? `${url}${url.includes("?") ? "&" : "?"}${s}` : url
}

/** Stripe-style nested form encoding: `a[b][0][c]=1`. */
export function formEncode(body: Record<string, unknown>): string {
  const out = new URLSearchParams()
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) walk(`${prefix}[${i}]`, x)
    } else if (typeof v === "object")
      for (const [k, x] of Object.entries(v)) walk(prefix ? `${prefix}[${k}]` : k, x)
    else out.append(prefix, String(v))
  }
  walk("", body)
  return out.toString()
}

export const basicAuth = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`

// ---------------------------------------------------------------- crypto

const enc = new TextEncoder()

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)))

export async function hmac(
  algo: "SHA-256" | "SHA-512",
  secret: string | Uint8Array,
  message: string,
  encoding: "hex" | "base64" = "hex",
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    typeof secret === "string" ? enc.encode(secret) : (secret as Uint8Array<ArrayBuffer>),
    { name: "HMAC", hash: algo },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message))
  return encoding === "hex" ? hex(sig) : b64(sig)
}

export async function sha256Hex(message: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(message)))
}

export async function sha512Hex(message: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-512", enc.encode(message)))
}

/** Constant-time string compare (the length is not secret). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function badSignature(gateway: string, why = "signature does not match"): PaymentsError {
  return new PaymentsError("BAD_SIGNATURE", `${gateway} webhook: ${why}. Nothing was processed.`, {
    gateway,
  })
}

/** Reject a signed timestamp outside the tolerance. `ts` in seconds. */
export function checkTimestamp(
  gateway: string,
  ts: number,
  options: { toleranceSeconds?: number; now?: () => number } = {},
): void {
  const tol = options.toleranceSeconds ?? 300
  const now = (options.now ?? Date.now)() / 1000
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tol)
    throw badSignature(gateway, `timestamp is outside the ${tol}s tolerance`)
}

// ---------------------------------------------------------------- money

const ZERO = new Set(
  "BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF".split(" "),
)
const THREE = new Set("BHD IQD JOD KWD LYD OMR TND".split(" "))

/**
 * ISO 4217 minor digits: 2 for INR, 0 for JPY, 3 for BHD. A fixed table, not
 * Intl: runtimes disagree (Intl says HUF has 0 under Node and 2 under Bun).
 */
export function minorDigits(currency: string): number {
  const c = currency.toUpperCase()
  return ZERO.has(c) ? 0 : THREE.has(c) ? 3 : 2
}

/** 1015 INR -> "10.15"; 500 JPY -> "500". String arithmetic, no floats. */
export function toMajor(amount: number, currency: string): string {
  if (!Number.isSafeInteger(amount))
    throw new PaymentsError("BAD_INPUT", `Amounts are integer minor units; got ${amount}.`)
  const d = minorDigits(currency)
  const neg = amount < 0
  const s = String(Math.abs(amount)).padStart(d + 1, "0")
  const major = d ? `${s.slice(0, -d)}.${s.slice(-d)}` : s
  return neg ? `-${major}` : major
}

/** "10.15" or 10.15 INR -> 1015. Parses the decimal string, never multiplies a float. */
export function toMinor(value: string | number, currency: string): number {
  const d = minorDigits(currency)
  const s = typeof value === "number" ? value.toFixed(d) : value.trim()
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m) throw new PaymentsError("BAD_INPUT", `Not an amount: "${value}".`)
  const [, sign, int = "", frac = ""] = m
  if (frac.length > d && /[^0]/.test(frac.slice(d)))
    throw new PaymentsError("BAD_INPUT", `"${value}" has more than ${d} decimals for ${currency}.`)
  const n = Number(`${int || "0"}${frac.slice(0, d).padEnd(d, "0")}`)
  return sign ? -n : n
}

/** Seconds or ms since epoch, or an ISO string, as a Date. */
export function toDate(v: unknown): Date {
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v)
  if (typeof v === "string" && v) return new Date(v)
  return new Date(0)
}

// ---------------------------------------------------------------- gateway

type Impl = Partial<Omit<PaymentGateway, "name" | "capabilities" | "supports" | "raw">> & {
  raw: PaymentGateway["raw"]
}

const FEATURE_OF: Partial<Record<keyof Impl, Feature>> = {
  capture: "capture",
  refund: "refunds",
  createCustomer: "customers",
  listPaymentMethods: "savedMethods",
  getSubscription: "subscriptions",
  cancelSubscription: "subscriptions",
  createPayout: "payouts",
  listSettlements: "settlements",
  verifyWebhook: "webhooks",
}

const METHODS = [
  "createCheckout",
  "getPayment",
  "capture",
  "refund",
  "createCustomer",
  "listPaymentMethods",
  "getSubscription",
  "cancelSubscription",
  "createPayout",
  "listSettlements",
  "verifyWebhook",
] as const

export function unsupported(gateway: string, what: string): PaymentsError {
  return new PaymentsError("UNSUPPORTED", `${gateway} does not support ${what}.`, { gateway })
}

function requireKey(gateway: string, what: string, key: unknown): void {
  if (typeof key !== "string" || !key)
    throw new PaymentsError(
      "IDEMPOTENCY_KEY_REQUIRED",
      `${gateway}.${what} needs an idempotencyKey, so a retry never charges or refunds twice.`,
      { gateway },
    )
}

/**
 * A full `PaymentGateway` from the methods an adapter implements. A method
 * that is missing, or whose feature is not in `capabilities`, rejects with
 * UNSUPPORTED; so do a method or currency the adapter does not take, and a
 * partial refund without `partialRefunds`. Money-moving calls must carry an
 * idempotency key.
 */
export function defineGateway(
  name: string,
  capabilities: Capabilities,
  impl: Impl,
): PaymentGateway {
  const supports = (f: Feature) => capabilities.features.includes(f)
  const gw = { name, capabilities, supports, raw: impl.raw } as PaymentGateway
  for (const m of METHODS) {
    const fn = impl[m] as ((...a: unknown[]) => Promise<unknown>) | undefined
    const feature = FEATURE_OF[m]
    ;(gw as Record<string, unknown>)[m] = async (...args: unknown[]) => {
      if (!fn || (feature && !supports(feature))) throw unsupported(name, m)
      if (m === "createCheckout") {
        const input = args[0] as {
          method?: string
          currency: string
          idempotencyKey: string
          amount: number
        }
        requireKey(name, m, input.idempotencyKey)
        if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
          throw new PaymentsError(
            "BAD_INPUT",
            `amount must be a positive integer in minor units; got ${input.amount}.`,
          )
        if (input.method && !capabilities.methods.includes(input.method as never))
          throw unsupported(name, `the ${input.method} method`)
        if (capabilities.currencies && !capabilities.currencies.includes(input.currency))
          throw unsupported(name, `currency ${input.currency}`)
      }
      if (m === "refund" || m === "capture" || m === "createPayout") {
        const input = (m === "createPayout" ? args[0] : args[1]) as {
          idempotencyKey?: string
          amount?: number
        }
        requireKey(name, m, input?.idempotencyKey)
        if (
          input.amount !== undefined &&
          (!Number.isSafeInteger(input.amount) || input.amount <= 0)
        )
          throw new PaymentsError(
            "BAD_INPUT",
            `amount must be a positive integer in minor units; got ${input.amount}.`,
          )
        if (m === "refund" && input.amount !== undefined && !supports("partialRefunds"))
          throw unsupported(name, "partial refunds (omit amount for a full refund)")
      }
      return fn(...args)
    }
  }
  return gw
}

/** Path + query + body for `raw`, with JSON bodies. */
export function jsonRaw(
  gateway: string,
  base: () => string,
  headers: (
    o: RawOptions & { method: string },
  ) => Promise<Record<string, string>> | Record<string, string>,
  http: HttpOptions,
): PaymentGateway["raw"] {
  return async (method, path, body, options = {}) => {
    const m = method.toUpperCase()
    return request(
      {
        gateway,
        method: m,
        url: withQuery(`${base()}${path}`, options.query),
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(await headers({ ...options, method: m })),
          ...options.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        retryable: m === "GET" || !!options.idempotencyKey,
      },
      http,
    )
  }
}

// biome-ignore lint/suspicious/noExplicitAny: gateway payloads are read structurally
export type Json = any
