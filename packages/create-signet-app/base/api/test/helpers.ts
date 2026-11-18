import { expect } from "bun:test" // @auth

// Shared by the API tests: one app over an in-memory database. bun test runs
// every file in one process, and the env is validated once, on first read, so
// it is set here, before the app is imported. CI has no env file; these are
// throwaway test values.
export const ADMIN = "+919000000001" // @auth
Object.assign(process.env, {
  APP_ENV: "development",
  // auth:begin
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  OTP_SECRET: "test-otp-secret-0123456789abcdef0123",
  ADMIN_PHONES: ADMIN,
  // auth:end
  BILLING: "fake", // @payments
})
export const { createApp } = await import("../api/app.ts")
export const { openDb } = await import("../api/db/open.ts")
export const { sqlKv } = await import("../api/db/kv.ts")

// auth:begin
/** The last code sent to each phone. */
export const codes = new Map<string, string>()
// auth:end
export const { db, query } = openDb(":memory:")
export const app = createApp({
  db,
  query,
  kv: sqlKv(db.orm),
  sms: { send: async (to, message) => void codes.set(to, message.match(/\d{6}/)?.[0] ?? "") }, // @auth
})

export const post = (path: string, body: unknown, cookie = "", ip = "") =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-forwarded-for": ip },
    body: JSON.stringify(body),
  })
// auth:begin

let signIns = 0
/** Sign in with a one-time code; returns the session cookie. Each sign-in
 * comes from its own address: codes are limited to 10 an hour per address. */
export async function signIn(phone: string): Promise<string> {
  const ip = `10.0.0.${++signIns}`
  expect((await post("/api/auth/otp", { phone }, "", ip)).status).toBe(200)
  const res = await post("/api/auth/verify", { phone, code: codes.get(phone) })
  expect(res.status).toBe(200)
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
}
// auth:end
