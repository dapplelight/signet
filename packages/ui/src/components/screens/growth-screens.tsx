"use client"

// Growth screens on signet-db's growth module: waitlist join with position,
// invite accept, a referral share card, an onboarding checklist, a feedback
// widget and a changelog "what's new" widget. Data comes in as props shaped
// like signet-db's results (`joinWaitlist`, `acceptInvite`, `referralStats`,
// `onboarding`, `unseenChangelog`); actions go out as callbacks.
// Recipe: selection + roving-focus + controllable-state + popup + dismiss + live-region + field-wiring
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import {
  ArrowRight,
  Bug,
  Check,
  Copy,
  Gift,
  Heart,
  Lightbulb,
  Mail,
  MessageCircle,
  MessageSquarePlus,
  Share2,
  Sparkles,
  Star,
  UserPlus,
  X,
} from "lucide-react"
import * as React from "react"
import { useControllableState } from "../../behaviors/index.js"
import { cn } from "../../lib/utils.js"
import { Avatar, AvatarFallback, AvatarImage, initials } from "../ui/avatar.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import { Field, FieldControl, FieldError, FieldLabel } from "../ui/field.js"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js"
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js"
import { Textarea } from "../ui/textarea.js"

// -------------------------------------------------------------------- labels

const dateText = (d: Date | string) =>
  new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" })

/** Every string the growth screens show, in English. Spread and override for another language. */
export const DEFAULT_GROWTH_LABELS = {
  // waitlist
  waitlistTitle: "Join the waitlist",
  email: "Email",
  emailPlaceholder: "you@example.com",
  join: "Join",
  joining: "Joining…",
  position: "Your place in line",
  joined: "You're on the list",
  alreadyJoined: "You're already on the list",
  invalidEmail: "Enter a valid email",
  // invite
  invitedBy: (name: string) => `${name} invited you`,
  invited: "You're invited",
  joinScope: (scope: string) => `Join ${scope}`,
  asRole: (role: string) => `as ${role}`,
  expires: (d: Date | string) => `Expires ${dateText(d)}`,
  accept: "Accept",
  accepting: "Accepting…",
  decline: "Decline",
  accepted: "You're in",
  inviteError: {
    not_found: "This invite link doesn't work",
    expired: "This invite has expired",
    used: "This invite was already used",
    revoked: "This invite was withdrawn",
    email_mismatch: "This invite is for a different email",
  } as Record<string, string>,
  // referral
  referralTitle: "Invite friends",
  referralBody: "",
  referralCode: "Your code",
  referralLink: "Your link",
  copy: "Copy",
  copyLink: "Copy link",
  copied: "Copied",
  share: "Share",
  shareText: (url: string) => url,
  referred: "Joined",
  converted: "Subscribed",
  rewarded: "Rewarded",
  // onboarding
  onboardingTitle: "Get started",
  progress: (done: number, total: number) => `${done} of ${total} done`,
  stepDone: "Done",
  stepNext: "Next",
  dismiss: "Dismiss",
  allDone: "All set",
  // feedback
  feedback: "Feedback",
  feedbackTitle: "Send feedback",
  kind: "Type",
  kinds: { bug: "Bug", idea: "Idea", praise: "Praise", other: "Other" } as Record<string, string>,
  message: "Message",
  messagePlaceholder: "",
  rating: "Rating",
  stars: (n: number) => `${n} ${n === 1 ? "star" : "stars"}`,
  send: "Send",
  sending: "Sending…",
  thanks: "Thanks!",
  feedbackError: "Couldn't send. Try again.",
  // changelog
  whatsNew: "What's new",
  newCount: (n: number) => `${n} new`,
  noNews: "You're up to date",
  readMore: "Read more",
  readMoreAbout: (title: string) => `Read more about ${title}`,
}

export type GrowthLabels = typeof DEFAULT_GROWTH_LABELS

