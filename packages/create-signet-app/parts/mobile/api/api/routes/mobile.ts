import { exchangeToken, revokeClientToken } from "@dapplelight/signet-server/auth/client-login"
import { ApiException } from "@dapplelight/signet-server/http"
import { zValidator } from "@dapplelight/signet-server/http/validate"
import { clientIp } from "@dapplelight/signet-server/middleware/rate-limit"
import { type Context, Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../app.ts"
import { type Services, TRUST } from "../services.ts"

/** An Expo push token, as `getExpoPushTokenAsync` returns it. */
const pushToken = z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]+\]$/) })

/** A form or JSON body's string fields: the token endpoint takes either, as OAuth does. */
async function params(c: Context): Promise<Record<string, string>> {
  const json = (c.req.header("content-type") ?? "").includes("application/json")
  const body = (json ? await c.req.json().catch(() => ({})) : await c.req.parseBody()) as Record<
    string,
    unknown
  >
  return Object.fromEntries(
    Object.entries(body ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"),
  )
}

/**
 * The mobile app's routes. Sign-in is POST /api/auth/verify?client_id=mobile,
 * which answers with a token pair instead of the cookie.
 *
 *   POST   /token        grant_type=refresh_token, refresh_token, client_id → new tokens
 *   POST   /revoke       { token }   signs this phone out (always 200)
 *   POST   /push/token   { token }   saves this phone's Expo push token
 *   DELETE /push/token   { token }   forgets it (sign-out, notifications off)
 *   POST   /push/test                sends yourself a push that opens the Devices tab
 */
export const mobileRoutes = (s: Services) =>
  new Hono<AppEnv>()
    .post("/token", async (c) => {
      c.header("Cache-Control", "no-store")
      const p = await params(c)
      // Refresh only: the code and device grants are never issued here.
      if (p.grant_type !== "refresh_token") return c.json({ error: "unsupported_grant_type" }, 400)
      const r = await exchangeToken(s.clientLogin, p, {
        userAgent: c.req.header("user-agent"),
        ip: clientIp(c, TRUST),
      })
      if (!r.ok) return c.json({ error: r.error, error_description: r.error_description }, r.status)
      return c.json(r.tokens)
    })
    .post("/revoke", async (c) => {
      await revokeClientToken(s.clientLogin, (await params(c)).token ?? "")
      return c.json({ ok: true })
    })
    .post("/push/token", zValidator("json", pushToken), async (c) => {
      await s.pushTokens.add(c.get("user").id, c.req.valid("json").token)
      return c.json({ ok: true })
    })
    .delete("/push/token", zValidator("json", pushToken), async (c) => {
      await s.pushTokens.remove(c.req.valid("json").token, c.get("user").id)
      return c.json({ ok: true })
    })
    .post("/push/test", async (c) => {
      const user = c.get("user")
      if (!(await s.pushTokens.list(user.id)).length)
        throw new ApiException(409, "Turn on notifications in the app first.", "CONFLICT")
      const r = await s.push.send(
        user.id,
        { title: "Test notification", body: "Tap to open your devices.", url: "/devices" },
        { idempotencyKey: crypto.randomUUID() },
      )
      return c.json({ ok: true, id: r.id })
    })
