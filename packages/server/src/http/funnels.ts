/**
 * Web-to-app funnels on signet-db's `createFunnels` (typed structurally, so
 * this package does not depend on signet-db): a public hosted checkout page
 * (questions, plan picker, the gateway's checkout with Apple Pay and Google
 * Pay), its JSON API, and the redemption the app calls after install.
 *
 * ```ts
 * app.route("/f", funnelRoutes({
 *   funnels,
 *   secret: env.FUNNEL_SECRET,                    // 32+ characters, its own secret
 *   redeemUrl: "https://app.example.com/redeem",  // a universal / app link the app opens
 *   userId: (c) => c.get("session")?.sub,
 *   page: { stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY },
 * }))
 * ```
 *
 * The buyer pays on the web as a new anonymous customer. Once the gateway's
 * verified webhook marks the session paid, the page shows a redemption link:
 * `redeemUrl?token=...`, a signed token that expires (default 7 days) and
 * works once, because redeeming claims the session for one account.
 */

import { type Context, Hono } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import { hmacSha256, timingSafeEqual } from "../auth/session.js"
import { type ApiErrorStatus, ApiException } from "./errors.js"

type Maybe<T> = T | null | undefined | Promise<T | null | undefined>

type SessionView = {
  id: string
  funnel: string
  plan: string
  amount: number
  currency: string
  status: string
  discountCode: string | null
}

/** What the routes need from signet-db's `createFunnels(...)`, as it is. */
export type FunnelStore = {
  page(key: string, opts?: { code?: string; audience?: { country?: string } }): Promise<unknown>
  funnel(key: string): { key: string; title?: string } | null
  step(key: string, step: string, ids?: { anonymousId?: string }): Promise<void>
  start(
    key: string,
    input: {
      productId: string
      answers?: unknown
      code?: string
      email?: string
      visitor?: string
      orgId?: string
      returnUrl?: (sessionId: string) => string
      audience?: { country?: string }
    },
  ): Promise<{ session: SessionView; checkout: unknown }>
  get(id: string): Promise<SessionView | null>
  redeem(
    sessionId: string,
    userId: string,
    opts?: { orgId?: string },
  ): Promise<{ redeemed: boolean; reason?: string; already?: boolean; session?: unknown }>
}

export type RedemptionOptions = {
  /** At least 32 characters. Use one only for this; tokens are domain-separated from sessions anyway. */
  secret: string
  /** Keys being rotated out: tokens signed with them still verify. */
  previousSecrets?: string[]
  /** Default 7 days. */
  ttlSeconds?: number
  now?: () => number
}

const PURPOSE = "signet-funnel-redeem"
const DEFAULT_TTL = 7 * 24 * 60 * 60
const BUYER_COOKIE = "signet_funnel"
const buyerProof = (secret: string, id: string) => hmacSha256(secret, `signet-funnel-buyer.${id}`)

