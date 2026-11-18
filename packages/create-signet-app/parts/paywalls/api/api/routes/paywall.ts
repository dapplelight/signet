import { ApiException } from "@dapplelight/signet-server/http/errors"
import { zValidator } from "@dapplelight/signet-server/http/validate"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../app.ts"
import type { Services } from "../services.ts"

/**
 * The paywall a placement ("onboarding", "upgrade") serves the caller now:
 * the first audience override that matches, else the placement's offering.
 * What it serves changes without a release: publish a new offering version
 * and point the placement at it, from code with `s.offerings.publish(...)`
 * and `s.offerings.setPlacement(...)` (see README, "Paywalls"). // @!admin
 * and point the placement at it, through /api/admin/paywalls (below) or from // @admin
 * code with `s.offerings.publish(...)` and `setPlacement(...)`. // @admin
 *
 *   GET /:placement?country=IN&platform=web   { offering }, or 404
 */
export const paywallRoutes = (s: Services) =>
  new Hono<AppEnv>().get(
    "/:placement",
    zValidator("param", z.object({ placement: z.string().min(1).max(64) })),
    zValidator(
      "query",
      z.object({
        country: z.string().length(2).optional(),
        platform: z.string().min(1).max(32).optional(),
      }),
    ),
    async (c) => {
      const offering = await s.offerings.current(
        c.req.valid("param").placement,
        c.req.valid("query"),
        c.get("user").id,
      )
      if (!offering) throw new ApiException(404, "No paywall for this placement.", "NOT_FOUND")
      return c.json({ offering })
    },
  )
// admin:begin

const product = z.object({
  /** The store product id, or the web gateway's plan id. */
  id: z.string(),
  store: z.string(),
  /** A plan from api/plans.ts. */
  plan: z.string(),
  interval: z.enum(["month", "year", "once"]).optional(),
  /** What the paywall shows, in minor units. */
  price: z.object({ amount: z.number().int(), currency: z.string() }).optional(),
  /** Trials, intro and win-back offers; checked by signet-db's offerings. */
  offers: z.array(z.any()).optional(),
})

const paywall = z
  .object({
    title: z.string(),
    subtitle: z.string(),
    plans: z.array(z.string()),
    highlight: z.string(),
    badge: z.string(),
    trial: z.string(),
    cta: z.string(),
  })
  .partial()

/** signet-db refuses a product, plan or placement that does not check out: a 400. */
const invalid = (e: unknown): never => {
  if (e instanceof Error && e.name === "SignetDbError")
    throw new ApiException(400, e.message, "VALIDATION_FAILED")
  throw e
}

/**
 * Publishing, for platform admins and staff. A publish is a new version; a
 * published version never changes, so the admin panel only reads these tables.
 *
 *   POST /offerings/:key          { products, paywall?, note? }   the next version
 *   PUT  /placements/:placement   { offering, version?, overrides? }
 */
export const paywallAdminRoutes = (s: Services) =>
  new Hono<AppEnv>()
    .use(async (c, next) => {
      const { role } = c.get("user")
      if (role !== "admin" && role !== "staff")
        throw new ApiException(403, "Admins only.", "FORBIDDEN")
      await next()
    })
    .post(
      "/offerings/:key",
      zValidator(
        "json",
        z.object({
          products: z.array(product),
          paywall: paywall.nullish(),
          note: z.string().optional(),
        }),
      ),
      async (c) => {
        const actor = { type: "user" as const, id: c.get("user").id }
        const offering = await s.offerings
          .publish(c.req.param("key"), c.req.valid("json"), { actor })
          .catch(invalid)
        return c.json({ offering }, 201)
      },
    )
    .put(
      "/placements/:placement",
      zValidator(
        "json",
        z.object({
          offering: z.string(),
          version: z.number().int().nullish(),
          /** [{ when: { country?, platform?, attributes? }, offering, version? }], first match wins. */
          overrides: z.array(z.any()).optional(),
        }),
      ),
      async (c) => {
        const actor = { type: "user" as const, id: c.get("user").id }
        const placement = await s.offerings
          .setPlacement(c.req.param("placement"), c.req.valid("json"), { actor })
          .catch(invalid)
        return c.json({ placement })
      },
    )
// admin:end
