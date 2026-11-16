import { expect, test } from "bun:test"
import { createPkce, pkceChallenge } from "./lib/pkce"

test("S256 challenge matches the RFC 7636 appendix B vector", async () => {
  expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  )
})

test("verifier is 43 unreserved characters and state differs from it", async () => {
  const { verifier, challenge, state } = await createPkce()
  expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(state).not.toBe(verifier)
})
