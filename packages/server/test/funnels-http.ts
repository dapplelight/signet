/**
 * funnelRoutes(): the hosted page (escaped config, CSP nonce, gateway keys),
 * the JSON API, redemption tokens (signed, expiring, purpose-bound, rotated
 * keys), 401 / 400 / 409 on redeem, and signet-db errors as the envelope.
 * The store is an in-memory stand-in shaped like signet-db's createFunnels;
 * the real one runs end to end in signet-test.
 */
import { Hono } from "hono"
import { hmacSha256, issueSession } from "../src/auth/session"
import { errorHandler } from "../src/http/errors"
import {
  type FunnelStore,
  funnelPage,
  funnelRoutes,
  readRedemptionToken,
  redemptionLink,
  redemptionToken,
} from "../src/http/funnels"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

class FakeDbError extends Error {
  readonly name = "SignetDbError"
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const SECRET = "funnel-secret-0123456789-abcdefghijklmnop"
const seen: Record<string, unknown> = {}
const sessions: Record<string, { status: string; redeemedBy?: string }> = {
  fs_paid: { status: "paid" },
  fs_open: { status: "open" },
}
const store: FunnelStore = {
  async page(key, o) {
    seen.page = { key, o }
    if (key !== "spring") throw new FakeDbError("NOT_FOUND", "No funnel.")
    return { funnel: { key }, offering: { products: [] }, discounts: {} }
  },
  funnel: (key) =>
    key === "spring" ? { key, title: "Spring </title><script>x()</script>" } : null,
  async step(key, step, ids) {
    if (step === "purchased") throw new FakeDbError("BAD_VALUE", "not a step")
    seen.step = { key, step, ids }
  },
  async start(key, input) {
    seen.start = { key, input, returnUrl: input.returnUrl?.("fs_new") }
    if (input.code === "BAD") throw new FakeDbError("BAD_VALUE", "Discount BAD cannot be used.")
    return {
      session: {
        id: "fs_new",
        funnel: key,
        plan: "pro",
        amount: 900,
        currency: "USD",
        status: "open",
        discountCode: null,
      },
      checkout: { gateway: "stripe", gatewayId: "pi_1", clientSecret: "pi_1_secret" },
    }
  },
  async get(id) {
    const s = sessions[id]
    return s
      ? {
          id,
          funnel: "spring",
          plan: "pro",
          amount: 900,
          currency: "USD",
          status: s.status,
          discountCode: null,
        }
      : null
  },
  async redeem(id, userId, o) {
    seen.redeem = { id, userId, o }
    const s = sessions[id]
    if (!s || s.status === "open") return { redeemed: false, reason: "not_paid" }
    if (s.redeemedBy && s.redeemedBy !== userId)
      return { redeemed: false, reason: "already_redeemed" }
    const already = !!s.redeemedBy
    s.redeemedBy = userId
    return { redeemed: true, already }
  },
}

const app = new Hono<{ Variables: { user?: string } }>()
app.onError(errorHandler({ isProduction: () => false }))
app.use(async (c, next) => {
  const u = c.req.header("x-user")
  if (u) c.set("user", u)
  await next()
})
app.route(
  "/f",
  funnelRoutes({
    funnels: store,
    secret: SECRET,
    redeemUrl: "https://app.example.test/redeem",
    userId: (c) => c.get("user") as string | undefined,
    orgId: () => "org_a",
    page: { stripePublishableKey: "pk_test_example" },
  }),
)
const req = (path: string, init: RequestInit & { user?: string } = {}) =>
  app.request(`https://pay.example.test${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "cf-ipcountry": "in",
      "x-signet-anonymous-id": "v_1",
      ...(init.user ? { "x-user": init.user } : {}),
      ...(init.headers as Record<string, string>),
    },
  })

{
  let threw = false
  try {
    funnelRoutes({ funnels: store, secret: "short", redeemUrl: "x" })
  } catch {
    threw = true
  }
  ok("a short secret is refused", threw)
}

// tokens
{
  const t0 = Date.parse("2026-11-01T00:00:00Z")
  const o = { secret: SECRET, now: () => t0 }
  const { token, expiresAt } = await redemptionToken(o, "fs_paid")
  ok("token expires after 7 days by default", expiresAt.getTime() === t0 + 7 * 86_400_000)
  ok("token reads back to its session", (await readRedemptionToken(o, token)) === "fs_paid")
  ok(
    "an expired token is refused",
    (await readRedemptionToken({ secret: SECRET, now: () => t0 + 8 * 86_400_000 }, token)) === null,
  )
  ok(
    "another secret is refused",
    (await readRedemptionToken({ ...o, secret: `${SECRET}x` }, token)) === null,
  )
  ok(
    "a rotated-out secret still verifies",
    (await readRedemptionToken(
      { ...o, secret: `${SECRET}new`, previousSecrets: [SECRET] },
      token,
    )) === "fs_paid",
  )
  const [body, sig] = token.split(".")
  const forged = `${btoa(JSON.stringify({ p: "signet-funnel-redeem", sid: "fs_other", exp: 9e9 })).replace(/=+$/, "")}.${sig}`
  ok(
    "a body swapped under the signature is refused",
    (await readRedemptionToken(o, forged)) === null,
  )
  ok(
    "junk is refused",
    (await readRedemptionToken(o, `${body}`)) === null &&
      (await readRedemptionToken(o, undefined)) === null,
  )
  // A session cookie signed with the same secret is not a redemption token, and the other way round.
  const cookie = await issueSession({ cookieName: "s", secret: SECRET }, "fs_paid")
  ok(
    "a session cookie never verifies as a redemption token",
    (await readRedemptionToken(o, cookie)) === null,
  )
  ok("the token's signature is purpose-bound", sig !== (await hmacSha256(SECRET, body as string)))
  const link = await redemptionLink({ ...o, redeemUrl: "example://redeem?src=web" }, "fs_paid")
  ok("link appends the token", link.link.startsWith("example://redeem?src=web&token="))
}

// page
{
  const r = await req("/f/spring")
  const html = await r.text()
  const csp = r.headers.get("content-security-policy") ?? ""
  const nonce = /nonce-([^']+)'/.exec(csp)?.[1]
  ok(
    "page: 200 html",
    r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/html"),
  )
  ok(
    "page: inline script carries the CSP nonce",
    !!nonce && html.includes(`<script nonce="${nonce}">`),
  )
  ok(
    "page: CSP allows Stripe.js and Razorpay only",
    csp.includes("https://js.stripe.com") &&
      csp.includes("https://checkout.razorpay.com") &&
      !csp.includes("unsafe-inline"),
  )
  ok(
    "page: title is escaped",
    !html.includes("</title><script>x()") && html.includes("&#60;/title&#62;"),
  )
  ok(
    "page: publishable key passed, no secret",
    html.includes("pk_test_example") && !html.includes(SECRET),
  )
  ok("page: not cached", r.headers.get("cache-control") === "no-store")
  ok("unknown funnel page: 404", (await req("/f/nope")).status === 404)
  const evil = funnelPage({
    key: "k",
    title: "t",
    nonce: "n",
    labels: { pay: "</script><script>alert(1)</script>" },
  })
  const script = /<script nonce="n">([\s\S]*)<\/script><\/body>/.exec(evil)?.[1] ?? ""
  let parses = false
  try {
    new Function(script)
    parses = script.length > 1000
  } catch (e) {
    console.log(e)
  }
  ok("page: the inline script is valid JavaScript", parses)
  ok("page: config JSON cannot close its script tag", !evil.includes("</script><script>alert(1)"))
}

// api
{
  const cfg = await req("/f/spring/config?code=SPRING20")
  ok("config: 200", cfg.status === 200)
  ok(
    "config: code and country passed to the store",
    JSON.stringify(seen.page) ===
      JSON.stringify({ key: "spring", o: { code: "SPRING20", audience: { country: "IN" } } }),
    seen.page,
  )
  ok("config: unknown funnel is 404 envelope", (await req("/f/nope/config")).status === 404)

  const ev = await req("/f/spring/events", {
    method: "POST",
    body: JSON.stringify({ step: "goal" }),
  })
  ok(
    "events: 204 with the visitor id",
    ev.status === 204 &&
      JSON.stringify(seen.step) ===
        JSON.stringify({ key: "spring", step: "goal", ids: { anonymousId: "v_1" } }),
    seen.step,
  )
  ok(
    "events: a step the store refuses is 400",
    (await req("/f/spring/events", { method: "POST", body: JSON.stringify({ step: "purchased" }) }))
      .status === 400,
  )
  ok(
    "events: step required",
    (await req("/f/spring/events", { method: "POST", body: "{}" })).status === 400,
  )

  const co = await req("/f/spring/checkout?x=1", {
    method: "POST",
    body: JSON.stringify({
      productId: "price_pro_m",
      answers: { goal: "focus" },
      code: "TEN",
      email: "b@example.test",
      amount: 1,
    }),
  })
  const cj = (await co.json()) as { checkout: { clientSecret: string } }
  const s = seen.start as { input: Record<string, unknown>; returnUrl: string }
  ok(
    "checkout: 201 with the checkout",
    co.status === 201 && cj.checkout.clientSecret === "pi_1_secret",
  )
  ok("checkout: a client price is never passed on", !("amount" in s.input), s.input)
  ok(
    "checkout: answers, code, email, visitor, org and country go to the store",
    s.input.code === "TEN" &&
      s.input.email === "b@example.test" &&
      s.input.visitor === "v_1" &&
      s.input.orgId === "org_a" &&
      JSON.stringify(s.input.audience) === '{"country":"IN"}',
    s.input,
  )
  ok(
    "checkout: return url is the page with the session",
    s.returnUrl === "https://pay.example.test/f/spring?session=fs_new",
    s.returnUrl,
  )
  ok(
    "checkout: productId required",
    (await req("/f/spring/checkout", { method: "POST", body: "{}" })).status === 400,
  )
  const badCode = await req("/f/spring/checkout", {
    method: "POST",
    body: JSON.stringify({ productId: "p", code: "BAD" }),
  })
  ok(
    "checkout: refused discount is 400 VALIDATION_FAILED",
    badCode.status === 400 &&
      ((await badCode.json()) as { code: string }).code === "VALIDATION_FAILED",
  )
  ok(
    "checkout: bad json is 400",
    (await req("/f/spring/checkout", { method: "POST", body: "{" })).status === 400,
  )

  const open = (await (await req("/f/sessions/fs_open")).json()) as Record<string, unknown>
  ok("session: open has no redemption", !("redemption" in open))
  const setCookie = co.headers.get("set-cookie") ?? ""
  const buyer = setCookie.split(";")[0] ?? ""
  ok(
    "checkout: sets an HttpOnly, SameSite=Lax, Secure cookie scoped to the mount",
    buyer.startsWith("signet_funnel=fs_new.") &&
      /HttpOnly/i.test(setCookie) &&
      /SameSite=Lax/i.test(setCookie) &&
      /Secure/i.test(setCookie) &&
      /Path=\/f(;|$)/.test(setCookie),
    setCookie,
  )
  sessions.fs_new = { status: "open" }
  const openMine = (await (
    await req("/f/sessions/fs_new", { headers: { cookie: buyer } })
  ).json()) as Record<string, unknown>
  ok("session: open has no redemption for the buyer either", !("redemption" in openMine))
  sessions.fs_new = { status: "paid" }
  const stranger = (await (await req("/f/sessions/fs_new")).json()) as Record<string, unknown>
  ok(
    "session: paid, but no cookie (id from a shared URL) gets the status and no link",
    (stranger.session as { status: string }).status === "paid" && !("redemption" in stranger),
  )
  const forged = await req("/f/sessions/fs_new", {
    headers: { cookie: `${buyer.slice(0, -2)}xx` },
  })
  ok("session: a forged cookie gets no link", !("redemption" in ((await forged.json()) as object)))
  const elsewhere = await req("/f/sessions/fs_paid", { headers: { cookie: buyer } })
  ok(
    "session: the cookie of one session opens no other",
    !("redemption" in ((await elsewhere.json()) as object)),
  )
  const paid = (await (await req("/f/sessions/fs_new", { headers: { cookie: buyer } })).json()) as {
    redemption: { link: string; token: string }
  }
  ok(
    "session: paid has a link with a token for the buyer's browser",
    paid.redemption.link.startsWith("https://app.example.test/redeem?token="),
  )
  ok("session: unknown is 404", (await req("/f/sessions/fs_none")).status === 404)

  const redeem = (token: string, user?: string) =>
    req("/f/redeem", { method: "POST", body: JSON.stringify({ token }), ...(user ? { user } : {}) })
  ok("redeem: signed out is 401", (await redeem(paid.redemption.token)).status === 401)
  const bad = await redeem("nope", "u1")
  ok(
    "redeem: a bad token is 400 BAD_TOKEN",
    bad.status === 400 && ((await bad.json()) as { code: string }).code === "BAD_TOKEN",
  )
  const first = await redeem(paid.redemption.token, "u1")
  ok(
    "redeem: 200 for the signed-in user, with the org",
    first.status === 200 &&
      JSON.stringify(seen.redeem) ===
        JSON.stringify({ id: "fs_new", userId: "u1", o: { orgId: "org_a" } }),
    seen.redeem,
  )
  ok(
    "redeem: repeating it is a no-op",
    ((await (await redeem(paid.redemption.token, "u1")).json()) as { already: boolean }).already ===
      true,
  )
  const other = await redeem(paid.redemption.token, "u2")
  const oj = (await other.json()) as { code: string; details?: { formErrors: string[] } }
  ok(
    "redeem: another account is 409 REDEEM_REFUSED",
    other.status === 409 &&
      oj.code === "REDEEM_REFUSED" &&
      oj.details?.formErrors[0] === "already_redeemed",
    oj,
  )
  const unpaid = (await redemptionToken({ secret: SECRET }, "fs_open")).token
  ok("redeem: an unpaid session is 409", (await redeem(unpaid, "u1")).status === 409)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
