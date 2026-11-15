"use client"

// Billing screens on signet-db entitlements and signet-payments: a plan
// picker / paywall (web and store plans), the current plan with its period
// end and source, restore purchases for App Store and Google Play, usage
// meters, invoices (each links to its GST HTML invoice) and a wallet balance.
// Data comes in as props, shaped like signet-db's `Resolved` and `Usage`;
// actions go out as callbacks, so any client (createRpcClient, fetch) fits.
// `BillingScreen` and `Paywall` are ready screens; every part is exported.
// Recipe: selection + roving-focus + controllable-state + live-region
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import {
  ArrowUpRight,
  Check,
  CreditCard,
  FileText,
  Globe,
  RotateCcw,
  Smartphone,
  Sparkles,
  Wallet,
} from "lucide-react"
import * as React from "react"
import { useControllableState } from "../../behaviors/index.js"
import { cn } from "../../lib/utils.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import { Progress } from "../ui/progress.js"
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js"

// ---------------------------------------------------------------- data model

/** Where a subscription is bought: signet-payments gateway names ("appstore", "googleplay") or "web". */
export type BillingSource = "web" | "appstore" | "googleplay" | (string & {})
export type BillingInterval = "month" | "year" | "once"
/** An amount in minor units (paise, cents), as signet-payments stores it. */
export type BillingPrice = { amount: number; currency: string }

export type BillingPlan = {
  /** The plan key from `definePlans`. */
  key: string
  name: string
  description?: string
  /** Feature keys from the plan definition; `labels.feature` names them. */
  features?: readonly string[]
  /** Limits from the plan definition; `Infinity` is unlimited. */
  /** `null` (how JSON carries `Infinity`) is unlimited too. */
  limits?: Readonly<Record<string, number | null>>
  prices?: Partial<Record<BillingInterval, BillingPrice>>
  /** A short tag on the card, like "Popular". */
  badge?: string
  /** Where it can be bought. Default: everywhere. */
  sources?: readonly BillingSource[]
}

/** signet-db `SubscriptionStatus`. */
export type BillingStatus =
  | "pending"
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "cancelled"
  | "expired"

/** The fields of signet-db's `Resolved` the screens read; pass `ent.resolve(subject)` as it is. */
export type BillingSubscription = {
  plan: string
  status: BillingStatus | null
  currentPeriodEnd: Date | string | null
  graceUntil?: Date | string | null
  source: { gateway: string; subscriptionId?: string } | null
}

/** signet-db `Usage`. */
export type BillingUsage = {
  key: string
  period: string
  used: number
  limit: number
  remaining: number
}

export type BillingInvoice = {
  id: string
  /** The GST invoice number. */
  number: string
  date: Date | string
  /** Total in minor units. */
  total: number
  currency: string
  status?: "paid" | "due" | "refunded" | "void"
  /** Where the invoice's HTML (signet-payments `renderGstInvoiceHtml`) is served. */
  href: string
}

type PlanDefLike = {
  readonly features?: readonly string[]
  readonly limits?: Readonly<Record<string, number | null>>
}

/**
 * Billing plans from signet-db's `definePlans` object plus what only the app
 * knows (names, prices, store availability), in declaration order.
 */
export function plansFromEntitlements(
  plans: Readonly<Record<string, PlanDefLike>>,
  display: Readonly<
    Record<string, Omit<BillingPlan, "key" | "features" | "limits"> & Partial<BillingPlan>>
  >,
): BillingPlan[] {
  return Object.entries(plans).map(([key, def]) => ({
    key,
    ...(def.features ? { features: def.features } : {}),
    ...(def.limits ? { limits: def.limits } : {}),
    ...display[key],
    name: display[key]?.name ?? key,
  }))
}

// -------------------------------------------------------------------- labels

const humanize = (key: string) => {
  const w = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
  return w.charAt(0).toUpperCase() + w.slice(1)
}

const toDate = (d: Date | string | null | undefined) => (d ? new Date(d) : null)
const dateText = (d: Date) => d.toLocaleDateString(undefined, { dateStyle: "medium" })

