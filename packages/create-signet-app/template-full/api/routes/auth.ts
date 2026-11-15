import { requireStoredSession } from "@dapplelight/signet-server/auth/hono"
import {
  maskPhone,
  type OtpVerifyResult,
  requestPhoneOtp,
  verifyPhoneOtp,
} from "@dapplelight/signet-server/auth/otp"
import {
  clearCookie,
  readSessionCookie,
  sessionCookie,
} from "@dapplelight/signet-server/auth/session"
import {
  startSession,
  type ValidSession,
  validateSession,
} from "@dapplelight/signet-server/auth/sessions"
import { ApiException } from "@dapplelight/signet-server/http"
import { zValidator } from "@dapplelight/signet-server/http/validate"
import { clientIp } from "@dapplelight/signet-server/middleware/rate-limit"
import { eq } from "drizzle-orm"
import { Hono, type MiddlewareHandler } from "hono"
import { z } from "zod"
import type { AppEnv } from "../app.ts"
import { type User, users } from "../db/schema.ts"
import { env } from "../env.ts"
import { type Services, TRUST } from "../services.ts"

/** The user fields the web app sees. */
export const publicUser = ({ id, phone, name, email, role }: User) => ({
  id,
  phone,
  name,
  email,
  role,
})

const VERIFY_ERRORS: Record<Exclude<OtpVerifyResult, { ok: true }>["code"], string> = {
  INVALID_PHONE: "Enter a valid phone number.",
  CODE_EXPIRED: "That code has expired. Send a new one.",
  INVALID_CODE: "That code is not right.",
  TOO_MANY_ATTEMPTS: "Too many tries. Send a new code.",
}

/** Gate on a live stored session, then load its user into `c.get("user")`. */
export function requireUser(s: Services): MiddlewareHandler<AppEnv> {
  const gate = requireStoredSession(s.sessions)
  return (c, next) =>
    gate(c, async () => {
      const session = c.get("session" as never) as ValidSession
      const user = s.orm.select().from(users).where(eq(users.id, session.record.sub)).get()
      if (!user) throw new ApiException(401, "Sign in again.", "UNAUTHORIZED")
      c.set("user", user)
      await next()
    })
}

/**
 * Phone one-time-code sign-in. A first sign-in creates the user; numbers in
 * ADMIN_PHONES get the admin role.
 *
 *   POST /otp        { phone }          sends a code (printed to the console in development)
 *   POST /verify     { phone, code }    sets the session cookie, returns the user
 *   POST /sign-out                      revokes this session
 */
export const authRoutes = (s: Services) =>
  new Hono<AppEnv>()
    .post("/otp", zValidator("json", z.object({ phone: z.string().min(6).max(20) })), async (c) => {
      const r = await requestPhoneOtp(s.otp, {
        phone: c.req.valid("json").phone,
        ip: clientIp(c, TRUST),
      })
      if (!r.ok)
        throw r.code === "RATE_LIMITED"
          ? new ApiException(429, "Too many codes. Try again later.", "RATE_LIMITED")
          : new ApiException(400, VERIFY_ERRORS.INVALID_PHONE, r.code)
      return c.json({ to: maskPhone(r.phone), expiresInSeconds: r.expiresInSeconds })
    })
    .post(
      "/verify",
      zValidator("json", z.object({ phone: z.string().min(6).max(20), code: z.string().min(4) })),
      async (c) => {
        const { phone, code } = c.req.valid("json")
        const r = await verifyPhoneOtp(s.otp, { phone, code, ip: clientIp(c, TRUST) })
        if (!r.ok) throw new ApiException(400, VERIFY_ERRORS[r.code], r.code)

        const admin = env.ADMIN_PHONES.split(",")
          .map((p) => p.trim())
          .includes(r.phone)
        let user = s.orm.select().from(users).where(eq(users.phone, r.phone)).get()
        const isNew = !user
        if (!user)
          user = s.orm
            .insert(users)
            .values({ phone: r.phone, role: admin ? "admin" : "user" })
            .returning()
            .get()
        else if (admin && user.role !== "admin")
          user = s.orm
            .update(users)
            .set({ role: "admin" })
            .where(eq(users.id, user.id))
            .returning()
            .get()
        if (!user) throw new Error("Could not create the account.")

        const { token } = await startSession(s.sessions, {
          sub: user.id,
          userAgent: c.req.header("user-agent"),
          previousToken: readSessionCookie(c.req.header("cookie"), s.sessions),
        })
        c.header("Set-Cookie", sessionCookie(token, s.sessions))
        if (isNew) await s.notifier.notify(user.id, "account.welcome", { name: maskPhone(r.phone) })
        return c.json({ user: publicUser(user) })
      },
    )
    .post("/sign-out", async (c) => {
      const session = await validateSession(
        readSessionCookie(c.req.header("cookie"), s.sessions),
        s.sessions,
      )
      if (session) await s.sessions.store.revoke(session.record.id)
      c.header("Set-Cookie", clearCookie(s.sessions))
      return c.json({ ok: true })
    })
