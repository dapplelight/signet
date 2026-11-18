import { expect, test } from "bun:test"
import { app, post, signIn } from "./helpers.ts"

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

test("sign in, then the account answers", async () => {
  const cookie = await signIn("+919000000012")
  const me = (await (await app.request("/api/account/me", { headers: { cookie } })).json()) as {
    user: { role: string }
  }
  expect(me.user.role).toBe("user")
})

test("sign-out revokes the session", async () => {
  const cookie = await signIn("+919000000005")
  await post("/api/auth/sign-out", {}, cookie)
  expect((await app.request("/api/account/me", { headers: { cookie } })).status).toBe(401)
})
