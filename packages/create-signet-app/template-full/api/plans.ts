import { definePlans } from "@dapplelight/signet-db/entitlements"

// Shared by the API and the billing page, so keep it free of server code.

/** The plans. Declare lowest first; `free` is what everyone starts on. */
export const plans = definePlans({
  free: { features: [], limits: { projects: 3 } },
  pro: { features: ["export", "priority-support"], limits: { projects: 100 } },
})
export type PlanId = keyof typeof plans

/**
 * What the billing page shows for each plan, merged with `plans` by
 * `plansFromEntitlements`. Amounts in minor units (paise).
 */
export const PLAN_DISPLAY = {
  free: { name: "Free", description: "Three projects, to try it out" },
  pro: {
    name: "Pro",
    description: "A hundred projects, export, priority support",
    prices: { month: { amount: 49900, currency: "INR" } },
  },
} satisfies Record<PlanId, { name: string; description: string; prices?: object }>