function useLabels(labels?: Partial<GrowthLabels>): GrowthLabels {
  return React.useMemo(() => ({ ...DEFAULT_GROWTH_LABELS, ...labels }), [labels])
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

const CARD = "flex flex-col gap-4 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default"

/** A polite live region; children change, the region stays. */
function Status({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span role="status" className={className}>
      {children}
    </span>
  )
}

// ------------------------------------------------------------------ waitlist

/** signet-db `joinWaitlist` result. */
export type WaitlistResult = { email?: string; position: number; joined: boolean }

export type WaitlistJoinProps = Omit<PartProps<"section">, "onSubmit"> & {
  /** Join and return the place in line: `growth.joinWaitlist(email, { referralCode })`. */
  onJoin: (email: string) => Promise<WaitlistResult> | WaitlistResult
  /** The result (controlled), e.g. from an earlier visit. */
  result?: WaitlistResult | null
  defaultResult?: WaitlistResult | null
  onResultChange?: (result: WaitlistResult | null) => void
  title?: React.ReactNode
  labels?: Partial<GrowthLabels>
}

/** An email box; once joined, the place in line, big. */
export function WaitlistJoin({
  onJoin,
  result: resultProp,
  defaultResult = null,
  onResultChange,
  title,
  labels: labelsProp,
  ...props
}: WaitlistJoinProps) {
  const labels = useLabels(labelsProp)
  const [result, setResult] = useControllableState<WaitlistResult | null>({
    value: resultProp,
    defaultValue: defaultResult,
    onChange: onResultChange,
  })
  const [email, setEmail] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const headingId = React.useId()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(labels.invalidEmail)
      return
    }
    setError(null)
    setPending(true)
    try {
      setResult(await onJoin(email.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }
  const children = result ? (
    <div className="flex flex-col items-center gap-2 py-2 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-accent-green-subtle text-accent-green">
        <Check className="size-5" aria-hidden />
      </span>
      <Status className="text-base font-semibold text-text-primary">
        {result.joined ? labels.joined : labels.alreadyJoined}
      </Status>
      <span className="text-xs text-text-muted">{labels.position}</span>
      <span
        data-slot="waitlist-position"
        className="text-5xl font-semibold tracking-tight text-text-primary tabular-nums"
      >
        #{result.position.toLocaleString()}
      </span>
    </div>
  ) : (
    <>
      <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
        {title ?? labels.waitlistTitle}
      </h2>
      <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <Field errors={error ? [error] : []} className="flex-1 gap-1.5">
          <FieldLabel className="sr-only">{labels.email}</FieldLabel>
          <FieldControl
            type="email"
            autoComplete="email"
            placeholder={labels.emailPlaceholder}
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            className="h-10"
          />
          <FieldError />
        </Field>
        <Button type="submit" size="lg" className="h-10 px-4" disabled={pending}>
          {pending ? labels.joining : labels.join}
          {!pending && <ArrowRight data-icon="inline-end" aria-hidden />}
        </Button>
      </form>
    </>
  )
  return usePart(
    "section",
    "waitlist",
    CARD,
    props,
    {
      ...(result
        ? { "aria-label": result.joined ? labels.joined : labels.alreadyJoined }
        : { "aria-labelledby": headingId }),
      children,
    },
    { joined: !!result },
  )
}

// -------------------------------------------------------------------- invite

/** What the invite screen shows; resolve the token server-side first. */
export type InviteDetails = {
  inviterName?: string
  inviterImage?: string
  /** The org or project being joined. */
  scopeName?: string
  role?: string | null
  email?: string | null
  expiresAt?: Date | string
}

/** signet-db `acceptInvite` result, as it is. */
export type InviteAcceptResult =
  | { ok: true; already?: boolean }
  | { ok: false; reason: "not_found" | "expired" | "used" | "revoked" | "email_mismatch" }

export type InviteAcceptProps = PartProps<"section"> & {
  invite: InviteDetails
  onAccept: () => Promise<InviteAcceptResult> | InviteAcceptResult
  onDecline?: () => void
  /** Called after a successful accept, e.g. to navigate. */
  onAccepted?: () => void
  /** Show a failure straight away (a token that did not resolve). */
  error?: Exclude<InviteAcceptResult, { ok: true }>["reason"]
  labels?: Partial<GrowthLabels>
}

/** Who invited you to what, and Accept / Decline. Failures read in plain words. */
export function InviteAccept({
  invite,
  onAccept,
  onDecline,
  onAccepted,
  error: errorProp,
  labels: labelsProp,
  ...props
}: InviteAcceptProps) {
  const labels = useLabels(labelsProp)
  const [state, setState] = React.useState<"idle" | "pending" | "accepted">("idle")
  const [reason, setReason] = React.useState<string | undefined>(errorProp)
  const headingId = React.useId()
  const accept = async () => {
    setState("pending")
    const r = await onAccept()
    if (r.ok) {
      setState("accepted")
      onAccepted?.()
    } else {
      setState("idle")
      setReason(r.reason)
    }
  }
  const status = reason ? "error" : state
  const children = (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative">
          <Avatar className="size-14 ring-2 ring-bg-surface">
            {invite.inviterImage && <AvatarImage src={invite.inviterImage} alt="" />}
            <AvatarFallback className="text-base">
              {invite.inviterName ? (
                initials(invite.inviterName)
              ) : (
                <UserPlus className="size-5" aria-hidden />
              )}
            </AvatarFallback>
          </Avatar>
          <span className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-bg-surface">
            <Mail className="size-3" aria-hidden />
          </span>
        </div>
        <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
          {invite.inviterName ? labels.invitedBy(invite.inviterName) : labels.invited}
        </h2>
        {(invite.scopeName || invite.role) && (
          <p className="text-sm text-text-secondary">
            {invite.scopeName && labels.joinScope(invite.scopeName)}{" "}
            {invite.role && <Badge variant="secondary">{labels.asRole(invite.role)}</Badge>}
          </p>
        )}
        {invite.expiresAt && state !== "accepted" && !reason && (
          <p className="text-xs text-text-muted">{labels.expires(invite.expiresAt)}</p>
        )}
      </div>
      <Status
        className={cn(
          "text-center text-sm empty:hidden",
          reason
            ? "rounded-lg bg-accent-red-subtle px-3 py-2 text-accent-red"
            : "font-medium text-accent-green",
        )}
      >
        {reason
          ? (labels.inviteError[reason] ?? reason)
          : state === "accepted"
            ? labels.accepted
            : ""}
      </Status>
      {state !== "accepted" && !reason && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          {onDecline && (
            <Button variant="ghost" size="lg" onClick={onDecline}>
              {labels.decline}
            </Button>
          )}
          <Button size="lg" className="sm:min-w-32" disabled={state === "pending"} onClick={accept}>
            {state === "pending" ? labels.accepting : labels.accept}
          </Button>
        </div>
      )}
    </>
  )
  return usePart(
    "section",
    "invite-accept",
    cn(CARD, "mx-auto w-full max-w-sm gap-5 p-6"),
    props,
    { "aria-labelledby": headingId, children },
    { status },
  )
}

// ------------------------------------------------------------------ referral

export type ReferralCardProps = PartProps<"section"> & {
  /** From `growth.referralCode(subject)`. */
  code: string
  /** The link that carries the code, e.g. `https://app.example.com/?ref=CODE`. */
  url: string
  /** From `growth.referralStats(subject)`. */
  stats?: { referred: number; converted: number; rewarded: number }
  /** Replaces the share action. Default: the Web Share API, else copy the link. */
  onShare?: (url: string) => void
  title?: React.ReactNode
  labels?: Partial<GrowthLabels>
}

/** The code, a copyable link, a share button and how many friends joined. */
export function ReferralCard({
  code,
  url,
  stats,
  onShare,
  title,
  labels: labelsProp,
  ...props
}: ReferralCardProps) {
  const labels = useLabels(labelsProp)
  const [copied, setCopied] = React.useState(false)
  const headingId = React.useId()
  const linkId = React.useId()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  const share = async () => {
    if (onShare) return onShare(url)
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ url, text: labels.shareText(url) })
        return
      } catch {
        // dismissed: fall through to nothing
        return
      }
    }
    await copy()
  }
  const children = (
    <>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Gift className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 id={headingId} className="text-base font-semibold text-text-primary">
            {title ?? labels.referralTitle}
          </h2>
          {labels.referralBody && <p className="text-sm text-text-muted">{labels.referralBody}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-muted">{labels.referralCode}</span>
        <span
          data-slot="referral-code"
          className="w-fit rounded-lg border border-dashed border-border-strong bg-bg-elevated px-3 py-1.5 font-mono text-lg font-semibold tracking-widest text-text-primary"
        >
          {code}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={linkId} className="text-xs font-medium text-text-muted">
          {labels.referralLink}
        </label>
        <div className="flex gap-2">
          <input
            id={linkId}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-9 min-w-0 flex-1 truncate rounded-lg border border-input bg-transparent px-2.5 text-sm text-text-secondary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring dark:bg-input/30"
          />
          <Button
            variant="outline"
            size="icon-lg"
            onClick={copy}
            aria-label={labels.copyLink}
            data-copied={copied || undefined}
          >
            {copied ? <Check aria-hidden className="text-accent-green" /> : <Copy aria-hidden />}
          </Button>
          <Button size="lg" onClick={share}>
            <Share2 data-icon="inline-start" aria-hidden />
            {labels.share}
          </Button>
        </div>
        <Status className="text-xs text-accent-green">{copied ? labels.copied : ""}</Status>
      </div>
      {stats && (
        <dl className="grid grid-cols-3 divide-x divide-border-subtle rounded-lg bg-bg-elevated py-3 text-center">
          {(["referred", "converted", "rewarded"] as const).map((k) => (
            <div key={k} className="flex flex-col-reverse gap-0.5 px-2">
              <dt className="text-xs text-text-secondary">{labels[k]}</dt>
              <dd className="text-xl font-semibold text-text-primary tabular-nums">
                {stats[k].toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  )
  return usePart(
    "section",
    "referral-card",
    CARD,
    props,
    { "aria-labelledby": headingId, children },
    { copied },
  )
}

// ---------------------------------------------------------------- onboarding

export type OnboardingStep = {
  key: string
  title: string
  description?: string
}

export type OnboardingChecklistProps = Omit<PartProps<"section">, "defaultValue" | "onChange"> & {
  steps: readonly OnboardingStep[]
  /** Done step keys (controlled), e.g. `(await growth.onboarding(user, keys)).done`. */
  done?: readonly string[]
  defaultDone?: readonly string[]
  onDoneChange?: (done: string[]) => void
  /** A step was chosen: take the user there. */
  onStepSelect?: (step: OnboardingStep) => void
  onDismiss?: () => void
  title?: React.ReactNode
  labels?: Partial<GrowthLabels>
}

/** A progress ring and the steps, the next one highlighted. */
export function OnboardingChecklist({
  steps,
  done: doneProp,
  defaultDone = [],
  onDoneChange,
  onStepSelect,
  onDismiss,
  title,
  labels: labelsProp,
  ...props
}: OnboardingChecklistProps) {
  const labels = useLabels(labelsProp)
  const [done] = useControllableState<readonly string[]>({
    value: doneProp,
    defaultValue: defaultDone,
    onChange: onDoneChange as ((v: readonly string[]) => void) | undefined,
  })
  const headingId = React.useId()
  const count = steps.filter((s) => done.includes(s.key)).length
  const next = steps.find((s) => !done.includes(s.key))
  const pct = steps.length ? count / steps.length : 1
  const R = 16
  const C = 2 * Math.PI * R
  const children = (
    <>
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 40 40" className="size-11 shrink-0 -rotate-90" aria-hidden>
          <circle
            cx="20"
            cy="20"
            r={R}
            fill="none"
            strokeWidth="4"
            className="stroke-bg-elevated"
          />
          <circle
            cx="20"
            cy="20"
            r={R}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            className="stroke-primary transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={headingId} className="text-base font-semibold text-text-primary">
            {next ? (title ?? labels.onboardingTitle) : labels.allDone}
          </h2>
          <span className="text-xs text-text-muted tabular-nums">
            {labels.progress(count, steps.length)}
          </span>
        </div>
        {onDismiss && (
          <Button variant="ghost" size="icon-sm" aria-label={labels.dismiss} onClick={onDismiss}>
            <X aria-hidden />
          </Button>
        )}
      </div>
      <ol className="flex flex-col gap-1">
        {steps.map((s) => {
          const isDone = done.includes(s.key)
          const isNext = s.key === next?.key
          return (
            <li key={s.key}>
              <button
                type="button"
                data-done={isDone || undefined}
                data-next={isNext || undefined}
                aria-current={isNext ? "step" : undefined}
                onClick={() => onStepSelect?.(s)}
                className="group/step flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-bg-elevated focus-visible:ring-3 focus-visible:ring-ring data-next:bg-bg-elevated"
              >
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border-strong text-transparent group-data-done/step:border-primary group-data-done/step:bg-primary group-data-done/step:text-primary-foreground group-data-next/step:border-primary">
                  <Check className="size-3" strokeWidth={3} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-text-primary group-data-done/step:text-text-muted group-data-done/step:line-through">
                    {s.title}
                    {isDone && <span className="sr-only"> ({labels.stepDone})</span>}
                  </span>
                  {s.description && isNext && (
                    <span className="text-xs text-text-secondary">{s.description}</span>
                  )}
                </span>
                {isNext && (
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </>
  )
  return usePart(
    "section",
    "onboarding",
    cn(CARD, "gap-3"),
    props,
    { "aria-labelledby": headingId, children },
    { complete: !next },
  )
}

// ------------------------------------------------------------------ feedback

export type FeedbackInput = { kind: string; message: string; rating: number | null }

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bug: Bug,
  idea: Lightbulb,
  praise: Heart,
  other: MessageCircle,
}

export type FeedbackFormProps = Omit<PartProps<"form">, "onSubmit"> & {
  /** Send it: `growth.sendFeedback({ subject, page, ...input })`. */
  onSubmit: (input: FeedbackInput) => Promise<unknown> | unknown
  /** signet-db `feedbackKinds`. Default bug, idea, praise, other. */
  kinds?: readonly string[]
  /** Ask for 1 to 5 stars too. */
  rating?: boolean
  defaultKind?: string
  labels?: Partial<GrowthLabels>
}

/** Kind, message and optional stars; a thank-you after. */
export function FeedbackForm({
  onSubmit,
  kinds = ["bug", "idea", "praise", "other"],
  rating: withRating = false,
  defaultKind,
  labels: labelsProp,
  ...props
}: FeedbackFormProps) {
  const labels = useLabels(labelsProp)
  const [kind, setKind] = React.useState(defaultKind ?? kinds[0] ?? "other")
  const [message, setMessage] = React.useState("")
  const [stars, setStars] = React.useState<number | null>(null)
  const [state, setState] = React.useState<"idle" | "pending" | "sent" | "error">("idle")
  const kindLabel = React.useId()
  const ratingLabel = React.useId()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return
    setState("pending")
    try {
      await onSubmit({ kind, message: message.trim(), rating: stars })
      setState("sent")
    } catch {
      setState("error")
    }
  }
  const children =
    state === "sent" ? (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-accent-green-subtle text-accent-green">
          <Check className="size-5" aria-hidden />
        </span>
        <Status className="font-medium text-text-primary">{labels.thanks}</Status>
      </div>
    ) : (
      <>
        <span id={kindLabel} className="sr-only">
          {labels.kind}
        </span>
        <RadioGroup
          aria-labelledby={kindLabel}
          value={kind}
          onValueChange={(v: string | null) => v && setKind(v)}
          className="grid grid-cols-4 gap-1.5"
        >
          {kinds.map((k) => {
            const Icon = KIND_ICONS[k] ?? MessageCircle
            return (
              // biome-ignore lint/a11y/noLabelWithoutControl: the radio (a button) is inside the label
              <label
                key={k}
                data-kind={k}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-lg px-1 py-2 text-xs text-text-muted ring-1 ring-border-default transition-colors hover:text-text-primary has-data-checked:bg-primary/10 has-data-checked:text-text-primary has-data-checked:ring-primary [&:has([data-checked])_svg]:text-primary has-focus-visible:ring-3 has-focus-visible:ring-ring"
              >
                <RadioGroupItem value={k} className="sr-only" />
                <Icon className="size-4" />
                {labels.kinds[k] ?? k}
              </label>
            )
          })}
        </RadioGroup>
        <Field className="gap-1.5">
          <FieldLabel className="sr-only">{labels.message}</FieldLabel>
          <FieldControl
            render={<Textarea rows={4} className="min-h-24 resize-none" />}
            placeholder={labels.messagePlaceholder}
            value={message}
            required
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMessage(e.target.value)}
          />
        </Field>
        {withRating && (
          <>
            <span id={ratingLabel} className="sr-only">
              {labels.rating}
            </span>
            <RadioGroup
              aria-labelledby={ratingLabel}
              value={stars === null ? null : String(stars)}
              onValueChange={(v: string | null) => setStars(v ? Number(v) : null)}
              className="flex gap-0.5"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                // biome-ignore lint/a11y/noLabelWithoutControl: the radio (a button) is inside the label
                <label
                  key={n}
                  data-on={stars !== null && n <= stars ? true : undefined}
                  className="cursor-pointer rounded-md p-0.5 text-text-hint transition-colors hover:text-accent-amber has-focus-visible:ring-3 has-focus-visible:ring-ring data-on:text-accent-amber"
                >
                  <RadioGroupItem
                    value={String(n)}
                    className="sr-only"
                    aria-label={labels.stars(n)}
                  />
                  <Star className="size-5 fill-current" aria-hidden />
                </label>
              ))}
            </RadioGroup>
          </>
        )}
        {state === "error" && (
          <Status className="text-sm text-accent-red">{labels.feedbackError}</Status>
        )}
        <Button type="submit" disabled={state === "pending" || !message.trim()}>
          {state === "pending" ? labels.sending : labels.send}
        </Button>
      </>
    )
  return usePart(
    "form",
    "feedback-form",
    "flex flex-col gap-3",
    props,
    {
      onSubmit: submit,
      noValidate: true,
      "aria-label": labels.feedbackTitle,
      children,
    },
    { state },
  )
}

export type FeedbackWidgetProps = FeedbackFormProps & {
  /** Popover open state (controlled). */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Replaces the trigger button. */
  trigger?: React.ReactElement
  contentClassName?: string
}

/** A "Feedback" button that opens the form in a popover. */
export function FeedbackWidget({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  trigger,
  contentClassName,
  labels: labelsProp,
  ...props
}: FeedbackWidgetProps) {
  const labels = useLabels(labelsProp)
  const [open, setOpen] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  const titleId = React.useId()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="outline" data-slot="feedback-trigger">
            <MessageSquarePlus data-icon="inline-start" aria-hidden />
            {labels.feedback}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn("w-80", contentClassName)}
        aria-labelledby={titleId}
      >
        <p id={titleId} className="mb-3 text-sm font-semibold text-text-primary">
          {labels.feedbackTitle}
        </p>
        <FeedbackForm {...props} labels={labelsProp ?? {}} />
      </PopoverContent>
    </Popover>
  )
}

// ----------------------------------------------------------------- changelog

export type ChangelogEntry = {
  id: string
  date: Date | string
  title: string
  body?: React.ReactNode
  /** A short tag, like "New" or "Fix". */
  tag?: string
  href?: string
}

export type WhatsNewProps = {
  /** Every entry, newest first. */
  entries: readonly ChangelogEntry[]
  /** How many are unseen: `(await growth.unseenChangelog(user, entries)).entries.length`. */
  unseen?: number
  /** Opened: mark seen, `growth.markChangelogSeen(user)`. */
  onOpen?: () => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactElement
  className?: string
  contentClassName?: string
  labels?: Partial<GrowthLabels>
}

/** A button with an unseen count; opens the latest changes. */
export function WhatsNew({
  entries,
  unseen = 0,
  onOpen,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  trigger,
  className,
  contentClassName,
  labels: labelsProp,
}: WhatsNewProps) {
  const labels = useLabels(labelsProp)
  const [open, setOpen] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: (o: boolean) => {
      if (o) onOpen?.()
      onOpenChange?.(o)
    },
  })
  const headingId = React.useId()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            data-slot="whats-new-trigger"
            data-unseen={unseen > 0 || undefined}
            className={cn("relative", className)}
          >
            <Sparkles data-icon="inline-start" aria-hidden />
            {labels.whatsNew}
            {unseen > 0 && (
              <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs leading-none text-primary-foreground tabular-nums">
                <span aria-hidden>{unseen}</span>
                <span className="sr-only">, {labels.newCount(unseen)}</span>
              </span>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn("w-80 p-0", contentClassName)}
        aria-labelledby={headingId}
      >
        <p
          id={headingId}
          className="border-b border-border-subtle px-4 py-3 text-sm font-semibold text-text-primary"
        >
          {labels.whatsNew}
        </p>
        {entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{labels.noNews}</p>
        ) : (
          <ol
            data-slot="whats-new"
            className="max-h-96 divide-y divide-border-subtle overflow-y-auto"
          >
            {entries.map((e, i) => (
              <li
                key={e.id}
                data-unseen={i < unseen || undefined}
                className="group/entry relative flex flex-col gap-1 px-4 py-3"
              >
                <span className="flex items-center gap-2 text-xs text-text-muted">
                  {i < unseen && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
                  <time dateTime={new Date(e.date).toISOString()}>{dateText(e.date)}</time>
                  {e.tag && (
                    <Badge variant="secondary" className="h-4 px-1.5">
                      {e.tag}
                    </Badge>
                  )}
                </span>
                <span className="text-sm font-medium text-text-primary">{e.title}</span>
                {e.body && <div className="text-sm text-text-secondary">{e.body}</div>}
                {e.href && (
                  <a
                    href={e.href}
                    aria-label={labels.readMoreAbout(e.title)}
                    className="w-fit rounded-sm text-xs font-medium text-text-primary underline underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
                  >
                    {labels.readMore}
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  )
}
