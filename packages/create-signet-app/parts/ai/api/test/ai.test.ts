import { expect, test } from "bun:test"
import { eq } from "drizzle-orm" // @admin
import { spendCaps, users } from "../api/db/schema.ts" // @admin
import { spendCaps } from "../api/db/schema.ts" // @!admin
import { app, db, post, signIn } from "./helpers.ts"

const userId = async (cookie: string) => {
  const me = await app.request("/api/account/me", { headers: { cookie } })
  return ((await me.json()) as { user: { id: string } }).user.id
}

test("an AI call answers with no provider key, charged to the caller", async () => {
  expect((await post("/api/ai/summary", { text: "Some text." })).status).toBe(401)
  const cookie = await signIn("+919000000041")
  const res = await post("/api/ai/summary", { text: "Some text to sum up." }, cookie)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ summary: "Some text to sum up.", costUsd: 0.001 })
})

test("over the caller's cap: 429 with Retry-After, and the route does not run", async () => {
  const cookie = await signIn("+919000000042")
  const id = await userId(cookie)
  db.orm
    .insert(spendCaps)
    .values({ id: `user:${id}:day`, scope: "user", subject: id, period: "day", units: 0 })
    .run()
  const res = await post("/api/ai/summary", { text: "Some text." }, cookie)
  expect(res.status).toBe(429)
  expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
  expect(((await res.json()) as { code: string }).code).toBe("AI_SPEND_CAP_EXCEEDED")
})
// admin:begin

test("admins read AI spend and set caps; everyone else gets 403", async () => {
  const user = await signIn("+919000000043")
  const headers = { cookie: user }
  expect((await app.request("/api/admin/ai-spend/usage", { headers })).status).toBe(403)
  const admin = await signIn("+919000000044")
  db.orm.update(users).set({ role: "admin" }).where(eq(users.phone, "+919000000044")).run()
  const cap = { scope: "user", subject: "*", period: "month", units: 50_000_000 }
  const put = await app.request("/api/admin/ai-spend/caps", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify(cap),
  })
  expect(put.status).toBe(200)
  const caps = (await (
    await app.request("/api/admin/ai-spend/caps", { headers: { cookie: admin } })
  ).json()) as { caps: { id: string }[] }
  expect(caps.caps.map((c) => c.id)).toContain("user:*:month")
})
// admin:end