/** Every string the billing screens show, in English. Spread and override for another language. */
export const DEFAULT_BILLING_LABELS = {
  plans: "Plans",
  billingInterval: "Billing period",
  interval: { month: "Monthly", year: "Yearly", once: "One-time" } as Record<
    BillingInterval,
    string
  >,
  per: { month: "/mo", year: "/yr", once: "" } as Record<BillingInterval, string>,
  save: (percent: number) => `Save ${percent}%`,
  free: "Free",
  feature: (key: string) => humanize(key),
  limit: (key: string, n: number | null) =>
    n == null || n === Number.POSITIVE_INFINITY
      ? `Unlimited ${humanize(key).toLowerCase()}`
      : `${n.toLocaleString()} ${humanize(key).toLowerCase()}`,
  current: "Current",
  currentPlan: "Current plan",
  choose: (plan: string) => `Continue with ${plan}`,
  subscribing: "Opening checkout…",
  paywallTitle: "Upgrade",
  paywallSubtitle: "",
  status: {
    pending: "Pending",
    trialing: "Trial",
    active: "Active",
    past_due: "Payment due",
    paused: "Paused",
    cancelled: "Cancelled",
    expired: "Expired",
  } as Record<BillingStatus, string>,
  renews: (d: Date) => `Renews ${dateText(d)}`,
  ends: (d: Date) => `Ends ${dateText(d)}`,
  graceUntil: (d: Date) => `Fix payment by ${dateText(d)}`,
  noPeriod: "No renewal date",
  source: {
    web: "Web",
    appstore: "App Store",
    googleplay: "Google Play",
  } as Record<string, string>,
  manage: "Manage",
  restore: "Restore purchases",
  restoring: "Restoring…",
  restored: "Purchases restored",
  restoreFailed: "Nothing to restore",
  usage: "Usage",
  usageOf: (used: number, limit: number | null) =>
    limit == null || limit === Number.POSITIVE_INFINITY
      ? `${used.toLocaleString()}`
      : `${used.toLocaleString()} / ${limit.toLocaleString()}`,
  unlimited: "Unlimited",
  period: (period: string) => (period === "total" ? "" : period),
  invoices: "Invoices",
  noInvoices: "No invoices yet",
  invoiceStatus: { paid: "Paid", due: "Due", refunded: "Refunded", void: "Void" } as Record<
    string,
    string
  >,
  viewInvoice: "View invoice",
  wallet: "Wallet",
  topUp: "Add money",
}

export type BillingLabels = typeof DEFAULT_BILLING_LABELS

function useLabels(labels?: Partial<BillingLabels>): BillingLabels {
  return React.useMemo(() => ({ ...DEFAULT_BILLING_LABELS, ...labels }), [labels])
}

// ----------------------------------------------------------------- helpers

const digits = (currency: string) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits as number
  } catch {
    return 2
  }
}

/** Minor units to a localised amount: 49900 INR -> ₹499. Whole amounts drop the decimals. */
export function formatMoney(amount: number, currency: string): string {
  const value = amount / 10 ** digits(currency)
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    ...(Number.isInteger(value) ? { maximumFractionDigits: 0 } : {}),
  }).format(value)
}

type PartProps<T extends keyof React.JSX.IntrinsicElements> = useRender.ComponentProps<T>

/** One part element: `render` swaps it, `className` merges over the defaults, `state` becomes `data-*`. */
function usePart<T extends keyof React.JSX.IntrinsicElements>(
  tag: T,
  slot: string,
  base: string,
  { className, render, ...props }: PartProps<T>,
  extra: Record<string, unknown> = {},
  state: Record<string, unknown> = {},
) {
  return useRender({
    defaultTagName: tag,
    render: render as useRender.RenderProp,
    state: { slot, ...state },
    props: mergeProps<"div">(
      { ...extra, className: cn(base, className as string) } as never,
      props as never,
    ),
  })
}

/** No paid price for any interval: shown as Free in every interval. */
const isFree = (p: BillingPlan) =>
  !Object.values(p.prices ?? {}).some((price) => (price?.amount ?? 0) > 0)

const isStore = (s: BillingSource | undefined | null) => s === "appstore" || s === "googleplay"

function SourceIcon({ source, className }: { source: string; className?: string }) {
  const Icon = isStore(source) ? Smartphone : source === "web" ? Globe : CreditCard
  return <Icon className={cn("size-3.5", className)} aria-hidden />
}

// --------------------------------------------------------------- plan picker

