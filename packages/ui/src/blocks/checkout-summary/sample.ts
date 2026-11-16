import type { CheckoutItem } from "./index.js"

/** Generic cart lines, amounts in minor units (cents). Pass your own `items`. */
export const SAMPLE_ITEMS: CheckoutItem[] = [
  { id: "team", name: "Team plan", description: "Billed monthly", amount: 1900 },
  { id: "seats", name: "Extra seat", description: "Per member", amount: 500, quantity: 3 },
  { id: "support", name: "Priority support", amount: 900 },
]
