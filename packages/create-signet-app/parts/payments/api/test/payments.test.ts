import { expect, test } from "bun:test"
import { app, post, signIn } from "./helpers.ts"

test("sign in, see the plan, upgrade", async () => {
  const cookie = await signIn("+919000000002")
  const me = (await (await app.request("/api/account/me", { headers: { cookie } })).json()) as {
    user: { role: string }
    plan: string
  }
  expect(me).toMatchObject({ user: { role: "user" }, plan: "free" })

  expect((await post("/api/billing/checkout", { plan: "pro" }, cookie)).status).toBe(200)
  const billing = (await (await app.request("/api/billing", { headers: { cookie } })).json()) as {
    subscription: { plan: string }
  }
  expect(billing.subscription.plan).toBe("pro")
  // notifications:begin

  // Sends are deferred; the welcome and plan notices land in the inbox shortly.
  await Bun.sleep(100)
  const inbox = (await (
    await app.request("/api/notifications", { headers: { cookie } })
  ).json()) as {
    items: { event: string }[]
  }
  expect(inbox.items.map((i) => i.event).sort()).toEqual([
    "account.welcome",
    "billing.plan_changed",
  ])
  // notifications:end
})
