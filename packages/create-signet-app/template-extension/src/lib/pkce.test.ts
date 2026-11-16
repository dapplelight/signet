import { expect, test } from "bun:test"
import { pkceChallenge, randomString } from "./pkce"

test("matches the RFC 7636 appendix B vector", async () => {
  expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  )
})

test("random strings are valid verifiers", () => {
  expect(randomString()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(randomString()).not.toBe(randomString())
})
