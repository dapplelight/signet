import { expect, test } from "bun:test"
import { createEnv } from "@dapplelight/signet-server/env"
import { envSchema } from "../src/env"

test("APP_ENV defaults to development", () => {
  expect(envSchema.parse({}).APP_ENV).toBe("development")
})

test("an unknown APP_ENV is rejected, not treated as development", () => {
  expect(envSchema.safeParse({ APP_ENV: "prod" }).success).toBe(false)
})

test("createEnv validates lazily, on first read", () => {
  const env = createEnv(envSchema, { source: () => ({ APP_ENV: "nope" }) })
  expect(() => env.APP_ENV).toThrow("Invalid environment variables")
})
