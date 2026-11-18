// account:begin
import { createApiKey, listApiKeys, revokeApiKey } from "@dapplelight/signet-server/auth/api-keys"
import { ApiException } from "@dapplelight/signet-server/http"
import { zValidator } from "@dapplelight/signet-server/http/validate"
import { eq } from "drizzle-orm"
// account:end
import { Hono } from "hono"
import { z } from "zod" // @account
import type { AppEnv } from "../app.ts"
import { users } from "../db/schema.ts" // @account
import type { Services } from "../services.ts"
import { publicUser } from "./auth.ts"

/**
 *   GET    /me                 the signed-in user and their plan // @payments
 *   GET    /me                 the signed-in user // @!payments
 // account:begin
 *   PATCH  /me                 { name?, email? }
 *   GET    /api-keys           { keys }
 *   POST   /api-keys           { name } → { token } (shown once)
 *   DELETE /api-keys/:id
 // account:end
 */
// payments:begin
export const accountRoutes = (s: Services) =>
  // account:begin
  new Hono<AppEnv>()
    .get("/me", async (c) => {
      const user = c.get("user")
      const { plan } = await s.entitlements.get(user.id)
      return c.json({ user: publicUser(user), plan })
    })
  // account:end
  // !account:begin
  new Hono<AppEnv>().get("/me", async (c) => {
    const user = c.get("user")
    const { plan } = await s.entitlements.get(user.id)
    return c.json({ user: publicUser(user), plan })
  })
  // !account:end
// payments:end
// !payments:begin
// account:begin
export const accountRoutes = (s: Services) =>
  new Hono<AppEnv>()
    .get("/me", (c) => c.json({ user: publicUser(c.get("user")) }))
// account:end
// !account:begin
export const accountRoutes = (_s: Services) =>
  new Hono<AppEnv>().get("/me", (c) => c.json({ user: publicUser(c.get("user")) }))
// !account:end
// !payments:end
    // account:begin
    .patch(
      "/me",
      zValidator(
        "json",
        z.object({
          name: z.string().trim().min(1).max(80).optional(),
          email: z.email().optional(),
        }),
      ),
      (c) => {
        const user = s.orm
          .update(users)
          .set(c.req.valid("json"))
          .where(eq(users.id, c.get("user").id))
          .returning()
          .get()
        if (!user) throw new ApiException(404, "Account not found.", "NOT_FOUND")
        return c.json({ user: publicUser(user) })
      },
    )
    .get("/api-keys", async (c) => c.json({ keys: await listApiKeys(s.apiKeys, c.get("user").id) }))
    .post(
      "/api-keys",
      zValidator("json", z.object({ name: z.string().trim().min(1).max(100) })),
      async (c) => {
        const { token, key } = await createApiKey(s.apiKeys, {
          sub: c.get("user").id,
          name: c.req.valid("json").name,
          prefix: "app",
        })
        return c.json({ token, key }, 201)
      },
    )
    .delete("/api-keys/:id", async (c) => {
      if (!(await revokeApiKey(s.apiKeys, c.get("user").id, c.req.param("id"))))
        throw new ApiException(404, "Key not found.", "NOT_FOUND")
      return c.json({ revoked: 1 })
    })
    // account:end
