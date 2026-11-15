import { generateWebhookSecret, signWebhook, verifyWebhook } from "../src/webhooks"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

// Standard Webhooks' published test vector.
const vecSecret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
const vecBody = '{"test": 2432232314}'
const vec = await signWebhook({
  secret: vecSecret,
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: 1614265330,
  body: vecBody,
})
ok(
  "matches the Standard Webhooks test vector",
  vec["webhook-signature"] === "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  vec,
)

const secret = generateWebhookSecret()
ok("secret is whsec_ + 32 bytes", /^whsec_/.test(secret) && atob(secret.slice(6)).length === 32)
const body = JSON.stringify({ type: "order.created", data: { id: "o1" } })
const now = Date.now()
const h = await signWebhook({ secret, id: "evt_1", body, timestamp: Math.floor(now / 1000) })
ok("verifies its own signature", await verifyWebhook(secret, new Headers(h), body, { now }))
ok("plain object headers work", await verifyWebhook(secret, h, body, { now }))
ok("a changed body fails", !(await verifyWebhook(secret, h, `${body} `, { now })))
ok("another secret fails", !(await verifyWebhook(generateWebhookSecret(), h, body, { now })))
ok(
  "a changed id fails",
  !(await verifyWebhook(secret, { ...h, "webhook-id": "evt_2" }, body, { now })),
)
ok("an old timestamp fails", !(await verifyWebhook(secret, h, body, { now: now + 301_000 })))
ok(
  "tolerance is configurable",
  await verifyWebhook(secret, h, body, { now: now + 301_000, toleranceSeconds: 600 }),
)
ok("missing headers fail", !(await verifyWebhook(secret, {}, body, { now })))
ok(
  "a malformed secret is false, not a throw",
  !(await verifyWebhook("whsec_%%%", h, body, { now })),
)
const old = generateWebhookSecret()
const both = await signWebhook({ secret: [old, secret], id: "evt_1", body })
ok("rotation: two signatures", both["webhook-signature"].split(" ").length === 2)
ok(
  "rotation: either secret verifies",
  (await verifyWebhook(old, both, body)) && (await verifyWebhook(secret, both, body)),
)
const svix = {
  "svix-id": h["webhook-id"],
  "svix-timestamp": h["webhook-timestamp"],
  "svix-signature": h["webhook-signature"],
}
ok("svix header prefix", await verifyWebhook(secret, svix, body, { now, headerPrefix: "svix" }))

console.log(`\nwebhooks: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
