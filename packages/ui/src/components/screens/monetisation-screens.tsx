"use client"

// Monetisation screens on signet-db's offerings and customers: a remote
// paywall rendered from the server's offering (copy, plans shown, highlighted
// plan, trial text), the self-serve Customer Center (plan and renewal date,
// cancel with a retention offer first, store manage links, refund request,
// contact support) and the admin customer timeline across App Store, Google
// Play and web. Data comes in as props shaped like signet-db's results (or
// their JSON); actions go out as callbacks, so any client fits. They reuse the
// billing screens' parts (Paywall, CurrentPlanCard) and their labels.
// Recipe: selection + roving-focus + controllable-state + live-region
import {
  ArrowUpRight,
  CalendarClock,
  CircleAlert,
  CircleSlash,
  CreditCard,
  Gift,
  LifeBuoy,
  Pause,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  Undo2,
} from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Badge } from "../ui/badge.js"
import { Button, buttonVariants } from "../ui/button.js"
import { Textarea } from "../ui/textarea.js"
import {
  Timeline,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "../ui/timeline.js"
import {
  type BillingInterval,
  type BillingLabels,
  type BillingPlan,
  type BillingSource,
  type BillingStatus,
  CurrentPlanCard,
  DEFAULT_BILLING_LABELS,
  formatMoney,
  Paywall,
  type PaywallProps,
} from "./billing-screens.js"

// ---------------------------------------------------------------- data model

/** signet-db `ProductOffer`: a free trial, intro or win-back offer. */
export type RemoteOffer = {
  id: string
  type: "free_trial" | "intro" | "win_back"
  days?: number
  price?: { amount: number; currency: string }
}

/** signet-db `OfferingProduct`. */
export type RemoteProduct = {
  id: string
  store: BillingSource
  plan: string
  interval?: BillingInterval
  price?: { amount: number; currency: string }
  /** The offers this customer may take, best first (`customers.withOffers` on the server). */
  offers?: readonly RemoteOffer[]
}

/** signet-db `PaywallConfig`. */
export type RemotePaywallConfig = {
  title?: string
  subtitle?: string
  plans?: string[]
  highlight?: string
  badge?: string
  trial?: string
  cta?: string
}

/** signet-db `CurrentOffering`, or its JSON from `GET /offerings/:placement`. */
export type RemoteOffering = {
  key: string
  version: number
  products: readonly RemoteProduct[]
  paywall: RemotePaywallConfig | null
}

export type RetentionOfferView =
  | { kind: "discount"; percent: number; months: number }
  | { kind: "free_period"; days: number }

/** signet-db `Overview` (`customers.overview`), or its JSON. */
export type CustomerOverview = {
  plan: string
  status: string | null
  currentPeriodEnd: Date | string | null
  graceUntil?: Date | string | null
  renews: boolean
  source: { gateway: string; subscriptionId: string; productId?: string } | null
  store: boolean
  manageUrl: string | null
  canCancel: boolean
  retention: RetentionOfferView | null
}

/** signet-db `TimelineEntry`. */
export type CustomerTimelineEntry = {
  id: string
  kind: string
  gateway: string
  eventType: string
  subscriptionId?: string | null
  paymentId?: string | null
  productId?: string | null
  amount?: number | null
  currency?: string | null
  approximate?: boolean
  occurredAt: Date | string
}

export type CustomerTimelineTotal = {
  currency: string
  paid: number
  refunded: number
  approximate: boolean
}

// -------------------------------------------------------------------- labels

const dateText = (d: Date) => d.toLocaleDateString(undefined, { dateStyle: "medium" })

/** Every string the monetisation screens show, in English, on top of the billing labels. */
export const DEFAULT_MONETISATION_LABELS = {
  ...DEFAULT_BILLING_LABELS,
  highlight: "Best value",
  customerCenter: "Your subscription",
  cancel: "Cancel subscription",
  cancelling: "Cancelling…",
  cancelled: "Your subscription is cancelled. You keep access until the period ends.",
  cancelFailed: "Could not cancel. Try again, or contact support.",
  manageInStore: (store: string) => `Manage in ${store}`,
  storeCancelHint: (store: string) => `This subscription was bought in ${store}. Cancel it there.`,
  retentionTitle: "Before you go",
  retentionOffer: (o: RetentionOfferView) =>
    o.kind === "discount"
      ? `Stay and get ${o.percent}% off for ${o.months} ${o.months === 1 ? "month" : "months"}.`
      : `Stay and get ${o.days} days free.`,
  acceptOffer: "Accept offer",
  declineOffer: "No thanks, cancel",
  offerAccepted: "Offer applied. Thanks for staying.",
  refund: "Request a refund",
  refundReason: "What went wrong?",
  refundSubmit: "Send request",
  refundSent: "Request sent. We will reply by email.",
  support: "Contact support",
  supportMessage: "How can we help?",
  supportSubmit: "Send message",
  supportSent: "Message sent. We will get back to you.",
  sendFailed: "Could not send. Try again.",
  timeline: "Timeline",
  noEvents: "No billing events yet",
  totals: "Lifetime",
  paid: "Paid",
  refunded: "Refunded",
  approximate: "Includes App Store prices, not settled revenue",
  offer: (o: RemoteOffer) =>
    o.type === "free_trial"
      ? `Try it free for ${o.days} days`
      : `${o.type === "win_back" ? "Welcome back: " : ""}${o.price ? formatMoney(o.price.amount, o.price.currency) : ""}${o.days ? ` for ${o.days} days` : ""}`,
  promotionalGrant: "Grant a promotional plan",
  promotionalPlan: "Plan",
  promotionalDays: "Days",
  promotionalNote: "Note",
  promotionalSubmit: "Grant",
  promotionalSent: "Granted.",
  kind: {
    purchase: "Purchase",
    trial: "Free trial",
    refund_request: "Refund requested from the store",
    promotional: "Promotional plan",
    renewal: "Renewal",
    refund: "Refund",
    cancellation: "Cancelled renewal",
    uncancellation: "Renewal turned back on",
    billing_issue: "Billing issue",
    grace_period: "Grace period",
    expiration: "Expired",
    paused: "Paused",
    dispute: "Dispute",
  } as Record<string, string>,
}

export type MonetisationLabels = typeof DEFAULT_MONETISATION_LABELS

function useLabels(labels?: Partial<MonetisationLabels>): MonetisationLabels {
  return React.useMemo(() => ({ ...DEFAULT_MONETISATION_LABELS, ...labels }), [labels])
}

const storeName = (labels: MonetisationLabels, gateway: string) => labels.source[gateway] ?? gateway

// ------------------------------------------------------------ remote paywall

/**
 * Billing plans for one source from an offering: the paywall's `plans` (or
 * every plan its products grant) in order, priced from the products sold on
 * `source` ("web" covers every web gateway), with the highlighted plan marked.
 * `display` adds names, descriptions and features the app knows.
 */
export function plansFromOffering(
  offering: RemoteOffering,
  source: BillingSource = "web",
  display: Readonly<Record<string, Partial<BillingPlan>>> = {},
  badge?: string,
): BillingPlan[] {
  const sold = offering.products.filter((p) => p.store === source)
  const order = offering.paywall?.plans ?? [...new Set(offering.products.map((p) => p.plan))]
  return order
    .filter((key) => sold.some((p) => p.plan === key))
    .map((key) => {
      const prices: BillingPlan["prices"] = {}
      for (const p of sold) if (p.plan === key && p.price) prices[p.interval ?? "month"] = p.price
      const highlighted = offering.paywall?.highlight === key
      return {
        key,
        name: display[key]?.name ?? key.charAt(0).toUpperCase() + key.slice(1),
        ...display[key],
        prices: { ...display[key]?.prices, ...prices },
        sources: [source],
        ...(highlighted ? { badge: offering.paywall?.badge ?? badge ?? display[key]?.badge } : {}),
      } as BillingPlan
    })
}

export type RemotePaywallProps = Omit<
  PaywallProps,
  "plans" | "onSubscribe" | "title" | "subtitle" | "defaultValue" | "labels"
> & {
  offering: RemoteOffering
  /** Names, descriptions and features per plan key; prices come from the offering. */
  display?: Readonly<Record<string, Partial<BillingPlan>>>
  /**
   * Buy the product through your checkout: signet-payments `checkout` on the
   * web, StoreKit or Play Billing (then `verifyPurchase`) in the app.
   */
  onPurchase?: (
    product: RemoteProduct,
    plan: BillingPlan,
    interval: BillingInterval,
    /** The product's best offer for this customer, to apply at checkout. */
    offer?: RemoteOffer,
  ) => unknown
  /** Called once when the paywall is shown: post it to `/offerings/:placement/impression` for charts. */
  onImpression?: (offering: RemoteOffering) => unknown
  labels?: Partial<MonetisationLabels>
}

/** The paywall the server configured: copy, plans, highlight and trial text, on the Paywall parts. */
export function RemotePaywall({
  offering,
  display,
  source = "web",
  onPurchase,
  onImpression,
  labels: labelsProp,
  className,
  ...props
}: RemotePaywallProps) {
  const seenRef = React.useRef("")
  const shown = `${offering.key}@${offering.version}`
  React.useEffect(() => {
    if (!onImpression || seenRef.current === shown) return
    seenRef.current = shown
    onImpression(offering)
  }, [onImpression, offering, shown])
  const labels = useLabels(labelsProp)
  const pw = offering.paywall ?? {}
  const plans = React.useMemo(
    () => plansFromOffering(offering, source, display, labels.highlight),
    [offering, source, display, labels.highlight],
  )
  const billingLabels: Partial<BillingLabels> = React.useMemo(
    () => ({
      ...labelsProp,
      ...(pw.cta ? { choose: () => pw.cta as string } : {}),
    }),
    [labelsProp, pw.cta],
  )
  const buy = (plan: BillingPlan, interval: BillingInterval) => {
    const product = offering.products.find(
      (p) => p.store === source && p.plan === plan.key && (p.interval ?? "month") === interval,
    )
    return product && onPurchase?.(product, plan, interval, product.offers?.[0])
  }
  const offer = offering.products.find(
    (p) => p.store === source && plans.some((x) => x.key === p.plan) && p.offers?.length,
  )?.offers?.[0]
  return (
    <div
      data-slot="remote-paywall"
      data-offering={offering.key}
      data-version={offering.version}
      className={cn("flex flex-col gap-3", className)}
    >
      <Paywall
        {...props}
        plans={plans}
        source={source}
        labels={billingLabels}
        {...(pw.title ? { title: pw.title } : {})}
        {...(pw.subtitle ? { subtitle: pw.subtitle } : {})}
        {...(pw.highlight ? { defaultValue: pw.highlight } : {})}
        {...(onPurchase ? { onSubscribe: buy } : {})}
      />
      {offer ? (
        <p
          data-slot="paywall-offer"
          data-offer={offer.id}
          data-offer-type={offer.type}
          className="text-center text-sm font-medium text-text-primary"
        >
          {labels.offer(offer)}
        </p>
      ) : (
        pw.trial && (
          <p data-slot="paywall-trial" className="text-center text-sm text-text-muted">
            {pw.trial}
          </p>
        )
      )}
    </div>
  )
}

// ----------------------------------------------------------- customer center

type Phase = "idle" | "pending" | "done" | "failed"

function useAction() {
  const [phase, setPhase] = React.useState<Phase>("idle")
  /** Resolves true when it worked: no throw, and not `false`. */
  const run = async (fn: () => unknown) => {
    setPhase("pending")
    try {
      const worked = (await fn()) !== false
      setPhase(worked ? "done" : "failed")
      return worked
    } catch {
      setPhase("failed")
      return false
    }
  }
  return [phase, run] as const
}

function MessageForm({
  label,
  submit,
  sent,
  failed,
  onSend,
  slot,
}: {
  label: string
  submit: string
  sent: string
  failed: string
  onSend: (message: string) => unknown
  slot: string
}) {
  const [text, setText] = React.useState("")
  const [phase, run] = useAction()
  const id = React.useId()
  return (
    <form
      data-slot={slot}
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!text.trim()) return
        if (await run(() => onSend(text.trim()))) setText("")
      }}
    >
      <label htmlFor={id} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={3} required />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={phase === "pending" || !text.trim()}>
          {submit}
        </Button>
        <span role="status" className="text-xs text-text-muted">
          {phase === "done" ? sent : phase === "failed" ? failed : ""}
        </span>
      </div>
    </form>
  )
}