export type PlanPickerProps = Omit<PartProps<"div">, "defaultValue" | "onChange"> & {
  plans: readonly BillingPlan[]
  /** Selected plan key (controlled). */
  value?: string
  defaultValue?: string
  onValueChange?: (plan: string) => void
  interval?: BillingInterval
  defaultInterval?: BillingInterval
  onIntervalChange?: (interval: BillingInterval) => void
  /** The subscriber's plan key: marked, and its button is disabled. */
  currentPlan?: string
  /** Where this purchase happens. Plans not sold there are hidden. Default "web". */
  source?: BillingSource
  /** Start checkout or the store purchase. A returned Promise keeps the button pending. */
  onSubscribe?: (plan: BillingPlan, interval: BillingInterval) => unknown
  labels?: Partial<BillingLabels>
  classNames?: Partial<
    Record<"intervals" | "plans" | "plan" | "price" | "features" | "cta", string>
  >
}

/** Plan cards as one radio group (arrow keys move), an interval switch, and the continue button. */
export function PlanPicker({
  plans,
  value,
  defaultValue,
  onValueChange,
  interval: intervalProp,
  defaultInterval,
  onIntervalChange,
  currentPlan,
  source = "web",
  onSubscribe,
  labels: labelsProp,
  classNames = {},
  ...props
}: PlanPickerProps) {
  const labels = useLabels(labelsProp)
  const shown = plans.filter((p) => !p.sources || p.sources.includes(source))
  const intervals = (["month", "year", "once"] as const).filter((i) =>
    shown.some((p) => p.prices?.[i]),
  )
  const [interval, setInterval] = useControllableState<BillingInterval>({
    value: intervalProp,
    defaultValue: defaultInterval ?? intervals[0] ?? "month",
    onChange: onIntervalChange,
  })
  // Default selection: the first paid plan above the current one, else any paid plan that isn't current.
  const paid = (p: BillingPlan) => (p.prices?.[interval]?.amount ?? 0) > 0 && p.key !== currentPlan
  // A plan sold for money but not for this interval is left out of it.
  const visible = shown.filter((p) => isFree(p) || p.prices?.[interval])
  const currentIndex = visible.findIndex((p) => p.key === currentPlan)
  const firstPaid = visible.find((p, i) => i > currentIndex && paid(p)) ?? visible.find(paid)
  const [selected, setSelected] = useControllableState<string>({
    value,
    defaultValue: defaultValue ?? firstPaid?.key ?? visible[0]?.key ?? "",
    onChange: onValueChange,
  })
  const [pending, setPending] = React.useState(false)
  const groupLabel = React.useId()
  // A selection the interval doesn't sell falls back to a plan it does.
  const active = visible.some((p) => p.key === selected)
    ? selected
    : (firstPaid?.key ?? visible[0]?.key ?? "")
  const plan = visible.find((p) => p.key === active)

  // The largest yearly saving over twelve monthly payments, for the switch.
  const saving = Math.max(
    0,
    ...shown.map((p) => {
      const m = p.prices?.month?.amount
      const y = p.prices?.year?.amount
      return m && y ? Math.round((1 - y / (m * 12)) * 100) : 0
    }),
  )

  const subscribe = async () => {
    if (!plan || !onSubscribe || !(isFree(plan) || plan.prices?.[interval])) return
    setPending(true)
    try {
      await onSubscribe(plan, interval)
    } finally {
      setPending(false)
    }
  }

  const children = (
    <>
      {intervals.length > 1 && (
        <RadioGroup
          aria-label={labels.billingInterval}
          value={interval}
          onValueChange={(v: string | null) => v && setInterval(v as BillingInterval)}
          className={cn(
            "mx-auto flex w-fit gap-1 rounded-full bg-bg-elevated p-1",
            classNames.intervals,
          )}
        >
          {intervals.map((i) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: the radio (a button) is inside the label
            <label
              key={i}
              className="relative flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium text-text-secondary transition-colors has-data-checked:bg-bg-surface has-data-checked:text-text-primary has-data-checked:shadow-sm has-focus-visible:ring-3 has-focus-visible:ring-ring"
            >
              <RadioGroupItem value={i} className="sr-only" />
              {labels.interval[i]}
              {i === "year" && saving > 0 && (
                <span className="rounded-full bg-accent-green-subtle px-1.5 text-xs font-semibold text-text-primary">
                  {labels.save(saving)}
                </span>
              )}
            </label>
          ))}
        </RadioGroup>
      )}
      <span id={groupLabel} className="sr-only">
        {labels.plans}
      </span>
      <RadioGroup
        aria-labelledby={groupLabel}
        value={active}
        onValueChange={(v: string | null) => v && setSelected(v)}
        className={cn(
          "grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]",
          classNames.plans,
        )}
      >
        {visible.map((p) => {
          const price = p.prices?.[interval]
          const current = p.key === currentPlan
          return (
            // biome-ignore lint/a11y/noLabelWithoutControl: the radio (a button) is inside the label
            <label
              key={p.key}
              data-slot="plan-card"
              data-plan={p.key}
              data-current={current || undefined}
              data-featured={p.badge ? true : undefined}
              className={cn(
                "group/plan relative flex cursor-pointer flex-col gap-4 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default transition-shadow outline-none hover:ring-border-strong has-data-checked:ring-2 has-data-checked:ring-primary has-focus-visible:ring-3 has-focus-visible:ring-ring",
                classNames.plan,
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 text-base font-semibold text-text-primary">
                    {p.name}
                    {p.badge && (
                      <Badge className="gap-1">
                        <Sparkles aria-hidden />
                        {p.badge}
                      </Badge>
                    )}
                    {current && <Badge variant="secondary">{labels.current}</Badge>}
                  </span>
                  {p.description && (
                    <span className="text-sm text-text-muted">{p.description}</span>
                  )}
                </div>
                <RadioGroupItem value={p.key} className="mt-0.5 size-5" aria-label={p.name} />
              </div>
              <div className={cn("flex items-baseline gap-1", classNames.price)}>
                <span className="text-3xl font-semibold tracking-tight text-text-primary tabular-nums">
                  {price && price.amount > 0
                    ? formatMoney(price.amount, price.currency)
                    : labels.free}
                </span>
                {price && price.amount > 0 && (
                  <span className="text-sm text-text-muted">{labels.per[interval]}</span>
                )}
              </div>
              {(p.features?.length || p.limits) && (
                <ul className={cn("flex flex-col gap-2 text-sm", classNames.features)}>
                  {Object.entries(p.limits ?? {}).map(([k, n]) => (
                    <li key={`l:${k}`} className="flex items-start gap-2 text-text-secondary">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      {labels.limit(k, n)}
                    </li>
                  ))}
                  {p.features?.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-text-secondary">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      {labels.feature(f)}
                    </li>
                  ))}
                </ul>
              )}
            </label>
          )
        })}
      </RadioGroup>
      {onSubscribe && plan && (
        <Button
          size="lg"
          className={cn("h-11 w-full text-base sm:mx-auto sm:w-80", classNames.cta)}
          disabled={pending || plan.key === currentPlan}
          onClick={subscribe}
          data-pending={pending || undefined}
        >
          {plan.key === currentPlan
            ? labels.currentPlan
            : pending
              ? labels.subscribing
              : labels.choose(plan.name)}
        </Button>
      )}
    </>
  )
  return usePart(
    "div",
    "plan-picker",
    "flex flex-col gap-5",
    props,
    { children },
    {
      interval,
      source,
    },
  )
}

