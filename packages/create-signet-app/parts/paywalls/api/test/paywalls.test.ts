import { expect, test } from "bun:test"
import { createOfferings } from "@dapplelight/signet-db/offerings"
import { eq } from "drizzle-orm" // @admin
import * as schema from "../api/db/schema.ts"
import { app, db, signIn } from "./helpers.ts"

const get = (path: string, cookie: string) => app.request(path, { headers: { cookie } })

test("a placement serves its offering per audience; an unknown one is a 404", async () => {
  // Published from code, as an app does without the admin panel.
  const offerings = createOfferings(db, { tables: schema })
  const actor = { actor: { type: "system" as const, id: "test" } }
  const products = [
    { id: "plan_pro_monthly", store: "web", plan: "pro", interval: "month" as const },
  ]
  await offerings.publish("standard", { products, paywall: { title: "Go further" } }, actor)
  await offerings.publish("regional", { products, paywall: { title: "Regional" } }, actor)
  await offerings.setPlacement(
    "upgrade",
    { offering: "standard", overrides: [{ when: { country: ["IN"] }, offering: "regional" }] },
    actor,
  )

  expect((await app.request("/api/paywall/upgrade")).status).toBe(401)
  const cookie = await signIn("+919000000051")
  const res = await get("/api/paywall/upgrade", cookie)
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({
    offering: { key: "standard", version: 1, paywall: { title: "Go further" } },
  })
  expect(await (await get("/api/paywall/upgrade?country=IN", cookie)).json()).toMatchObject({
    offering: { key: "regional" },
  })
  expect((await get("/api/paywall/nowhere", cookie)).status).toBe(404)
})
// admin:begin

test("admins publish offerings and place them; users get 403", async () => {
  const send = (method: string, path: string, cookie: string, body: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    })
  const offering = {
    products: [{ id: "plan_pro_monthly", store: "web", plan: "pro" }],
    paywall: { title: "Pro" },
  }
  const user = await signIn("+919000000052")
  expect((await send("POST", "/api/admin/paywalls/offerings/launch", user, offering)).status).toBe(
    403,
  )
  const staffPhone = "+919000000053"
  const admin = await signIn(staffPhone)
  db.orm.update(schema.users).set({ role: "staff" }).where(eq(schema.users.phone, staffPhone)).run()
  expect((await send("POST", "/api/admin/paywalls/offerings/launch", admin, offering)).status).toBe(
    201,
  )
  const unknownPlan = { products: [{ id: "x", store: "web", plan: "none" }] }
  expect(
    (await send("POST", "/api/admin/paywalls/offerings/launch", admin, unknownPlan)).status,
  ).toBe(400)
  const placed = await send("PUT", "/api/admin/paywalls/placements/onboarding", admin, {
    offering: "launch",
  })
  expect(placed.status).toBe(200)
  expect(await (await get("/api/paywall/onboarding", user)).json()).toMatchObject({
    offering: { key: "launch", version: 1 },
  })
})
// admin:end
