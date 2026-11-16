"use client"

// Block: checkout summary. A Card with the cart's line items, then Subtotal,
// Discount, Tax and Total, and a "Pay {total}" button. Amounts are minor units
// (cents, paise) and go through `formatMoney`; Discount and Tax rows show only
// when they are not zero. There is no payment logic here: `onPay` is where you
// open your provider's checkout (it may be async: the button shows a spinner
// and a thrown message shows under it). Copy it in with `signet add block
// checkout-summary` and edit it.
import * as React from "react"
import { formatMoney } from "../../components/screens/billing-screens.js"
import { Button } from "../../components/ui/button.js"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../../components/ui/card.js"
import { EmptyState } from "../../components/ui/empty-state.js"
import { ErrorState } from "../../components/ui/error-state.js"
import { Skeleton } from "../../components/ui/skeleton.js"
import { Spinner } from "../../components/ui/spinner.js"
import { cn } from "../../lib/utils.js"
import { SAMPLE_ITEMS } from "./sample.js"

export type BlockState = "ready" | "loading" | "error"

export type CheckoutItem = {
  id: string
  name: string
  description?: string
  /** One unit, in minor units. */
  amount: number
  /** Default 1. */
  quantity?: number
}

/** Every string the block shows. Spread it and override what you need. */
export const DEFAULT_CHECKOUT_LABELS = {
  title: "Order summary",
  items: "Items",
  subtotal: "Subtotal",
  discount: "Discount",
  tax: "Tax",
  total: "Total",
  quantity: (n: number) => `Qty ${n}`,
  pay: (total: string) => `Pay ${total}`,
  emptyTitle: "Your cart is empty",
  emptyDescription: "Add something to check out.",
  error: "Something went wrong. Try again.",
  errorMessage: "We could not load your order.",
  loading: "Loading order",
}

export type CheckoutLabels = typeof DEFAULT_CHECKOUT_LABELS

type Part = "items" | "item" | "totals" | "total" | "pay"

export type CheckoutSummaryProps = {
  items?: readonly CheckoutItem[]
  /** ISO 4217 code for every amount. Default "USD". */
  currency?: string
  /** Minor units taken off, a positive number. */
  discount?: number
  /** Minor units added. */
  tax?: number
  onPay?: (total: number) => void | Promise<void>
  state?: BlockState
  onRetry?: () => void
  labels?: Partial<CheckoutLabels>
  classNames?: Partial<Record<Part, string>>
  className?: string
}

/** The total the buyer pays, in minor units. */
export function checkoutTotal(items: readonly CheckoutItem[], discount = 0, tax = 0): number {
  return items.reduce((sum, i) => sum + i.amount * (i.quantity ?? 1), 0) - discount + tax
}

export function CheckoutSummary({
  items = SAMPLE_ITEMS,
  currency = "USD",
  discount = 0,
  tax = 0,
  onPay,
  state = "ready",
  onRetry,
  labels: labelOverrides,
  classNames,
  className,
}: CheckoutSummaryProps) {
  const l = { ...DEFAULT_CHECKOUT_LABELS, ...labelOverrides }
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const money = (n: number) => formatMoney(n, currency)
  const total = checkoutTotal(items, discount, tax)
  const subtotal = checkoutTotal(items)

  const pay = async () => {
    setPending(true)
    setError(null)
    try {
      await onPay?.(total)
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : l.error)
    } finally {
      setPending(false)
    }
  }

  const row = "flex items-baseline justify-between gap-4"
  return (
    <section
      data-block="checkout-summary"
      data-state={state}
      aria-busy={state === "loading" || undefined}
      className={cn("mx-auto w-full max-w-7xl p-4 md:p-6", className)}
    >
      {state === "error" ? (
        <Card data-slot="checkout-error">
          <CardContent>
            <ErrorState message={l.errorMessage} onRetry={onRetry} />
          </CardContent>
        </Card>
      ) : state === "loading" ? (
        <CheckoutSkeleton label={l.loading} />
      ) : items.length === 0 ? (
        <EmptyState title={l.emptyTitle} description={l.emptyDescription} />
      ) : (
        <Card data-slot="checkout-card" className="mx-auto max-w-lg">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-medium">{l.title}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul
              data-slot="checkout-items"
              aria-label={l.items}
              className={cn("grid gap-3", classNames?.items)}
            >
              {items.map((item) => {
                const qty = item.quantity ?? 1
                return (
                  <li key={item.id} data-slot="checkout-item" className={cn(row, classNames?.item)}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium" title={item.name}>
                        {item.name}
                      </span>
                      {item.description || qty > 1 ? (
                        <span className="block truncate text-text-muted" title={item.description}>
                          {[item.description, qty > 1 ? l.quantity(qty) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums">{money(item.amount * qty)}</span>
                  </li>
                )
              })}
            </ul>
            <dl
              data-slot="checkout-totals"
              className={cn("grid gap-2 border-t border-border-default pt-4", classNames?.totals)}
            >
              <div className={row}>
                <dt className="text-text-secondary">{l.subtotal}</dt>
                <dd className="tabular-nums">{money(subtotal)}</dd>
              </div>
              {discount ? (
                <div className={row}>
                  <dt className="text-text-secondary">{l.discount}</dt>
                  <dd className="tabular-nums">−{money(discount)}</dd>
                </div>
              ) : null}
              {tax ? (
                <div className={row}>
                  <dt className="text-text-secondary">{l.tax}</dt>
                  <dd className="tabular-nums">{money(tax)}</dd>
                </div>
              ) : null}
              <div data-slot="checkout-total" className={cn(row, "font-bold", classNames?.total)}>
                <dt>{l.total}</dt>
                <dd className="text-base tabular-nums">{money(total)}</dd>
              </div>
            </dl>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-2">
            <Button
              type="button"
              data-slot="checkout-pay"
              size="touch"
              className={cn("w-full md:h-8", classNames?.pay)}
              disabled={pending}
              onClick={pay}
            >
              {pending && <Spinner className="text-current" aria-hidden="true" />}
              {l.pay(money(total))}
            </Button>
            <p role="alert" className="text-center text-sm text-destructive empty:hidden">
              {error}
            </p>
          </CardFooter>
        </Card>
      )}
    </section>
  )
}

/** The card's shape: a heading, three item rows, the totals and the button. */
function CheckoutSkeleton({ label }: { label: string }) {
  return (
    <Card
      data-slot="checkout-skeleton"
      role="status"
      aria-label={label}
      className="mx-auto max-w-lg"
    >
      <CardHeader>
        <Skeleton className="h-5 w-36" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
        <Skeleton className="h-16 w-full" />
      </CardContent>
      <CardFooter>
        <Skeleton className="h-11 w-full md:h-8" />
      </CardFooter>
    </Card>
  )
}