// ----------------------------------------------------------- restore button

export type RestorePurchasesButtonProps = Omit<React.ComponentProps<typeof Button>, "onClick"> & {
  /** Ask the store and re-apply its purchases (signet-payments `restorePurchases` + `applySubscription`). Resolve false when nothing was found. */
  onRestore: () => Promise<unknown> | unknown
  labels?: Partial<BillingLabels>
}

/** "Restore purchases", with the outcome announced politely. */
export function RestorePurchasesButton({
  onRestore,
  labels: labelsProp,
  className,
  ...props
}: RestorePurchasesButtonProps) {
  const labels = useLabels(labelsProp)
  const [state, setState] = React.useState<"idle" | "pending" | "done" | "failed">("idle")
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        data-state={state}
        disabled={state === "pending"}
        className={cn("[&[data-state=pending]_svg]:animate-spin", className)}
        onClick={async () => {
          setState("pending")
          try {
            setState((await onRestore()) === false ? "failed" : "done")
          } catch {
            setState("failed")
          }
        }}
        {...props}
      >
        <RotateCcw data-icon="inline-start" aria-hidden />
        {state === "pending" ? labels.restoring : labels.restore}
      </Button>
      <span role="status" className="text-xs text-text-muted">
        {state === "done" ? labels.restored : state === "failed" ? labels.restoreFailed : ""}
      </span>
    </span>
  )
}

// ------------------------------------------------------------- current plan