export type CustomerCenterProps = Omit<React.ComponentProps<"section">, "children"> & {
  overview: CustomerOverview
  plans?: readonly BillingPlan[]
  /** Cancel a web subscription. Resolve false when it failed. */
  onCancel?: () => unknown
  /** Accept the retention offer shown before cancelling. */
  onAcceptRetention?: () => unknown
  /** Request a refund of the latest payment, with the customer's reason. */
  onRequestRefund?: (reason: string) => unknown
  onContactSupport?: (message: string) => unknown
  onRestore?: () => unknown
  labels?: Partial<MonetisationLabels>
}

/**
 * Self-serve subscription management: the plan and renewal date, cancel (a
 * retention offer first when the server has one; store subscriptions link to
 * the store), a refund request and contact support.
 */
export function CustomerCenter({
  overview,
  plans = [],
  onCancel,
  onAcceptRetention,
  onRequestRefund,
  onContactSupport,
  onRestore,
  labels: labelsProp,
  className,
  ...props
}: CustomerCenterProps) {
  const labels = useLabels(labelsProp)
  const [step, setStep] = React.useState<"plan" | "offer">("plan")
  const [cancel, runCancel] = useAction()
  const [offer, runOffer] = useAction()
  const headingId = React.useId()
  const gateway = overview.source?.gateway
  const store = gateway ? storeName(labels, gateway) : ""
  const doCancel = () => runCancel(() => onCancel?.())
  return (
    <section
      data-slot="customer-center"
      aria-labelledby={headingId}
      className={cn("mx-auto flex w-full max-w-2xl flex-col gap-4", className)}
      {...props}
    >
      <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
        {labels.customerCenter}
      </h2>
      <CurrentPlanCard
        subscription={{
          plan: overview.plan,
          status: (overview.status as BillingStatus | null) ?? null,
          currentPeriodEnd: overview.currentPeriodEnd,
          graceUntil: overview.graceUntil ?? null,
          source: overview.source,
        }}
        plans={plans}
        labels={labelsProp ?? {}}
        {...(onRestore && overview.store ? { onRestore } : {})}
      />

      {overview.renews && overview.store && overview.manageUrl && (
        <section
          data-slot="store-manage"
          className="flex flex-col gap-2 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default"
        >
          <p className="text-sm text-text-secondary">{labels.storeCancelHint(store)}</p>
          <a
            href={overview.manageUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline" }), "self-start")}
          >
            {labels.manageInStore(store)}
            <ArrowUpRight data-icon="inline-end" aria-hidden />
          </a>
        </section>
      )}

      {overview.canCancel && onCancel && cancel !== "done" && offer !== "done" && (
        <section
          data-slot="cancel"
          data-step={step}
          className="flex flex-col gap-3 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default"
        >
          {step === "offer" && overview.retention ? (
            <>
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Gift className="size-4" aria-hidden />
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {labels.retentionTitle}
                  </h3>
                  <p data-slot="retention-offer" className="text-sm text-text-secondary">
                    {labels.retentionOffer(overview.retention)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {onAcceptRetention && (
                  <Button
                    disabled={offer === "pending" || cancel === "pending"}
                    onClick={() => runOffer(() => onAcceptRetention())}
                  >
                    {labels.acceptOffer}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={offer === "pending" || cancel === "pending"}
                  onClick={doCancel}
                >
                  {cancel === "pending" ? labels.cancelling : labels.declineOffer}
                </Button>
              </div>
            </>
          ) : (
            <Button
              variant="outline"
              className="self-start"
              disabled={cancel === "pending"}
              onClick={() => (overview.retention ? setStep("offer") : doCancel())}
            >
              {cancel === "pending" ? labels.cancelling : labels.cancel}
            </Button>
          )}
        </section>
      )}
      <p role="status" className="text-sm text-text-secondary empty:hidden">
        {offer === "done"
          ? labels.offerAccepted
          : cancel === "done"
            ? labels.cancelled
            : cancel === "failed" || offer === "failed"
              ? labels.cancelFailed
              : ""}
      </p>

      {(onRequestRefund || onContactSupport) && (
        <section className="flex flex-col gap-5 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default">
          {onRequestRefund && overview.source && (
            <MessageForm
              slot="refund-request"
              label={labels.refundReason}
              submit={labels.refundSubmit}
              sent={labels.refundSent}
              failed={labels.sendFailed}
              onSend={onRequestRefund}
            />
          )}
          {onContactSupport && (
            <MessageForm
              slot="contact-support"
              label={labels.supportMessage}
              submit={labels.supportSubmit}
              sent={labels.supportSent}
              failed={labels.sendFailed}
              onSend={onContactSupport}
            />
          )}
        </section>
      )}
    </section>
  )
}

// ----------------------------------------------------------- admin timeline

const KIND_ICON: Record<string, typeof ShoppingBag> = {
  purchase: ShoppingBag,
  renewal: RefreshCw,
  refund: Undo2,
  cancellation: CircleSlash,
  uncancellation: RotateCcw,
  billing_issue: CircleAlert,
  grace_period: CalendarClock,
  expiration: CircleSlash,
  paused: Pause,
  dispute: LifeBuoy,
  trial: Gift,
  promotional: Gift,
  refund_request: Undo2,
}
const KIND_TONE: Record<string, string> = {
  refund: "border-accent-amber",
  billing_issue: "border-accent-red",
  grace_period: "border-accent-amber",
  expiration: "border-accent-red",
  dispute: "border-accent-red",
  refund_request: "border-accent-amber",
}

export type CustomerTimelineProps = Omit<React.ComponentProps<"section">, "children"> & {
  entries: readonly CustomerTimelineEntry[]
  totals?: readonly CustomerTimelineTotal[]
  labels?: Partial<MonetisationLabels>
}

/** One customer's billing history across App Store, Google Play and web, newest first, with ledger totals. */
export function CustomerTimeline({
  entries,
  totals = [],
  labels: labelsProp,
  className,
  ...props
}: CustomerTimelineProps) {
  const labels = useLabels(labelsProp)
  const headingId = React.useId()
  return (
    <section
      data-slot="customer-timeline"
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default",
        className,
      )}
      {...props}
    >
      <h2 id={headingId} className="text-xs font-medium text-text-muted">
        {labels.timeline}
      </h2>
      {totals.length > 0 && (
        <dl data-slot="timeline-totals" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {totals.map((t) => (
            <div key={t.currency} className="flex gap-4">
              <div>
                <dt className="text-xs text-text-muted">{labels.paid}</dt>
                <dd className="font-semibold text-text-primary tabular-nums">
                  {formatMoney(t.paid, t.currency)}
                  {t.approximate && (
                    <span className="ml-1 text-text-muted" title={labels.approximate}>
                      ≈
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">{labels.refunded}</dt>
                <dd className="font-semibold text-text-primary tabular-nums">
                  {formatMoney(t.refunded, t.currency)}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      )}
      {entries.length === 0 ? (
        <p className="text-sm text-text-muted">{labels.noEvents}</p>
      ) : (
        <Timeline aria-label={labels.timeline}>
          {entries.map((e) => {
            const Icon = KIND_ICON[e.kind] ?? CreditCard
            const at = new Date(e.occurredAt)
            return (
              <TimelineItem key={e.id} data-kind={e.kind} data-gateway={e.gateway}>
                <TimelineMarker className={KIND_TONE[e.kind]}>
                  <Icon aria-hidden />
                </TimelineMarker>
                <TimelineTitle className="flex flex-wrap items-center gap-2">
                  {labels.kind[e.kind] ?? e.kind}
                  <Badge variant="outline">{storeName(labels, e.gateway)}</Badge>
                  {e.amount != null && e.currency && (
                    <span className="text-sm font-normal text-text-secondary tabular-nums">
                      {formatMoney(e.amount, e.currency)}
                      {e.approximate ? " ≈" : ""}
                    </span>
                  )}
                </TimelineTitle>
                <TimelineTime dateTime={at.toISOString()}>{dateText(at)}</TimelineTime>
                {(e.productId || e.paymentId) && (
                  <TimelineDescription className="font-mono text-xs">
                    {[e.productId, e.paymentId].filter(Boolean).join(" · ")}
                  </TimelineDescription>
                )}
              </TimelineItem>
            )
          })}
        </Timeline>
      )}
    </section>
  )
}

// --------------------------------------------------- promotional grant (admin)

const fieldClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring dark:bg-input/30"

export type PromotionalGrantFormProps = Omit<React.ComponentProps<"form">, "onSubmit"> & {
  /** Plan keys an admin may grant. */
  plans: readonly string[]
  defaultDays?: number
  /** POST `/customers/:subject/promotional` with `{ plan, days, note? }`. */
  onGrant: (grant: { plan: string; days: number; note?: string }) => unknown
  labels?: Partial<MonetisationLabels>
}

/** Grant a customer a plan for some days, from admin; it lapses on its own. */
export function PromotionalGrantForm({
  plans,
  defaultDays = 30,
  onGrant,
  labels: labelsProp,
  className,
  ...props
}: PromotionalGrantFormProps) {
  const labels = useLabels(labelsProp)
  const id = React.useId()
  const [plan, setPlan] = React.useState(plans[0] ?? "")
  const [days, setDays] = React.useState(String(defaultDays))
  const [note, setNote] = React.useState("")
  const [phase, run] = useAction()
  const n = Number(days)
  const valid = !!plan && Number.isInteger(n) && n > 0
  return (
    <form
      data-slot="promotional-grant"
      aria-labelledby={`${id}h`}
      className={cn("flex flex-col gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault()
        if (valid)
          run(() => onGrant({ plan, days: n, ...(note.trim() ? { note: note.trim() } : {}) }))
      }}
      {...props}
    >
      <h3 id={`${id}h`} className="text-xs font-medium text-text-muted">
        {labels.promotionalGrant}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {labels.promotionalPlan}
          <select className={fieldClass} value={plan} onChange={(e) => setPlan(e.target.value)}>
            {plans.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {labels.promotionalDays}
          <input
            className={fieldClass}
            type="number"
            min={1}
            step={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {labels.promotionalNote}
        <input
          className={fieldClass}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <Button type="submit" size="sm" disabled={!valid || phase === "pending"}>
        {labels.promotionalSubmit}
      </Button>
      <p aria-live="polite" className="text-sm text-text-muted">
        {phase === "done" ? labels.promotionalSent : phase === "failed" ? labels.sendFailed : ""}
      </p>
    </form>
  )
}
