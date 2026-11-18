import { expect, test } from "bun:test"
import { app, post, signIn } from "./helpers.ts"

test("name a profile; an API key is shown once, listed, then revoked", async () => {
  const cookie = await signIn("+919000000014")
  const named = await app.request("/api/account/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie, origin: "http://localhost" },
    body: JSON.stringify({ name: "Asha" }),
  })
  expect(((await named.json()) as { user: { name: string } }).user.name).toBe("Asha")

  const created = await post("/api/account/api-keys", { name: "ci" }, cookie)
  expect(created.status).toBe(201)
  const { token, key } = (await created.json()) as { token: string; key: { id: string } }
  expect(token.startsWith("app")).toBe(true)
  const list = async () =>
    (
      (await (await app.request("/api/account/api-keys", { headers: { cookie } })).json()) as {
        keys: { id: string }[]
      }
    ).keys.map((k) => k.id)
  expect(await list()).toEqual([key.id])
  const revoke = await app.request(`/api/account/api-keys/${key.id}`, {
    method: "DELETE",
    headers: { cookie, origin: "http://localhost" },
  })
  expect(revoke.status).toBe(200)
  expect(await list()).toEqual([])
})