// Text stays text-primary on the tinted pill (coloured text on its own
// subtle tint misses 4.5:1 in some themes); the dot carries the colour.
const STATUS_TONE: Record<BillingStatus, string> = {
  active: "bg-accent-green-subtle [--dot:var(--color-accent-green)]",
  trialing: "bg-accent-blue-subtle [--dot:var(--color-accent-blue)]",
  pending: "bg-accent-amber-subtle [--dot:var(--color-accent-amber)]",
  past_due: "bg-accent-amber-subtle [--dot:var(--color-accent-amber)]",
  paused: "bg-bg-elevated [--dot:var(--color-text-muted)]",
  cancelled: "bg-accent-red-subtle [--dot:var(--color-accent-red)]",
  expired: "bg-accent-red-subtle [--dot:var(--color-accent-red)]",
}

export type CurrentPlanCardProps = PartProps<"section"> & {
  subscription: BillingSubscription
  plans?: readonly BillingPlan[]
  onManage?: () => void
  /** Shown when the subscription came from a store (or `source` is one). */
  onRestore?: RestorePurchasesButtonProps["onRestore"]
  /** Where the app runs; a store here shows Restore even without a subscription. */
  source?: BillingSource
  labels?: Partial<BillingLabels>
}

/** The plan, its status, when it renews or ends, and where it was bought. */
export function CurrentPlanCard({
  subscription,
  plans = [],
  onManage,
  onRestore,
  source,
  labels: labelsProp,
  ...props
}: CurrentPlanCardProps) {
  const labels = useLabels(labelsProp)
  const plan = plans.find((p) => p.key === subscription.plan)
  const end = toDate(subscription.currentPeriodEnd)
  const grace = toDate(subscription.graceUntil)
  const status = subscription.status
  const gateway = subscription.source?.gateway
  const ending = status === "cancelled" || status === "expired"
  const headingId = React.useId()
  const children = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span id={headingId} className="text-xs font-medium text-text-muted">
            {labels.currentPlan}
          </span>
          <span className="text-2xl font-semibold tracking-tight text-text-primary">
            {plan?.name ?? humanize(subscription.plan)}
          </span>
        </div>
        {status && (
          <span
            data-slot="plan-status"
            data-status={status}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-text-primary before:size-1.5 before:rounded-full before:bg-(--dot)",
              STATUS_TONE[status],
            )}
          >
            {labels.status[status]}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-secondary">
        {status === "past_due" && grace ? (
          <span className="text-accent-amber">{labels.graceUntil(grace)}</span>
        ) : end ? (
          <time dateTime={end.toISOString()}>{ending ? labels.ends(end) : labels.renews(end)}</time>
        ) : (
          subscription.source && <span>{labels.noPeriod}</span>
        )}
        {gateway && (
          <span
            data-slot="plan-source"
            data-source={gateway}
            className="inline-flex items-center gap-1.5"
          >
            <SourceIcon source={gateway} className="text-text-muted" />
            {labels.source[gateway] ?? humanize(gateway)}
          </span>
        )}
      </div>
      {(onManage || (onRestore && (isStore(gateway) || isStore(source)))) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
          {onManage && (
            <Button variant="outline" onClick={onManage}>
              {labels.manage}
              <ArrowUpRight data-icon="inline-end" aria-hidden />
            </Button>
          )}
          {onRestore && (isStore(gateway) || isStore(source)) && (
            <RestorePurchasesButton onRestore={onRestore} labels={labelsProp ?? {}} />
          )}
        </div>
      )}
    </>
  )
  return usePart(
    "section",
    "current-plan",
    "flex flex-col gap-4 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default",
    props,
    { "aria-labelledby": headingId, children },
    { status: status ?? "none" },
  )
}

// ------------------------------------------------------------------- usage

export type UsageMetersProps = PartProps<"section"> & {
  usage: readonly BillingUsage[]
  labels?: Partial<BillingLabels>
}

