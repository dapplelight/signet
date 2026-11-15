"use client"

// Web-to-app funnel screens on signet-db's funnels and signet-server's funnel
// routes: the funnel itself (questions, then the remote paywall with any URL
// discount priced in, then email and code), Stripe's Express Checkout
// (Apple Pay, Google Pay) and Payment Element with Stripe.js loaded at
// runtime, and the post-purchase redemption card (open the app, or paste the
// code). Data comes in as props shaped like the routes' JSON; actions go out
// as callbacks, so any client fits. The paywall step reuses RemotePaywall.
// Recipe: selection + controllable-state + live-region
import { Check, Copy, Smartphone } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Button, buttonVariants } from "../ui/button.js"
import { Input } from "../ui/input.js"
import { Spinner } from "../ui/spinner.js"
import type { BillingInterval, BillingPlan } from "./billing-screens.js"
import { formatMoney } from "./billing-screens.js"
import { type RemoteOffering, RemotePaywall, type RemoteProduct } from "./monetisation-screens.js"

// ---------------------------------------------------------------- data model

/** signet-db `FunnelQuestion`. */
export type FunnelQuestionView = {
  id: string
  title: string
  options: readonly { value: string; label: string }[]
  multiple?: boolean
}

/** signet-db `DiscountQuote`. */
export type FunnelDiscountView =
  | { valid: true; code: string; off: number; amount: number; currency: string }
  | { valid: false; code: string; reason: string }

/** `GET /:key/config` from signet-server's funnel routes. */
export type FunnelPageView = {
  funnel: {
    key: string
    title?: string
    subtitle?: string
    questions?: readonly FunnelQuestionView[]
  }
  offering: RemoteOffering
  /** The URL's code priced per product id. */
  discounts?: Readonly<Record<string, FunnelDiscountView>>
}

export type FunnelAnswers = Record<string, string | string[]>

export type FunnelCheckoutRequest = {
  product: RemoteProduct
  answers: FunnelAnswers
  email: string
  code?: string
}

export const DEFAULT_FUNNEL_LABELS = {
  next: "Continue",
  email: "Email for your receipt",
  code: "Discount code",
  checkout: "Go to payment",
  off: (amount: string) => `${amount} off`,
  discountRefused: (reason: string) =>
    ({
      unknown: "This code is not valid.",
      expired: "This code has expired.",
      not_for_plan: "This code does not apply to this plan.",
      used_up: "This code has been used up.",
      currency: "This code does not apply in this currency.",
      free: "This code cannot be used here.",
    })[reason] ?? "This code cannot be used.",
  failed: "Something went wrong. Try again.",
  pay: (amount: string) => `Pay ${amount}`,
  orCard: "or pay by card",
  waiting: "Confirming your payment…",
  paid: "You're in. Open the app to unlock your plan.",
  openApp: "Open the app",
  codeHint: "Or paste this code in the app",
  copy: "Copy code",
  copied: "Copied",
  redeemed: "This purchase is already unlocked in the app.",
  paymentFailed: "The payment did not go through.",
}

export type FunnelLabels = typeof DEFAULT_FUNNEL_LABELS

function useLabels(labels?: Partial<FunnelLabels>): FunnelLabels {
  return React.useMemo(() => ({ ...DEFAULT_FUNNEL_LABELS, ...labels }), [labels])
}

/** The offering with each valid discount priced into its product, for the paywall. */
export function discountedOffering(
  offering: RemoteOffering,
  discounts: Readonly<Record<string, FunnelDiscountView>> = {},
): RemoteOffering {
  return {
    ...offering,
    products: offering.products.map((p) => {
      const d = discounts[p.id]
      return d?.valid ? { ...p, price: { amount: d.amount, currency: d.currency } } : p
    }),
  }
}

// ------------------------------------------------------------------ question

export type FunnelQuestionProps = Omit<React.ComponentProps<"fieldset">, "onChange"> & {
  question: FunnelQuestionView
  value?: string | string[]
  /** Single choice answers on click; multiple choice on Continue. */
  onAnswer: (value: string | string[]) => void
  labels?: Partial<FunnelLabels>
}

