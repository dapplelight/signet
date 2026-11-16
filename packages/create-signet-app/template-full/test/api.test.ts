import { expect, spyOn, test } from "bun:test"

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

test("sign-up makes a personal org; another org's data is 404", async () => {
  const get = (path: string, cookie: string, org?: string) =>
    app.request(path, { headers: { cookie, ...(org ? { "x-org": org } : {}) } })
  const signInWithOrg = async (phone: string) => {
    expect((await post("/api/auth/otp", { phone })).status).toBe(200)
    const res = await post("/api/auth/verify", { phone, code: codes.get(phone) })
    // Two cookies: the session, and the org the user lands in.
    const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0])
    expect(cookies.some((c) => c?.startsWith("signet_org="))).toBe(true)
    return cookies.join("; ")
  }
  const a = await signInWithOrg("+919000000010")
  const b = await signInWithOrg("+919000000011")
  const mine = (await (await get("/api/orgs", a)).json()) as {
    orgs: { org: { id: string; personal: boolean }; role: string }[]
  }
  expect(mine.orgs).toHaveLength(1)
  expect(mine.orgs[0]).toMatchObject({ role: "owner", org: { personal: true } })
  const aOrg = mine.orgs[0]?.org.id as string
  expect((await get("/api/orgs/current", a)).status).toBe(200)
  // B pointing at A's org, by header: not found, and nothing leaks.
  for (const path of [
    "/api/orgs/current",
    "/api/orgs/current/members",
    "/api/orgs/current/invites",
  ])
    expect((await get(path, b, aOrg)).status).toBe(404)
  const join = (await post("/api/orgs/switch", { orgId: aOrg }, b)).status
  expect(join).toBe(404)

  // A invites B by link; B joins A's org and sees it.
  const invite = await app.request("/api/orgs/current/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: a },
    body: JSON.stringify({ role: "member" }),
  })
  const { token } = (await invite.json()) as { token: string }
  expect((await app.request(`/api/orgs/invites/${token}`)).status).toBe(200) // preview, signed out
  expect((await post(`/api/orgs/invites/${token}/accept`, {}, b)).status).toBe(200)
  expect((await get("/api/orgs/current/members", b, aOrg)).status).toBe(200)
  // A member cannot change settings.
  const patch = await app.request("/api/orgs/current", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: b,
      "x-org": aOrg,
      origin: "http://localhost",
    },
    body: JSON.stringify({ name: "x" }),
  })
  expect(patch.status).toBe(403)
})

test("observability is off unless configured: no /health, no log lines", async () => {
  const lines: string[] = []
  const spy = spyOn(console, "log").mockImplementation((l: string) => void lines.push(l))
  try {
    expect((await app.request("/health/live")).status).toBe(404)
    expect((await app.request("/api/health")).status).toBe(200)
  } finally {
    spy.mockRestore()
  }
  expect(lines).toEqual([])
})

test("observability on: request logs, probes left out, /health/ready checks the database", async () => {
  const lines: string[] = []
  const spy = spyOn(console, "log").mockImplementation((l: string) => void lines.push(l))
  try {
    const { db, query } = openDb(":memory:")
    const on = createApp({
      db,
      query,
      kv: sqlKv(db.orm),
      observability: { serviceName: "demo", mixin: () => ({ region: "test" }) },
    })
    const live = await on.request("/health/live")
    expect(live.status).toBe(200)
    expect(await live.json()).toEqual({ ok: true })
    const ready = await on.request("/health/ready")
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ ok: true, checks: { db: true } })
    expect(lines).toEqual([]) // probes are not logged
    const headers = { cookie: "session=s" }
    const res = await on.request("/api/health?token=abc", { headers })
    expect([res.status, await res.text()]).toEqual([200, '{"ok":true}'])
  } finally {
    spy.mockRestore()
  }
  const logged = lines.map((l) => JSON.parse(l) as Record<string, unknown>)
  expect(logged.map((l) => l.msg)).toEqual(["request.started", "request.completed"])
  expect(logged[1]).toMatchObject({
    service: "demo",
    region: "test",
    method: "GET",
    route: "/api/health",
    status: 200,
  })
  expect(typeof logged[1]?.reqId).toBe("string")
  expect(lines.join("\n")).not.toMatch(/token=abc|session=s/)
})
