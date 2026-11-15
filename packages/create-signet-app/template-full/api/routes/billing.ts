import { ApiException } from "@dapplelight/signet-server/http"
import { zValidator } from "@dapplelight/signet-server/http/validate"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../app.ts"
import { env } from "../env.ts"
import { PLAN_DISPLAY, type PlanId, plans, type Services } from "../services.ts"

const PLAN_IDS = Object.keys(plans) as [PlanId, ...PlanId[]]

/**
 * Plans and the signed-in user's entitlement (signet-db entitlements).
 *
 *   GET  /            { plans, current: { plan, status, currentPeriodEnd, features, limits }, usage }
 *   POST /checkout    { plan }   BILLING=fake: switches now. BILLING=razorpay: see README.
 */
export const billingRoutes = (s: Services) =>
  new Hono<AppEnv>()
    .get("/", async (c) => {
      const id = c.get("user").id
      const current = await s.entitlements.get(id)
      return c.json({
        plans: PLAN_IDS.map((plan) => ({
          id: plan,
          ...PLAN_DISPLAY[plan],
          features: [...(plans[plan].features ?? [])],
          limits: plans[plan].limits,
        })),
        current: {
          plan: current.plan,
          status: current.status,
          currentPeriodEnd: current.currentPeriodEnd,
          features: current.features,
          limits: current.limits,
        },
        usage: await s.entitlements.usage(id),
      })
    })
    .post("/checkout", zValidator("json", z.object({ plan: z.enum(PLAN_IDS) })), async (c) => {
      const user = c.get("user")
      const { plan } = c.req.valid("json")
      if (env.BILLING !== "fake")
        // TODO(billing): create the gateway subscription here and return its
        // checkout for the browser (README, "Taking real payments"). The
        // webhook at /api/billing/webhooks/razorpay then moves the plan.
        throw new ApiException(409, "Real checkout is not wired yet.", "NOT_IMPLEMENTED")
      await s.entitlements.setPlan(user.id, plan, { actor: { type: "user", id: user.id } })
      await s.notifier.notify(user.id, "billing.plan_changed", { plan: PLAN_DISPLAY[plan].name })
      return c.json({ plan })
    })

/** Gateway webhooks: verified, deduped and applied by signet-payments. No session. */
export const billingWebhooks = (s: Services) =>
  new Hono<AppEnv>().post("/:gateway", (c) =>
    s.payments.handleWebhook(c.req.param("gateway"), c.req.raw),
  )