/** One funnel question as large toggle buttons. */
export function FunnelQuestion({
  question,
  value,
  onAnswer,
  labels: labelsProp,
  className,
  ...props
}: FunnelQuestionProps) {
  const labels = useLabels(labelsProp)
  const [picked, setPicked] = React.useState<string[]>(
    Array.isArray(value) ? value : value ? [value] : [],
  )
  const headingId = React.useId()
  return (
    <fieldset
      data-slot="funnel-question"
      data-question={question.id}
      aria-labelledby={headingId}
      className={cn("flex flex-col gap-2", className)}
      {...props}
    >
      <legend id={headingId} className="mb-2 text-lg font-semibold text-text-primary">
        {question.title}
      </legend>
      {question.options.map((op) => {
        const on = picked.includes(op.value)
        return (
          <Button
            key={op.value}
            type="button"
            variant={on ? "default" : "outline"}
            aria-pressed={on}
            className="h-auto justify-start py-3"
            onClick={() => {
              if (!question.multiple) return onAnswer(op.value)
              setPicked((p) => (on ? p.filter((x) => x !== op.value) : [...p, op.value]))
            }}
          >
            {question.multiple && on && <Check aria-hidden />}
            {op.label}
          </Button>
        )
      })}
      {question.multiple && (
        <Button type="button" disabled={!picked.length} onClick={() => onAnswer(picked)}>
          {labels.next}
        </Button>
      )}
    </fieldset>
  )
}

// -------------------------------------------------------------------- funnel

export type WebFunnelProps = Omit<React.ComponentProps<"section">, "children"> & {
  page: FunnelPageView
  /** The code from the URL, shown in the checkout step. */
  code?: string
  /** A step was shown: a question id, "plans" or "checkout". Post it to `/:key/events`. */
  onStep?: (step: string) => void
  /** Start the checkout (`POST /:key/checkout`). Resolve to anything; `renderCheckout` gets it. */
  onCheckout: (request: FunnelCheckoutRequest) => unknown
  /** Render the gateway's step from `onCheckout`'s result, e.g. `<ExpressCheckout>`. */
  renderCheckout?: (result: unknown) => React.ReactNode
  /** Names, descriptions and features per plan key for the paywall. */
  display?: Readonly<Record<string, Partial<BillingPlan>>>
  labels?: Partial<FunnelLabels>
}

/** A hosted funnel: the questions, the remote paywall with the URL discount priced in, then email and code. */
export function WebFunnel({
  page,
  code: codeProp = "",
  onStep,
  onCheckout,
  renderCheckout,
  display,
  labels: labelsProp,
  className,
  ...props
}: WebFunnelProps) {
  const labels = useLabels(labelsProp)
  const questions = page.funnel.questions ?? []
  const [index, setIndex] = React.useState(0)
  const [answers, setAnswers] = React.useState<FunnelAnswers>({})
  const [product, setProduct] = React.useState<RemoteProduct | null>(null)
  const [email, setEmail] = React.useState("")
  const [code, setCode] = React.useState(codeProp)
  const [phase, setPhase] = React.useState<"idle" | "pending" | "failed">("idle")
  const [result, setResult] = React.useState<{ value: unknown } | null>(null)
  const step = product ? "checkout" : index < questions.length ? questions[index]?.id : "plans"
  React.useEffect(() => {
    if (step) onStep?.(step)
  }, [step, onStep])
  const offering = React.useMemo(
    () => discountedOffering(page.offering, page.discounts),
    [page.offering, page.discounts],
  )
  const question = questions[index]
  const discount = product ? page.discounts?.[product.id] : undefined
  const emailId = React.useId()
  const codeId = React.useId()

  return (
    <section
      data-slot="web-funnel"
      data-funnel={page.funnel.key}
      data-step={step}
      className={cn("mx-auto flex w-full max-w-md flex-col gap-4", className)}
      {...props}
    >
      {page.funnel.title && index === 0 && !product && (
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            {page.funnel.title}
          </h1>
          {page.funnel.subtitle && (
            <p className="text-sm text-text-secondary">{page.funnel.subtitle}</p>
          )}
        </header>
      )}
      {question && !product && (
        <FunnelQuestion
          key={question.id}
          question={question}
          {...(answers[question.id] !== undefined ? { value: answers[question.id] } : {})}
          labels={labelsProp ?? {}}
          onAnswer={(v) => {
            setAnswers((a) => ({ ...a, [question.id]: v }))
            setIndex((i) => i + 1)
          }}
        />
      )}
      {!question && !product && (
        <RemotePaywall
          offering={offering}
          source="web"
          {...(display ? { display } : {})}
          onPurchase={(p: RemoteProduct, _plan: BillingPlan, _i: BillingInterval) =>
            setProduct(page.offering.products.find((x) => x.id === p.id) ?? p)
          }
        />
      )}
      {product && !result && (
        <form
          data-slot="funnel-checkout"
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setPhase("pending")
            try {
              const value = await onCheckout({
                product,
                answers,
                email,
                ...(code.trim() ? { code: code.trim() } : {}),
              })
              setResult({ value })
              setPhase("idle")
            } catch {
              setPhase("failed")
            }
          }}
        >
          <label htmlFor={emailId} className="text-sm font-medium text-text-primary">
            {labels.email}
          </label>
          <Input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor={codeId} className="text-sm font-medium text-text-primary">
            {labels.code}
          </label>
          <Input id={codeId} value={code} onChange={(e) => setCode(e.target.value)} />
          <p role="status" className="text-sm text-text-muted">
            {discount && code.trim().toUpperCase() === discount.code
              ? discount.valid
                ? labels.off(formatMoney(discount.off, discount.currency))
                : labels.discountRefused(discount.reason)
              : ""}
          </p>
          <Button type="submit" disabled={phase === "pending"}>
            {phase === "pending" && <Spinner />}
            {labels.checkout}
          </Button>
          {phase === "failed" && (
            <p role="alert" className="text-sm text-destructive">
              {labels.failed}
            </p>
          )}
        </form>
      )}
      {result && renderCheckout?.(result.value)}
    </section>
  )
}

