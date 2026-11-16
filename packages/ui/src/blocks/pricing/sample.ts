import type { PricingPlan } from "./index.js"

/** Generic plans, prices in minor units (cents). Pass your own `plans`. */
export const SAMPLE_PLANS: PricingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    description: "For trying things out.",
    price: { month: 0, year: 0 },
    features: ["1 project", "Community support", "Basic reports"],
    cta: "Get started",
  },
  {
    id: "team",
    name: "Team",
    description: "For small teams that ship every week.",
    price: { month: 1900, year: 19000 },
    features: ["Unlimited projects", "Priority support", "Advanced reports", "Shared workspaces"],
    cta: "Start free trial",
    highlighted: true,
  },
  {
    id: "scale",
    name: "Scale",
    description: "For larger organisations.",
    price: { month: 4900, year: 49000 },
    features: ["Everything in Team", "Single sign-on", "Audit log", "Dedicated support"],
    cta: "Contact sales",
  },
]
