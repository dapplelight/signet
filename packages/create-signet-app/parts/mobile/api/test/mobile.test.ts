import { expect, test } from "bun:test"
import { app, codes, post } from "./helpers.ts"

type Tokens = { access_token: string; refresh_token: string; expires_in: number }

let n = 0
/** The mobile app's sign-in: the same phone code, answered with a token pair. */
async function mobileSignIn(phone: string): Promise<Tokens> {
  expect((await post("/api/auth/otp", { phone }, "", `10.1.0.${++n}`)).status).toBe(200)
  const res = await post("/api/auth/verify?client_id=mobile", { phone, code: codes.get(phone) })
  expect(res.status).toBe(200)
  expect(res.headers.get("set-cookie")).toBeNull()
  return ((await res.json()) as { tokens: Tokens }).tokens
}
const bearer = (token: string, init: RequestInit = {}) => ({
  ...init,
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
})
const form = (body: Record<string, string>) =>
  app.request("/api/mobile/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  })

test("an unknown client is refused before the code is used", async () => {
  await post("/api/auth/otp", { phone: "+919000000701" }, "", "10.1.1.1")
  const bad = await post("/api/auth/verify?client_id=other", {
    phone: "+919000000701",
    code: codes.get("+919000000701"),
  })
  expect(bad.status).toBe(400)
})

test("sign in, call the API with the token, refresh with a form post", async () => {
  const t = await mobileSignIn("+919000000702")
  expect((await app.request("/api/account/me", bearer(t.access_token))).status).toBe(200)
  const res = await form({
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
    client_id: "mobile",
  })
  expect(res.status).toBe(200)
  const next = (await res.json()) as Tokens
  expect((await app.request("/api/account/me", bearer(next.access_token))).status).toBe(200)
  // A refresh token works once; the old one again revokes the session.
  const again = await form({
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
    client_id: "mobile",
  })
  expect(again.status).toBe(400)
})

test("the devices list sees the phone's session", async () => {
  const t = await mobileSignIn("+919000000703")
  const res = await app.request("/api/sessions", bearer(t.access_token))
  const { sessions } = (await res.json()) as { sessions: { current: boolean }[] }
  expect(sessions.some((s) => s.current)).toBe(true)
})

test("push tokens: saved, refused when malformed, and revoke signs out", async () => {
  const t = await mobileSignIn("+919000000704")
  const save = (token: string) =>
    app.request(
      "/api/mobile/push/token",
      bearer(t.access_token, { method: "POST", body: JSON.stringify({ token }) }),
    )
  expect((await save("ExponentPushToken[abc123]")).status).toBe(200)
  expect((await save("not-a-token")).status).toBe(400)
  const anonymous = await post("/api/mobile/push/token", { token: "ExponentPushToken[x]" })
  expect(anonymous.status).toBe(401)

  await app.request("/api/mobile/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: t.refresh_token }).toString(),
  })
  expect((await app.request("/api/account/me", bearer(t.access_token))).status).toBe(401)
})