// ---------------------------------------------------------- express checkout

type StripeLike = {
  elements(o: { clientSecret: string }): {
    create(kind: string): {
      mount(el: HTMLElement): void
      on(ev: string, fn: () => void): void
      destroy?(): void
    }
    submit(): Promise<{ error?: { message?: string } }>
  }
  confirmPayment(o: unknown): Promise<{ error?: { message?: string } }>
}

const loading = new Map<string, Promise<void>>()
/** Load a script once per page, at runtime. */
export function loadScript(src: string): Promise<void> {
  const known = loading.get(src)
  if (known) return known
  const s = document.createElement("script")
  s.src = src
  s.async = true
  const p = new Promise<void>((resolve, reject) => {
    s.onload = () => resolve()
    s.onerror = () => {
      loading.delete(src)
      s.remove()
      reject(new Error(`Could not load ${src}`))
    }
  })
  loading.set(src, p)
  document.head.append(s)
  return p
}

export const STRIPE_JS_URL = "https://js.stripe.com/v3/"

export type ExpressCheckoutProps = Omit<React.ComponentProps<"div">, "children"> & {
  publishableKey: string
  /** The checkout's `clientSecret` (a PaymentIntent's). */
  clientSecret: string
  /** Where Stripe sends the buyer back: the funnel page with `?session=`. */
  returnUrl: string
  amount: number
  currency: string
  /** Load Stripe.js and return `Stripe(key)`. Default: STRIPE_JS_URL at runtime. */
  loadStripe?: (publishableKey: string) => Promise<StripeLike>
  labels?: Partial<FunnelLabels>
}

const defaultLoadStripe = async (key: string) => {
  await loadScript(STRIPE_JS_URL)
  return (window as unknown as { Stripe: (k: string) => StripeLike }).Stripe(key)
}

/**
 * Apple Pay and Google Pay through Stripe's Express Checkout Element, with
 * the Payment Element for cards below it. Stripe.js comes from Stripe at
 * runtime; nothing is bundled. Wallet buttons show once the domain is
 * registered with Stripe (`POST /v1/payment_method_domains`).
 */
