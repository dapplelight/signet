import { createCurrencyFormatter } from "@dapplelight/signet-lib/format"
import { Badge } from "@dapplelight/signet-ui/components/badge"
import { Button } from "@dapplelight/signet-ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@dapplelight/signet-ui/components/card"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import { api } from "../../lib/api"

export const Route = createFileRoute("/_app/billing")({
  component: Billing,
})

const inr = createCurrencyFormatter("INR", "en-IN", { minorUnits: true })

// Plans come from api/services.ts (definePlans + PLAN_DISPLAY); the current
// plan from signet-db entitlements. With BILLING=fake, Upgrade switches at once.
// TODO(billing-screen): replace the cards with `BillingScreen` / `Paywall`
// from "@dapplelight/signet-ui/screens/billing-screens" once that screen is
// published, fed by `plansFromEntitlements(plans, PLAN_DISPLAY)`.
function Billing() {
  const qc = useQueryClient()
  const data = useQuery({
    queryKey: ["billing"],
    queryFn: async () => (await api.billing.$get()).json(),
  }).data
  if (!data) return null

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">Plans</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {data.plans.map((plan) => {
          const current = plan.id === data.current.plan
          return (
            <Card key={plan.id} data-current={current || undefined}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {plan.name}
                  {current ? <Badge>Current</Badge> : null}
                </CardTitle>
                <CardDescription>{plan.blurb}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-2xl font-semibold">
                  {plan.price ? `${inr(plan.price)} / month` : "Free"}
                </p>
                {current ? null : (
                  <Button
                    className="w-full"
                    onClick={async () => {
                      await api.billing.checkout.$post({ json: { plan: plan.id } })
                      await qc.invalidateQueries()
                      toast.success(`You are on ${plan.name}`)
                    }}
                  >
                    {plan.price ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
