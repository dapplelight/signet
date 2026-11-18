import { expect, test } from "bun:test"
import { app, post, signIn } from "./helpers.ts"

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