export function ExpressCheckout({
  publishableKey,
  clientSecret,
  returnUrl,
  amount,
  currency,
  loadStripe = defaultLoadStripe,
  labels: labelsProp,
  className,
  ...props
}: ExpressCheckoutProps) {
  const labels = useLabels(labelsProp)
  const express = React.useRef<HTMLDivElement>(null)
  const card = React.useRef<HTMLDivElement>(null)
  const ready = React.useRef<{
    stripe: StripeLike
    elements: ReturnType<StripeLike["elements"]>
  } | null>(null)
  const [error, setError] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  // Re-mount only when the payment itself changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadStripe and returnUrl are read once per payment
  React.useEffect(() => {
    let live = true
    const mounted: { destroy?(): void }[] = []
    loadStripe(publishableKey).then(
      (stripe) => {
        if (!live || !express.current || !card.current) return
        const elements = stripe.elements({ clientSecret })
        ready.current = { stripe, elements }
        const x = elements.create("expressCheckout")
        x.on("confirm", () => void confirm())
        x.mount(express.current)
        const pay = elements.create("payment")
        pay.mount(card.current)
        mounted.push(x, pay)
      },
      () => live && setError(labels.failed),
    )
    return () => {
      live = false
      for (const m of mounted) m.destroy?.()
    }
  }, [publishableKey, clientSecret])

  async function confirm() {
    const r = ready.current
    if (!r) return
    const out = await r.stripe.confirmPayment({
      elements: r.elements,
      clientSecret,
      confirmParams: { return_url: returnUrl },
    })
    if (out.error) setError(out.error.message ?? labels.failed)
  }

  return (
    <div data-slot="express-checkout" className={cn("flex flex-col gap-3", className)} {...props}>
      <div ref={express} data-slot="express-checkout-wallets" />
      <p className="text-center text-xs text-text-muted">{labels.orCard}</p>
      <div ref={card} data-slot="express-checkout-card" />
      <Button
        type="button"
        disabled={busy}
        onClick={async () => {
          const r = ready.current
          if (!r) return
          setBusy(true)
          setError("")
          const s = await r.elements.submit()
          if (s.error) setError(s.error.message ?? labels.failed)
          else await confirm()
          setBusy(false)
        }}
      >
        {labels.pay(formatMoney(amount, currency))}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- redemption

/** `GET /sessions/:id` from signet-server's funnel routes. */
export type FunnelSessionView = {
  session: { id: string; status: string; plan?: string }
  redemption?: { link: string; token: string; expiresAt?: string | Date }
}

export type FunnelRedemptionProps = Omit<React.ComponentProps<"section">, "children"> & {
  /** The latest `GET /sessions/:id`; null while the first read is in flight. Poll until it is paid. */
  data: FunnelSessionView | null
  labels?: Partial<FunnelLabels>
}

/** After the web purchase: waits for the webhook, then offers the app link and the code to paste. */
export function FunnelRedemption({
  data,
  labels: labelsProp,
  className,
  ...props
}: FunnelRedemptionProps) {
  const labels = useLabels(labelsProp)
  const [copied, setCopied] = React.useState(false)
  const status = data?.session.status ?? "open"
  const r = data?.redemption
  return (
    <section
      data-slot="funnel-redemption"
      data-status={status}
      aria-live="polite"
      className={cn(
        "mx-auto flex w-full max-w-md flex-col gap-3 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default",
        className,
      )}
      {...props}
    >
      {status === "paid" && r ? (
        <>
          <p className="font-medium text-text-primary">{labels.paid}</p>
          <a href={r.link} className={cn(buttonVariants(), "w-full")}>
            <Smartphone aria-hidden />
            {labels.openApp}
          </a>
          <p className="text-sm text-text-muted">{labels.codeHint}</p>
          <code
            data-slot="funnel-redemption-code"
            className="break-all rounded-md bg-bg-muted p-2 text-xs text-text-primary"
          >
            {r.token}
          </code>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard?.writeText(r.token)
              setCopied(true)
            }}
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? labels.copied : labels.copy}
          </Button>
        </>
      ) : status === "redeemed" ? (
        <p className="text-text-primary">{labels.redeemed}</p>
      ) : status === "failed" || status === "refunded" ? (
        <p role="alert" className="text-destructive">
          {labels.paymentFailed}
        </p>
      ) : (
        <p className="flex items-center gap-2 text-text-secondary">
          <Spinner />
          {labels.waiting}
        </p>
      )}
    </section>
  )
}