const b64url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
const unb64url = (s: string) => {
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/"))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/**
 * A signed, expiring redemption token for one funnel session. The signature
 * covers a purpose prefix, so a session cookie signed with the same secret
 * never verifies as one, nor the other way round. Single use is the
 * session's: `funnels.redeem` claims it for one account.
 */
export async function redemptionToken(
  opts: RedemptionOptions,
  sessionId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const exp = Math.floor((opts.now?.() ?? Date.now()) / 1000) + (opts.ttlSeconds ?? DEFAULT_TTL)
  const body = b64url(JSON.stringify({ p: PURPOSE, sid: sessionId, exp }))
  return {
    token: `${body}.${await hmacSha256(opts.secret, `${PURPOSE}.${body}`)}`,
    expiresAt: new Date(exp * 1000),
  }
}

/** The session id of a valid, unexpired token, else null. */
export async function readRedemptionToken(
  opts: RedemptionOptions,
  token: string | null | undefined,
): Promise<string | null> {
  if (typeof token !== "string" || token.length > 1024) return null
  const [body, sig, extra] = token.split(".")
  if (!body || !sig || extra !== undefined) return null
  let ok = false
  for (const key of [opts.secret, ...(opts.previousSecrets ?? [])])
    if (timingSafeEqual(sig, await hmacSha256(key, `${PURPOSE}.${body}`))) ok = true
  if (!ok) return null
  try {
    const p = JSON.parse(unb64url(body)) as { p?: unknown; sid?: unknown; exp?: unknown }
    if (p.p !== PURPOSE || typeof p.sid !== "string" || typeof p.exp !== "number") return null
    return p.exp * 1000 > (opts.now?.() ?? Date.now()) ? p.sid : null
  } catch {
    return null
  }
}

/** `redeemUrl` with a fresh token: for the success page, or the email `onPaid` sends. */
export async function redemptionLink(
  opts: RedemptionOptions & { redeemUrl: string },
  sessionId: string,
): Promise<{ link: string; token: string; expiresAt: Date }> {
  const t = await redemptionToken(opts, sessionId)
  const sep = opts.redeemUrl.includes("?") ? "&" : "?"
  return { ...t, link: `${opts.redeemUrl}${sep}token=${encodeURIComponent(t.token)}` }
}

export type FunnelPageOptions = {
  /** Stripe's publishable key: the page mounts the Express Checkout Element (Apple Pay, Google Pay) and the Payment Element. */
  stripePublishableKey?: string
  /** Razorpay's key id: the page opens Razorpay Checkout for an order. */
  razorpayKeyId?: string
  /** Page copy. */
  labels?: Partial<typeof DEFAULT_FUNNEL_PAGE_LABELS>
}

export type FunnelRoutesOptions = RedemptionOptions & {
  funnels: FunnelStore
  /** What the app opens: a universal / app link, or a custom scheme like `example://redeem`. */
  redeemUrl: string
  /** The signed-in user, for `POST /redeem`. Undefined is 401. */
  userId?: (c: Context) => Maybe<string>
  /** The tenant's org id, for anonymous customers and merges. */
  orgId?: (c: Context) => Maybe<string>
  /** Default: `cf-ipcountry` (Cloudflare). Picks the offering's country override. */
  country?: (c: Context) => Maybe<string>
  page?: FunnelPageOptions
}

export const DEFAULT_FUNNEL_PAGE_LABELS = {
  next: "Continue",
  choosePlan: "Choose your plan",
  email: "Email for your receipt",
  code: "Discount code",
  pay: "Pay",
  or: "or pay by card",
  paying: "Confirming your payment…",
  paid: "You're in. Open the app to unlock it.",
  openApp: "Open the app",
  codeHint: "Or paste this code in the app:",
  copy: "Copy",
  redeemed: "This purchase is already unlocked in the app.",
  failed: "The payment did not go through. Try again.",
  error: "Something went wrong. Try again.",
  off: "off",
}

const STATUS: Record<string, ApiErrorStatus> = { BAD_VALUE: 400, NOT_FOUND: 404, CONFLICT: 409 }
const onError = (e: Error) => {
  const code = (e as { code?: unknown }).code
  if (e.name === "SignetDbError" && typeof code === "string" && STATUS[code])
    throw new ApiException(
      STATUS[code] as ApiErrorStatus,
      e.message,
      code === "BAD_VALUE" ? "VALIDATION_FAILED" : code,
    )
  throw e
}
const body = async (c: Context): Promise<Record<string, unknown>> => {
  try {
    const v = await c.req.json()
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    throw new ApiException(400, "Invalid JSON body", "INVALID_JSON")
  }
}
const str = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined

/**
 * Mount with `app.route("/f", funnelRoutes(opts))`.
 *
 *   GET  /:key                the hosted page (public)
 *   GET  /:key/config?code=   funnel, priced web products, the code priced per product
 *   POST /:key/events         { step }: a step view, for drop-off
 *   POST /:key/checkout       { productId, answers?, code?, email? }: { session, checkout }
 *   GET  /sessions/:id        status; once paid, and only to the browser that started the
 *                             checkout (HttpOnly cookie set by /:key/checkout),
 *                             { redemption: { link, token, expiresAt } }. Anyone else
 *                             gets the status only: the id is in the return URL.
 *   POST /redeem              { token } as the signed-in user: the purchase moves to them
 *                             (400 BAD_TOKEN, 409 REDEEM_REFUSED with the reason)
 *
 * Put `rateLimit` in front of `/:key/checkout` and `/redeem`; both are public writes.
 */
export function funnelRoutes(opts: FunnelRoutesOptions) {
  if (!opts.secret || opts.secret.length < 32)
    throw new Error("funnelRoutes needs a secret of at least 32 characters.")
  const { funnels } = opts
  const app = new Hono()
  app.onError(onError)
  const isBuyer = async (c: Context, id: string) => {
    const [sid, proof, extra] = (getCookie(c, BUYER_COOKIE) ?? "").split(".")
    if (sid !== id || !proof || extra !== undefined) return false
    let ok = false
    for (const key of [opts.secret, ...(opts.previousSecrets ?? [])])
      if (timingSafeEqual(proof, await buyerProof(key, id))) ok = true
    return ok
  }
  const country = async (c: Context) => {
    const v = (await (opts.country ?? ((x: Context) => x.req.header("cf-ipcountry")))(c)) ?? ""
    return /^[A-Za-z]{2}$/.test(v) ? { country: v.toUpperCase() } : {}
  }
  const visitor = (c: Context) => {
    const v = c.req.header("x-signet-anonymous-id")
    return v && /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : undefined
  }
  return app
    .get("/sessions/:id", async (c) => {
      const session = await funnels.get(c.req.param("id"))
      if (!session) throw new ApiException(404, "No such checkout.", "NOT_FOUND")
      const view = {
        id: session.id,
        funnel: session.funnel,
        plan: session.plan,
        amount: session.amount,
        currency: session.currency,
        status: session.status,
        discountCode: session.discountCode,
      }
      // The id travels in the return URL, so it is not a secret: only the browser
      // that started this checkout (it holds the cookie) gets a redemption link.
      if (session.status !== "paid" || !(await isBuyer(c, session.id)))
        return c.json({ session: view })
      return c.json({ session: view, redemption: await redemptionLink(opts, session.id) })
    })
    .post("/redeem", async (c) => {
      if (!opts.userId) throw new ApiException(404, "Redeeming is not enabled.", "NOT_FOUND")
      const userId = await opts.userId(c)
      if (!userId) throw new ApiException(401, "Sign in first.", "UNAUTHORIZED")
      const sessionId = await readRedemptionToken(opts, str((await body(c)).token, 1024))
      if (!sessionId)
        throw new ApiException(400, "This link is invalid or has expired.", "BAD_TOKEN")
      const orgId = (await opts.orgId?.(c)) ?? undefined
      const r = await funnels.redeem(sessionId, userId, orgId ? { orgId } : {})
      if (!r.redeemed)
        throw new ApiException(409, "This purchase cannot be unlocked here.", "REDEEM_REFUSED", {
          formErrors: [r.reason ?? "refused"],
          fieldErrors: { token: [r.reason ?? "refused"] },
        })
      return c.json(r)
    })
    .get("/:key", async (c) => {
      const key = c.req.param("key")
      const f = funnels.funnel(key)
      if (!f) throw new ApiException(404, "No such funnel.", "NOT_FOUND")
      const nonce = b64url(crypto.randomUUID())
      return c.html(funnelPage({ key, title: f.title ?? key, nonce, ...opts.page }), 200, {
        "content-security-policy": funnelPageCsp(nonce),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      })
    })
    .get("/:key/config", async (c) => {
      const code = str(c.req.query("code"), 40)
      return c.json(
        await funnels.page(c.req.param("key"), {
          ...(code ? { code } : {}),
          audience: await country(c),
        }),
      )
    })
    .post("/:key/events", async (c) => {
      const step = str((await body(c)).step, 24)
      if (!step) throw new ApiException(400, "step is required.", "VALIDATION_FAILED")
      const v = visitor(c)
      await funnels.step(c.req.param("key"), step, v ? { anonymousId: v } : {})
      return c.body(null, 204)
    })
    .post("/:key/checkout", async (c) => {
      const key = c.req.param("key")
      const b = await body(c)
      const productId = str(b.productId)
      if (!productId) throw new ApiException(400, "productId is required.", "VALIDATION_FAILED")
      const code = str(b.code, 40)
      const email = str(b.email, 320)
      const v = visitor(c)
      const orgId = (await opts.orgId?.(c)) ?? undefined
      const page = new URL(c.req.url)
      page.pathname = page.pathname.replace(/\/checkout\/?$/, "")
      page.search = ""
      const r = await funnels.start(key, {
        productId,
        answers: b.answers,
        ...(code ? { code } : {}),
        ...(email ? { email } : {}),
        ...(v ? { visitor: v } : {}),
        ...(orgId ? { orgId } : {}),
        returnUrl: (id) => `${page.toString()}?session=${encodeURIComponent(id)}`,
        audience: await country(c),
      })
      setCookie(c, BUYER_COOKIE, `${r.session.id}.${await buyerProof(opts.secret, r.session.id)}`, {
        httpOnly: true,
        sameSite: "Lax",
        secure: page.protocol === "https:",
        path: page.pathname.slice(0, page.pathname.lastIndexOf("/")) || "/",
        maxAge: opts.ttlSeconds ?? DEFAULT_TTL,
      })
      return c.json(r, 201)
    })
}

/** The page's Content-Security-Policy: its own nonce, plus Stripe's and Razorpay's hosts. */
export function funnelPageCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' https://js.stripe.com https://checkout.razorpay.com`,
    `style-src 'nonce-${nonce}'`,
    "frame-src https://js.stripe.com https://hooks.stripe.com https://api.razorpay.com",
    "connect-src 'self' https://api.stripe.com https://api.razorpay.com",
    "img-src 'self' data: https:",
    "form-action https:",
    "base-uri 'none'",
  ].join("; ")
}

