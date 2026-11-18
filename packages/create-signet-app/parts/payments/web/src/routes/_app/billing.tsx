import {
  BillingScreen,
  plansFromEntitlements,
} from "@dapplelight/signet-ui/screens/billing-screens"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import { PLAN_DISPLAY, type PlanId, plans } from "../../../api/plans.ts" // @api
import { api } from "../../lib/api"
import { PLAN_DISPLAY, type PlanId, plans } from "../../lib/plans.ts" // @!api

export const Route = createFileRoute("/_app/billing")({
  component: Billing,
})

// What each plan allows (definePlans) plus what the page shows (PLAN_DISPLAY),
// both from api/plans.ts. The current plan and usage come from the API, from // @api
// signet-db entitlements. With BILLING=fake, checkout switches at once. // @api
// both from src/lib/plans.ts, a copy of your API's. The current plan and usage // @!api
// come from the API. // @!api
const PLANS = plansFromEntitlements(plans, PLAN_DISPLAY)

function Billing() {
  const qc = useQueryClient()
  const data = useQuery({
    queryKey: ["billing"],
    queryFn: async () => (await api.billing.$get()).json(),
  }).data
  if (!data) return null

  return (
    <BillingScreen
      plans={PLANS}
      subscription={data.subscription}
      usage={data.usage}
      onSubscribe={async (plan) => {
        await api.billing.checkout.$post({ json: { plan: plan.key as PlanId } })
        await qc.invalidateQueries()
        toast.success(`You are on ${plan.name}`)
      }}
    />
  )
}
