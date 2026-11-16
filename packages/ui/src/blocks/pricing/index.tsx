"use client"

// Block: pricing table. Plans come from props and render as Cards in a grid
// (one column on a phone, up to three at lg), each with name, price, features
// and a call to action. The `highlighted` plan gets a primary ring and a "Most
// popular" badge. When any plan has a yearly price a Monthly / Yearly toggle
// appears. Prices are minor units (cents, paise) shown by `formatMoney`. No
// payment logic here: `onSelect` is where you start checkout. Copy it in with
// `signet add block pricing` and edit it.
import { CheckIcon } from "lucide-react"
import * as React from "react"
import { formatMoney } from "../../components/screens/billing-screens.js"
import { Badge } from "../../components/ui/badge.js"
import { Button } from "../../components/ui/button.js"
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "../../components/ui/card.js"
import { EmptyState } from "../../components/ui/empty-state.js"
import { ErrorState } from "../../components/ui/error-state.js"
import { Skeleton } from "../../components/ui/skeleton.js"
import { Spinner } from "../../components/ui/spinner.js"
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs.js"
import { cn } from "../../lib/utils.js"
import { SAMPLE_PLANS } from "./sample.js"

export type BlockState = "ready" | "loading" | "error"
export type PricingInterval = "month" | "year"

export type PricingPlan = {
  id: string
  name: string
  description?: string
  /** Minor units per interval. A plan with no `year` shows twelve months. */
  price: { month: number; year?: number }
  features: readonly string[]
  /** The button text. Default "Choose {name}". */
  cta?: string
  highlighted?: boolean
  /** Replaces "Most popular" on a highlighted plan. */
  badge?: string
}

/** Every string the block shows. Spread it and override what you need. */
export const DEFAULT_PRICING_LABELS = {
  monthly: "Monthly",
  yearly: "Yearly",
  interval: "Billing period",
  perMonth: "/month",
  perYear: "/year",
  perMonthSr: "per month",
  perYearSr: "per year",
  mostPopular: "Most popular",
  choose: (plan: string) => `Choose ${plan}`,
  emptyTitle: "No plans available",
  emptyDescription: "Check back soon.",
  error: "Something went wrong. Try again.",
  errorMessage: "We could not load the plans.",
  loading: "Loading plans",
}

export type PricingLabels = typeof DEFAULT_PRICING_LABELS

type Part = "toggle" | "grid" | "plan" | "price" | "features" | "cta"

export type PricingProps = {
  plans?: readonly PricingPlan[]
  /** ISO 4217 code for every price. Default "USD". */
  currency?: string
  /** Selected interval, controlled. */
  interval?: PricingInterval
  defaultInterval?: PricingInterval
  onIntervalChange?: (interval: PricingInterval) => void
  /** A plan's button. May be async: it shows a spinner and a thrown message shows under the grid. */
  onSelect?: (plan: PricingPlan, interval: PricingInterval) => void | Promise<void>
  state?: BlockState
  onRetry?: () => void
  labels?: Partial<PricingLabels>
  classNames?: Partial<Record<Part, string>>
  className?: string
}