/** JSON safe inside a <script> element. */
const scriptJson = (v: unknown) =>
  JSON.stringify(v).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026")
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

/**
 * The hosted page: plain HTML and one inline script, no build step. It reads
 * `./<key>/config`, walks the questions and plan picker (posting each step
 * view), starts the checkout, and finishes it the way the gateway answers:
 * Stripe's Express Checkout and Payment Elements (Stripe.js loaded at
 * runtime), Razorpay Checkout, a redirect `url`, or a POSTed `form` (PayU).
 * Back from the gateway (`?session=`), it waits for the webhook and shows the
 * redemption link and code.
 */
export function funnelPage(o: { key: string; title: string; nonce: string } & FunnelPageOptions) {
  const cfg = {
    key: o.key,
    stripeKey: o.stripePublishableKey ?? null,
    razorpayKey: o.razorpayKeyId ?? null,
    labels: { ...DEFAULT_FUNNEL_PAGE_LABELS, ...o.labels },
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<style nonce="${o.nonce}">
body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f7f7f8;color:#111}
main{max-width:28rem;margin:0 auto;padding:2rem 1rem}
h1{font-size:1.5rem;margin:0 0 1rem}
button,.btn{display:block;width:100%;box-sizing:border-box;padding:.8rem 1rem;margin:.5rem 0;border:1px solid #ccc;border-radius:.6rem;background:#fff;font:inherit;text-align:left;cursor:pointer;color:inherit;text-decoration:none}
button[aria-pressed=true],.primary{background:#111;color:#fff;border-color:#111;text-align:center}
input{width:100%;box-sizing:border-box;padding:.7rem;margin:.25rem 0 .75rem;border:1px solid #ccc;border-radius:.5rem;font:inherit}
.muted{color:#666;font-size:.9rem}.err{color:#b00020}code{word-break:break-all;display:block;padding:.5rem;background:#eee;border-radius:.4rem}
</style></head>
<body><main id="app" aria-live="polite"><h1>${esc(o.title)}</h1></main>
<script id="cfg" type="application/json">${scriptJson(cfg)}</script>
<script nonce="${o.nonce}">${PAGE_SCRIPT}</script></body></html>`
}

const PAGE_SCRIPT = `(() => {
const C = JSON.parse(document.getElementById("cfg").textContent), L = C.labels
const app = document.getElementById("app")
const base = location.pathname.replace(/\\/+$/, ""), root = base.slice(0, base.lastIndexOf("/"))
const qs = new URLSearchParams(location.search)
let visitor = localStorage.getItem("signet-visitor")
if (!visitor) { visitor = "v_" + crypto.randomUUID(); localStorage.setItem("signet-visitor", visitor) }
const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props || {}); e.append(...kids); return e }
const clear = (title) => { app.replaceChildren(); if (title) app.append(el("h1", { textContent: title })) }
const fail = (msg) => app.append(el("p", { className: "err", role: "alert", textContent: msg || L.error }))
async function api(path, data) {
  const r = await fetch(path, { method: data ? "POST" : "GET", headers: { "content-type": "application/json", "x-signet-anonymous-id": visitor }, body: data ? JSON.stringify(data) : undefined })
  if (r.status === 204) return null
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || L.error)
  return j
}
const step = (s) => api(base + "/events", { step: s }).catch(() => {})
const money = (m) => { const f = new Intl.NumberFormat(undefined, { style: "currency", currency: m.currency }); return f.format(m.amount / 10 ** f.resolvedOptions().maximumFractionDigits) }
const load = (src) => new Promise((ok, no) => document.head.append(el("script", { src, onload: ok, onerror: no })))
const answers = {}
let page, code = qs.get("code") || ""

async function start() {
  const sid = qs.get("session")
  if (sid) return done(sid)
  page = await api(base + "/config" + (code ? "?code=" + encodeURIComponent(code) : ""))
  ask(0)
}
function ask(i) {
  const qsn = page.funnel.questions || []
  if (i >= qsn.length) return plans()
  const q = qsn[i]
  step(q.id)
  clear(q.title)
  const picked = new Set()
  for (const op of q.options) {
    const b = el("button", { type: "button", textContent: op.label })
    b.setAttribute("aria-pressed", "false")
    b.onclick = () => {
      if (!q.multiple) { answers[q.id] = op.value; return ask(i + 1) }
      picked.has(op.value) ? picked.delete(op.value) : picked.add(op.value)
      b.setAttribute("aria-pressed", String(picked.has(op.value)))
    }
    app.append(b)
  }
  if (q.multiple) app.append(el("button", { type: "button", className: "primary", textContent: L.next, onclick: () => { if (picked.size) { answers[q.id] = [...picked]; ask(i + 1) } } }))
}
function plans() {
  step("plans")
  clear((page.offering.paywall && page.offering.paywall.title) || L.choosePlan)
  for (const p of page.offering.products) {
    const d = page.discounts[p.id]
    const price = d && d.valid ? money({ amount: d.amount, currency: d.currency }) + " (" + money({ amount: d.off, currency: d.currency }) + " " + L.off + ")" : money(p.price)
    app.append(el("button", { type: "button", textContent: p.plan + " · " + (p.interval || "month") + " · " + price, onclick: () => checkout(p) }))
  }
}
function checkout(p) {
  step("checkout")
  clear(p.plan)
  const email = el("input", { type: "email", autocomplete: "email", required: true })
  const coupon = el("input", { value: code, autocomplete: "off" })
  const go = el("button", { type: "submit", className: "primary", textContent: L.next })
  const form = el("form", {}, el("label", {}, L.email, email), el("label", {}, L.code, coupon), go)
  form.onsubmit = async (e) => {
    e.preventDefault(); go.disabled = true
    try {
      const r = await api(base + "/checkout", { productId: p.id, answers, email: email.value, code: coupon.value || undefined })
      await pay(r.session, r.checkout, email.value)
    } catch (err) { go.disabled = false; fail(err.message) }
  }
  app.append(form)
}
async function pay(session, c, email) {
  const back = location.origin + base + "?session=" + encodeURIComponent(session.id)
  if (c.url) return location.assign(c.url)
  if (c.form) {
    const f = el("form", { method: "POST", action: c.form.action })
    for (const [k, v] of Object.entries(c.form.fields)) f.append(el("input", { type: "hidden", name: k, value: v }))
    document.body.append(f); return f.submit()
  }
  if (c.gateway === "stripe" && c.clientSecret && C.stripeKey) {
    await load("https://js.stripe.com/v3/")
    const stripe = window.Stripe(C.stripeKey)
    const elements = stripe.elements({ clientSecret: c.clientSecret })
    clear(money(session))
    const express = el("div", { id: "express" }), card = el("div", { id: "card" })
    const btn = el("button", { type: "button", className: "primary", textContent: L.pay + " " + money(session) })
    app.append(express, el("p", { className: "muted", textContent: L.or }), card, btn)
    const confirm = async () => { const r = await stripe.confirmPayment({ elements, clientSecret: c.clientSecret, confirmParams: { return_url: back } }); if (r.error) fail(r.error.message) }
    const x = elements.create("expressCheckout")
    x.on("confirm", confirm); x.mount(express)
    elements.create("payment").mount(card)
    btn.onclick = async () => { btn.disabled = true; const s = await elements.submit(); if (s.error) { btn.disabled = false; return fail(s.error.message) } await confirm(); btn.disabled = false }
    return
  }
  if (c.gateway === "razorpay" && C.razorpayKey) {
    await load("https://checkout.razorpay.com/v1/checkout.js")
    return new window.Razorpay({ key: C.razorpayKey, order_id: c.gatewayId, amount: session.amount, currency: session.currency, prefill: { email }, handler: () => location.assign(back) }).open()
  }
  fail()
}
async function done(sid) {
  clear(L.paying)
  for (let i = 0; i < 150; i++) {
    let r
    try { r = await api(root + "/sessions/" + encodeURIComponent(sid)) } catch (e) { return fail(e.message) }
    const s = r.session.status
    if (s === "paid" && !r.redemption) return clear(L.paid) // another browser: the link is emailed
    if (s === "paid") {
      clear(L.paid)
      const copy = el("button", { type: "button", textContent: L.copy, onclick: () => navigator.clipboard && navigator.clipboard.writeText(r.redemption.token) })
      app.append(el("a", { className: "btn primary", href: r.redemption.link, textContent: L.openApp }), el("p", { className: "muted", textContent: L.codeHint }), el("code", { textContent: r.redemption.token }), copy)
      return
    }
    if (s === "redeemed") return clear(L.redeemed)
    if (s === "failed" || s === "refunded") { clear(); return fail(L.failed) }
    await new Promise((ok) => setTimeout(ok, 2000))
  }
  fail()
}
start().catch((e) => fail(e.message))
})()`
