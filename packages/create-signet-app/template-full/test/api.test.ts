import { expect, test } from "bun:test"

// The env is read on first use, so set it before the app is imported. CI has
// no env file; these are throwaway test values.
const ADMIN = "+919000000001"
Object.assign(process.env, {
  APP_ENV: "development",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  OTP_SECRET: "test-otp-secret-0123456789abcdef0123",
  ADMIN_PHONES: ADMIN,
  BILLING: "fake",
})
const { createApp } = await import("../api/app.ts")
const { openDb } = await import("../api/db/open.ts")
const { sqlKv } = await import("../api/db/kv.ts")

const codes = new Map<string, string>()
const { db, query } = openDb(":memory:")
const app = createApp({
  db,
  query,
  kv: sqlKv(db.orm),
  sms: { send: async (to, message) => void codes.set(to, message.match(/\d{6}/)?.[0] ?? "") },
})

const post = (path: string, body: unknown, cookie = "") =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  })

/** Sign in with a one-time code; returns the session cookie. */
async function signIn(phone: string): Promise<string> {
  expect((await post("/api/auth/otp", { phone })).status).toBe(200)
  const res = await post("/api/auth/verify", { phone, code: codes.get(phone) })
  expect(res.status).toBe(200)
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
}

test("signed-out calls are 401 in the error envelope", async () => {
  const res = await app.request("/api/account/me")
  expect(res.status).toBe(401)
  expect(((await res.json()) as { code: string }).code).toBe("UNAUTHORIZED")
})

test("a wrong code is refused", async () => {
  await post("/api/auth/otp", { phone: "+919000000009" })
  const res = await post("/api/auth/verify", { phone: "+919000000009", code: "000000" })
  expect(res.status).toBe(400)
})

test("sign in, see the plan, upgrade, get notified", async () => {
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
})

test("admin is for ADMIN_PHONES (and other staff roles) only", async () => {
  const user = await signIn("+919000000003")
  expect((await app.request("/api/admin", { headers: { cookie: user } })).status).toBe(403)
  const admin = await signIn(ADMIN)
  const res = await app.request("/api/admin/users", { headers: { cookie: admin } })
  expect(res.status).toBe(200)
  expect(((await res.json()) as { rows: unknown[] }).rows.length).toBeGreaterThan(0)
})

test("consent is given and withdrawn; an erasure request opens", async () => {
  const cookie = await signIn("+919000000004")
  expect((await post("/api/privacy/consents/analytics", {}, cookie)).status).toBe(200)
  // A browser sends Origin on a DELETE; the CSRF guard refuses one without it.
  const withdraw = await app.request("/api/privacy/consents/analytics", {
    method: "DELETE",
    headers: { cookie, origin: "http://localhost" },
  })
  expect(withdraw.status).toBe(200)
  expect((await post("/api/privacy/requests", { kind: "erasure" }, cookie)).status).toBe(201)
  const p = (await (await app.request("/api/privacy", { headers: { cookie } })).json()) as {
    consents: { withdrawnAt: string | null }[]
    requests: { kind: string }[]
  }
  expect(p.consents[0]?.withdrawnAt).not.toBeNull()
  expect(p.requests[0]?.kind).toBe("erasure")
})

test("sign-out revokes the session", async () => {
  const cookie = await signIn("+919000000005")
  await post("/api/auth/sign-out", {}, cookie)
  expect((await app.request("/api/account/me", { headers: { cookie } })).status).toBe(401)
})

test("staff cannot change a role or phone; an admin can", async () => {
  const { users } = await import("../api/db/schema.ts")
  const { eq } = await import("drizzle-orm")
  const staff = await signIn("+919000000006")
  const staffRow = db.orm.select().from(users).where(eq(users.phone, "+919000000006")).get()
  db.orm.update(users).set({ role: "staff" }).where(eq(users.phone, "+919000000006")).run()
  const patch = (cookie: string, id: string, body: unknown) =>
    app.request(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    })
  const id = staffRow?.id ?? ""

  expect((await patch(staff, id, { role: "admin" })).status).toBe(403)
  expect((await patch(staff, id, { phone: "+919000000099" })).status).toBe(403)
  expect((await patch(staff, id, { name: "Staff" })).status).toBe(200)
  expect(db.orm.select().from(users).where(eq(users.id, id)).get()?.role).toBe("staff")

  const admin = await signIn(ADMIN)
  expect((await patch(admin, id, { role: "readonly" })).status).toBe(200)
  expect(db.orm.select().from(users).where(eq(users.id, id)).get()?.role).toBe("readonly")
})