/** One bar per limit; it turns amber at 75% and red at 90%. */
export function UsageMeters({ usage, labels: labelsProp, ...props }: UsageMetersProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  const children = (
    <>
      <h2 id={headingId} className="text-xs font-medium text-text-muted">
        {labels.usage}
      </h2>
      <ul className="flex flex-col gap-4">
        {usage.map((u) => {
          // JSON turns Infinity into null: both mean unlimited.
          const limit = u.limit ?? Number.POSITIVE_INFINITY
          const unlimited = limit === Number.POSITIVE_INFINITY
          const pct = unlimited ? 0 : limit > 0 ? Math.min(100, (u.used / limit) * 100) : 100
          const level = unlimited ? "ok" : pct >= 90 ? "critical" : pct >= 75 ? "warning" : "ok"
          const name = labels.feature(u.key)
          return (
            <li
              key={u.key}
              data-slot="usage-meter"
              data-level={level}
              className="group/meter flex flex-col gap-1.5"
            >
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-text-primary">{name}</span>
                <span className="text-text-muted tabular-nums">
                  {labels.usageOf(u.used, limit)}
                  {unlimited && <span className="ml-1">· {labels.unlimited}</span>}
                </span>
              </div>
              <Progress
                value={unlimited ? null : pct}
                aria-label={name}
                aria-valuetext={labels.usageOf(u.used, limit)}
                className="[&_[data-slot=progress-indicator]]:transition-all group-data-[level=critical]/meter:[&_[data-slot=progress-indicator]]:bg-accent-red group-data-[level=warning]/meter:[&_[data-slot=progress-indicator]]:bg-accent-amber [&_[data-slot=progress-track]]:h-1.5"
              />
            </li>
          )
        })}
      </ul>
    </>
  )
  return usePart(
    "section",
    "usage-meters",
    "flex flex-col gap-4 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default",
    props,
    { "aria-labelledby": headingId, children },
  )
}

// ---------------------------------------------------------------- invoices

export type InvoiceListProps = PartProps<"section"> & {
  invoices: readonly BillingInvoice[]
  labels?: Partial<BillingLabels>
}

const INVOICE_TONE: Record<string, "secondary" | "destructive" | "outline"> = {
  paid: "secondary",
  due: "destructive",
  refunded: "outline",
  void: "outline",
}