export function Pricing({
  plans = SAMPLE_PLANS,
  currency = "USD",
  interval: intervalProp,
  defaultInterval = "month",
  onIntervalChange,
  onSelect,
  state = "ready",
  onRetry,
  labels: labelOverrides,
  classNames,
  className,
}: PricingProps) {
  const l = { ...DEFAULT_PRICING_LABELS, ...labelOverrides }
  const [own, setOwn] = React.useState(defaultInterval)
  const interval = intervalProp ?? own
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const yearly = plans.some((p) => p.price.year != null)

  const choose = async (plan: PricingPlan) => {
    setBusy(plan.id)
    setError(null)
    try {
      await onSelect?.(plan, interval)
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : l.error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      data-block="pricing"
      data-state={state}
      aria-busy={state === "loading" || undefined}
      className={cn("mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6", className)}
    >
      {state === "error" ? (
        <Card data-slot="pricing-error">
          <CardContent>
            <ErrorState message={l.errorMessage} onRetry={onRetry} />
          </CardContent>
        </Card>
      ) : state === "loading" ? (
        <PricingSkeleton label={l.loading} />
      ) : plans.length === 0 ? (
        <EmptyState title={l.emptyTitle} description={l.emptyDescription} />
      ) : (
        <>
          {yearly ? (
            <Tabs
              data-slot="pricing-toggle"
              value={interval}
              onValueChange={(v) => {
                setOwn(v as PricingInterval)
                onIntervalChange?.(v as PricingInterval)
              }}
              className={cn("items-center", classNames?.toggle)}
            >
              <TabsList aria-label={l.interval} className="h-11 w-full max-w-xs md:h-8">
                {(["month", "year"] as const).map((i) => (
                  <TabsTrigger
                    key={i}
                    value={i}
                    // The stock inactive tint misses 4.5:1 on some themes.
                    className="text-text-secondary dark:text-text-secondary"
                  >
                    {i === "month" ? l.monthly : l.yearly}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
          <div
            data-slot="pricing-grid"
            className={cn("grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3", classNames?.grid)}
          >
            {plans.map((plan) => {
              const amount = plan.price[interval] ?? plan.price.month * (interval === "year" ? 12 : 1)
              return (
                <Card
                  key={plan.id}
                  data-slot="pricing-plan"
                  data-plan={plan.id}
                  data-highlighted={plan.highlighted ? "" : undefined}
                  className={cn(plan.highlighted && "ring-2 ring-primary", classNames?.plan)}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <h2 title={plan.name} className="truncate text-base font-medium">
                        {plan.name}
                      </h2>
                      {plan.highlighted ? <Badge>{plan.badge ?? l.mostPopular}</Badge> : null}
                    </div>
                    {plan.description ? (
                      <CardDescription className="truncate" title={plan.description}>
                        {plan.description}
                      </CardDescription>
                    ) : null}
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-4">
                    <p
                      data-slot="pricing-price"
                      className={cn("flex items-baseline gap-1", classNames?.price)}
                    >
                      <span className="text-3xl font-semibold tabular-nums">
                        {formatMoney(amount, currency)}
                      </span>
                      <span aria-hidden="true" className="text-text-muted">
                        {interval === "year" ? l.perYear : l.perMonth}
                      </span>
                      <span className="sr-only">
                        {interval === "year" ? l.perYearSr : l.perMonthSr}
                      </span>
                    </p>
                    <ul data-slot="pricing-features" className={cn("grid gap-2", classNames?.features)}>
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                          <span className="min-w-0 break-words" title={f}>
                            {f}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    <Button
                      type="button"
                      data-slot="pricing-cta"
                      variant={plan.highlighted ? "default" : "outline"}
                      size="touch"
                      className={cn("w-full md:h-8", classNames?.cta)}
                      disabled={busy !== null}
                      onClick={() => choose(plan)}
                    >
                      {busy === plan.id && <Spinner className="text-current" aria-hidden="true" />}
                      {plan.cta ?? l.choose(plan.name)}
                    </Button>
                  </CardFooter>
                </Card>
              )
            })}
          </div>
          <p role="alert" className="text-center text-sm text-destructive empty:hidden">
            {error}
          </p>
        </>
      )}
    </section>
  )
}

/** Three plan cards: a name, a price, four feature rows and a button. */
function PricingSkeleton({ label }: { label: string }) {
  return (
    <div
      data-slot="pricing-skeleton"
      role="status"
      aria-label={label}
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: 3 }, (_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-28" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-8 w-32" />
            {Array.from({ length: 4 }, (_, j) => (
              <Skeleton key={j} className="h-4 w-full" />
            ))}
          </CardContent>
          <CardFooter>
            <Skeleton className="h-11 w-full md:h-8" />
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
