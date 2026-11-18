import { expect, test } from "bun:test"
import { app, codes, post } from "./helpers.ts"

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