/** Invoices newest first; each opens its GST HTML invoice in a new tab. */
export function InvoiceList({ invoices, labels: labelsProp, ...props }: InvoiceListProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  const children = (
    <>
      <h2 id={headingId} className="px-5 pt-5 text-xs font-medium text-text-muted">
        {labels.invoices}
      </h2>
      {invoices.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 pt-4 pb-8 text-sm text-text-muted">
          <FileText className="size-5" aria-hidden />
          {labels.noInvoices}
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle pb-2">
          {invoices.map((inv) => {
            const d = new Date(inv.date)
            return (
              <li key={inv.id} data-slot="invoice" data-status={inv.status}>
                <a
                  href={inv.href}
                  target="_blank"
                  rel="noreferrer"
                  className="group/invoice flex items-center gap-3 px-5 py-3 outline-none transition-colors hover:bg-bg-elevated/60 focus-visible:bg-bg-elevated focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <span className="sr-only">{labels.viewInvoice}</span>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-text-muted">
                    <FileText className="size-4" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <time dateTime={d.toISOString()} className="text-sm text-text-primary">
                      {dateText(d)}
                    </time>
                    <span className="truncate font-mono text-xs text-text-muted">{inv.number}</span>
                  </span>
                  {inv.status && (
                    <Badge variant={INVOICE_TONE[inv.status] ?? "outline"}>
                      {labels.invoiceStatus[inv.status] ?? inv.status}
                    </Badge>
                  )}
                  <span className="text-sm font-medium text-text-primary tabular-nums">
                    {formatMoney(inv.total, inv.currency)}
                  </span>
                  <ArrowUpRight
                    className="size-4 text-text-hint transition-colors group-hover/invoice:text-text-primary"
                    aria-hidden
                  />
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
  return usePart(
    "section",
    "invoice-list",
    "flex flex-col gap-2 rounded-xl bg-bg-surface ring-1 ring-border-default",
    props,
    { "aria-labelledby": headingId, children },
  )
}

// ------------------------------------------------------------------ wallet

export type WalletCardProps = PartProps<"section"> & {
  /** Minor units, e.g. signet-payments ledger `balance(store, account, currency)`. */
  balance: number
  currency: string
  onTopUp?: () => void
  labels?: Partial<BillingLabels>
}

/** The wallet's balance, large, with an optional top-up. */
export function WalletCard({
  balance,
  currency,
  onTopUp,
  labels: labelsProp,
  ...props
}: WalletCardProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  const children = (
    <>
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Wallet className="size-4" aria-hidden />
        </span>
        <h2 id={headingId} className="text-xs font-medium text-text-muted">
          {labels.wallet}
        </h2>
      </div>
      <p
        className="text-3xl font-semibold tracking-tight text-text-primary tabular-nums"
        data-slot="wallet-balance"
      >
        {formatMoney(balance, currency)}
      </p>
      {onTopUp && (
        <Button variant="secondary" onClick={onTopUp} className="self-start">
          {labels.topUp}
        </Button>
      )}
    </>
  )
  return usePart(
    "section",
    "wallet",
    "flex flex-col gap-3 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default",
    props,
    { "aria-labelledby": headingId, children },
    { negative: balance < 0 },
  )
}

// ----------------------------------------------------------------- screens

export type PaywallProps = PlanPickerProps & {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  /** For store builds: restore earlier purchases. */
  onRestore?: RestorePurchasesButtonProps["onRestore"]
}

/** A paywall: a headline, the plan picker and, in a store build, Restore. */
export function Paywall({
  title,
  subtitle,
  onRestore,
  className,
  labels: labelsProp,
  ...props
}: PaywallProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  return (
    <section
      data-slot="paywall"
      aria-labelledby={headingId}
      className={cn("mx-auto flex w-full max-w-4xl flex-col gap-6", className)}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <h2 id={headingId} className="text-2xl font-semibold tracking-tight text-text-primary">
          {title ?? labels.paywallTitle}
        </h2>
        {(subtitle ?? labels.paywallSubtitle) && (
          <p className="max-w-md text-sm text-text-muted">{subtitle ?? labels.paywallSubtitle}</p>
        )}
      </div>
      <PlanPicker {...props} labels={labelsProp ?? {}} />
      {onRestore && isStore(props.source) && (
        <div className="flex justify-center">
          <RestorePurchasesButton onRestore={onRestore} labels={labelsProp ?? {}} />
        </div>
      )}
    </section>
  )
}

export type BillingScreenProps = Omit<PartProps<"div">, "onChange"> & {
  plans: readonly BillingPlan[]
  subscription: BillingSubscription
  usage?: readonly BillingUsage[]
  invoices?: readonly BillingInvoice[]
  wallet?: { balance: number; currency: string; onTopUp?: () => void }
  source?: BillingSource
  onSubscribe?: PlanPickerProps["onSubscribe"]
  onManage?: () => void
  onRestore?: RestorePurchasesButtonProps["onRestore"]
  labels?: Partial<BillingLabels>
  classNames?: Partial<Record<"current" | "usage" | "wallet" | "plans" | "invoices", string>>
}

/**
 * The billing page, ready to drop in:
 *
 * ```tsx
 * <BillingScreen plans={plans} subscription={await ent.resolve(userId)}
 *   usage={await ent.usage(userId)} invoices={invoices} onSubscribe={checkout} />
 * ```
 */
export function BillingScreen({
  plans,
  subscription,
  usage,
  invoices,
  wallet,
  source = "web",
  onSubscribe,
  onManage,
  onRestore,
  labels,
  classNames = {},
  ...props
}: BillingScreenProps) {
  const l = useLabels(labels)
  const children = (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <CurrentPlanCard
          subscription={subscription}
          plans={plans}
          source={source}
          labels={labels ?? {}}
          className={classNames.current}
          {...(onManage ? { onManage } : {})}
          {...(onRestore ? { onRestore } : {})}
        />
        {wallet ? (
          <WalletCard {...wallet} labels={labels ?? {}} className={classNames.wallet} />
        ) : usage?.length ? (
          <UsageMeters usage={usage} labels={labels ?? {}} className={classNames.usage} />
        ) : null}
      </div>
      {wallet && usage?.length ? (
        <UsageMeters usage={usage} labels={labels ?? {}} className={classNames.usage} />
      ) : null}
      <section aria-label={l.plans} className="flex flex-col gap-3">
        <h2 className="text-xs font-medium text-text-muted">{l.plans}</h2>
        <PlanPicker
          plans={plans}
          currentPlan={subscription.plan}
          source={source}
          labels={labels ?? {}}
          className={classNames.plans}
          {...(onSubscribe ? { onSubscribe } : {})}
        />
      </section>
      {invoices && (
        <InvoiceList invoices={invoices} labels={labels ?? {}} className={classNames.invoices} />
      )}
    </>
  )
  return usePart("div", "billing-screen", "mx-auto flex w-full max-w-4xl flex-col gap-6", props, {
    children,
  })
}
