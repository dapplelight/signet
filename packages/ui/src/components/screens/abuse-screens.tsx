"use client"

// Abuse kit screens: a bot-check widget that loads Cloudflare Turnstile or
// hCaptcha and hands back a token for signet-server's requireCaptcha, and the
// admin AI spend screen on signet-server's aiSpendAdminRoutes (spend against
// caps today and this month, the biggest spenders, and setting caps). Data
// comes in as props shaped like those routes' JSON; actions go out as
// callbacks, so any client fits.
// Recipe: controllable-state + field-wiring + live-region
import { Trash2 } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import { Input } from "../ui/input.js"
import { Progress } from "../ui/progress.js"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.js"

// ------------------------------------------------------------------- captcha

export type CaptchaProvider = "turnstile" | "hcaptcha" | "test"

/** The token signet-server's test-mode verifier accepts. */
export const CAPTCHA_TEST_PASS = "signet-captcha-test-pass"

export const CAPTCHA_SCRIPTS = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  hcaptcha: "https://js.hcaptcha.com/1/api.js?render=explicit",
} as const

type WidgetApi = {
  render(el: HTMLElement, opts: Record<string, unknown>): string | number
  remove?(id: string | number): void
  reset?(id?: string | number): void
}

const loads = new Map<string, Promise<void>>()
/** Adds the provider's script once per page; resolves when it has run. */
function loadScript(src: string, global: string): Promise<void> {
  if ((window as unknown as Record<string, unknown>)[global]) return Promise.resolve()
  let p = loads.get(src)
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script")
      s.src = src
      s.async = true
      s.defer = true
      s.onload = () => resolve()
      s.onerror = () => {
        loads.delete(src)
        reject(new Error(`Could not load ${src}`))
      }
      document.head.appendChild(s)
    })
    loads.set(src, p)
  }
  return p
}

export const DEFAULT_CAPTCHA_LABELS = {
  test: "Bot check (test mode): passed",
  failed: "The bot check could not load. Refresh and try again.",
}

export type CaptchaWidgetProps = Omit<React.ComponentProps<"div">, "onError"> & {
  provider: CaptchaProvider
  /** The provider's public site key. Not needed in test mode. */
  siteKey?: string
  /** The token to send with the form (header `x-captcha-token` or field `captchaToken`); null when it expires. */
  onToken: (token: string | null) => void
  onError?: (error: unknown) => void
  theme?: "light" | "dark" | "auto"
  /** Turnstile: the action the server's verifier expects. */
  action?: string
  /** Load the script from here instead (a self-hosted copy, a CSP-approved proxy). */
  scriptSrc?: string
  labels?: Partial<typeof DEFAULT_CAPTCHA_LABELS>
}

/**
 * Renders the provider's widget and reports its token. `provider="test"`
 * loads nothing and reports `CAPTCHA_TEST_PASS` at once, for local
 * development and tests against signet-server's test-mode verifier.
 */
export function CaptchaWidget({
  provider,
  siteKey,
  onToken,
  onError,
  theme,
  action,
  scriptSrc,
  labels: labelsProp,
  className,
  ...props
}: CaptchaWidgetProps) {
  const labels = { ...DEFAULT_CAPTCHA_LABELS, ...labelsProp }
  const ref = React.useRef<HTMLDivElement>(null)
  const [failed, setFailed] = React.useState(false)
  // Callbacks in refs, so a parent re-render does not re-create the widget.
  const cb = React.useRef({ onToken, onError })
  cb.current = { onToken, onError }

  React.useEffect(() => {
    if (provider === "test") {
      cb.current.onToken(CAPTCHA_TEST_PASS)
      return
    }
    let cancelled = false
    let id: string | number | undefined
    let api: WidgetApi | undefined
    loadScript(scriptSrc ?? CAPTCHA_SCRIPTS[provider], provider)
      .then(() => {
        api = (window as unknown as Record<string, WidgetApi | undefined>)[provider]
        if (cancelled || !ref.current) return
        if (!api) throw new Error(`${provider} did not load`)
        id = api.render(ref.current, {
          sitekey: siteKey,
          callback: (token: string) => cb.current.onToken(token),
          "expired-callback": () => cb.current.onToken(null),
          "error-callback": (e: unknown) => {
            cb.current.onToken(null)
            cb.current.onError?.(e)
          },
          ...(theme ? { theme } : {}),
          ...(action && provider === "turnstile" ? { action } : {}),
        })
      })
      .catch((e) => {
        if (cancelled) return
        setFailed(true)
        cb.current.onError?.(e)
      })
    return () => {
      cancelled = true
      if (id !== undefined) api?.remove?.(id)
    }
  }, [provider, siteKey, theme, action, scriptSrc])

  return (
    <div
      data-slot="captcha"
      data-provider={provider}
      className={cn("min-h-[65px]", className)}
      {...props}
    >
      {provider === "test" ? (
        <p className="text-sm text-text-muted">{labels.test}</p>
      ) : (
        <div ref={ref} />
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {labels.failed}
        </p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ AI spend

export type SpendScope = "user" | "org" | "global"
export type SpendPeriod = "day" | "month"

/** One period from signet-db `usage(...)`, or its JSON. */
export type PeriodUsage = { used: number; cap: number | null; remaining: number | null }
/** signet-db `SubjectUsage`, or its JSON. */
export type SubjectUsage = {
  scope: SpendScope
  subject: string
  day: PeriodUsage
  month: PeriodUsage
}
export type TopSpender = { subject: string; used: number; cap: number | null }
/** `GET /usage` from aiSpendAdminRoutes. */
export type AiSpendOverview = {
  global: SubjectUsage
  top: { users: readonly TopSpender[]; orgs: readonly TopSpender[] }
}
/** A row of `GET /caps`. */
export type AiSpendCap = {
  id: string
  scope: SpendScope
  subject: string
  period: SpendPeriod
  units: number | null
  updatedBy?: string | null
}
export type AiSpendCapInput = {
  scope: SpendScope
  subject: string
  period: SpendPeriod
  units: number | null
}

/** Cost units per US dollar (signet-db's `UNITS_PER_USD`). */
export const UNITS_PER_USD = 1_000_000

/** `$0.0123` from cost units. */
export const formatUnits = (units: number) =>
  `$${(units / UNITS_PER_USD).toLocaleString(undefined, { maximumFractionDigits: 4 })}`

export const DEFAULT_AI_SPEND_LABELS = {
  title: "AI spend",
  today: "Today",
  month: "This month",
  of: (cap: string) => `of ${cap}`,
  unlimited: "No cap",
  topUsers: "Top users this month",
  topOrgs: "Top orgs this month",
  subject: "Who",
  spent: "Spent",
  cap: "Cap",
  nobody: "No spend yet",
  caps: "Caps",
  noCaps: "No caps set here; the app's defaults apply",
  everyone: "Everyone",
  scope: { user: "User", org: "Org", global: "Global" } as Record<SpendScope, string>,
  period: { day: "Daily", month: "Monthly" } as Record<SpendPeriod, string>,
  remove: (c: AiSpendCap) => `Remove the ${c.period} cap for ${c.subject}`,
  setCap: "Set a cap",
  subjectField: "User or org id (blank: everyone)",
  amountField: "Cap in USD (blank: unlimited)",
  save: "Save cap",
  saving: "Saving…",
  saved: "Cap saved",
  failed: "Could not save. Check the values and try again.",
  badAmount: "Enter an amount of 0 or more, or leave it blank.",
}

export type AiSpendLabels = typeof DEFAULT_AI_SPEND_LABELS

function Meter({
  label,
  usage,
  labels,
  format,
}: {
  label: string
  usage: PeriodUsage
  labels: AiSpendLabels
  format: (u: number) => string
}) {
  const over = usage.cap !== null && usage.used >= usage.cap
  return (
    <div data-slot="spend-meter" data-over={over || undefined} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-text-muted">{label}</span>
        <span className="text-sm tabular-nums">
          {format(usage.used)}{" "}
          <span className="text-text-muted">
            {usage.cap === null ? labels.unlimited : labels.of(format(usage.cap))}
          </span>
        </span>
      </div>
      {usage.cap !== null && (
        <Progress
          aria-label={label}
          value={usage.cap === 0 ? 100 : Math.min(100, (usage.used / usage.cap) * 100)}
        />
      )}
    </div>
  )
}

function Spenders({
  title,
  rows,
  labels,
  format,
  slot,
}: {
  title: string
  rows: readonly TopSpender[]
  labels: AiSpendLabels
  format: (u: number) => string
  slot: string
}) {
  return (
    <section data-slot={slot} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{labels.nobody}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.subject}</TableHead>
              <TableHead className="text-right">{labels.spent}</TableHead>
              <TableHead className="text-right">{labels.cap}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.subject} data-subject={r.subject}>
                <TableCell className="font-mono">{r.subject}</TableCell>
                <TableCell className="text-right tabular-nums">{format(r.used)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.cap === null ? (
                    labels.unlimited
                  ) : (
                    <span className={cn(r.used >= r.cap && "text-destructive")}>
                      {format(r.cap)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring dark:bg-input/30"

function CapForm({
  labels,
  onSetCap,
}: {
  labels: AiSpendLabels
  onSetCap: (input: AiSpendCapInput) => unknown
}) {
  const [scope, setScope] = React.useState<SpendScope>("user")
  const [period, setPeriod] = React.useState<SpendPeriod>("day")
  const [subject, setSubject] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [phase, setPhase] = React.useState<"idle" | "pending" | "done" | "failed" | "bad">("idle")
  const id = React.useId()
  return (
    <form
      data-slot="cap-form"
      className="grid gap-2 sm:grid-cols-5 sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault()
        const usd = amount.trim() === "" ? null : Number(amount)
        if (usd !== null && !(Number.isFinite(usd) && usd >= 0)) return setPhase("bad")
        setPhase("pending")
        try {
          const worked =
            (await onSetCap({
              scope,
              subject: scope === "global" ? "*" : subject.trim() || "*",
              period,
              units: usd === null ? null : Math.round(usd * UNITS_PER_USD),
            })) !== false
          setPhase(worked ? "done" : "failed")
        } catch {
          setPhase("failed")
        }
      }}
    >
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}s`}>
        {labels.scope.user} / {labels.scope.org}
        <select
          id={`${id}s`}
          name="scope"
          className={selectClass}
          value={scope}
          onChange={(e) => setScope(e.target.value as SpendScope)}
        >
          {(["user", "org", "global"] as const).map((s) => (
            <option key={s} value={s}>
              {labels.scope[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2" htmlFor={`${id}w`}>
        {labels.subjectField}
        <Input
          id={`${id}w`}
          name="subject"
          value={scope === "global" ? "" : subject}
          disabled={scope === "global"}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}p`}>
        {labels.cap}
        <select
          id={`${id}p`}
          name="period"
          className={selectClass}
          value={period}
          onChange={(e) => setPeriod(e.target.value as SpendPeriod)}
        >
          {(["day", "month"] as const).map((p) => (
            <option key={p} value={p}>
              {labels.period[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}a`}>
        {labels.amountField}
        <Input
          id={`${id}a`}
          name="amount"
          inputMode="decimal"
          value={amount}
          aria-invalid={phase === "bad" || undefined}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-3 sm:col-span-5">
        <Button type="submit" disabled={phase === "pending"}>
          {phase === "pending" ? labels.saving : labels.save}
        </Button>
        <p aria-live="polite" className="text-sm text-text-muted">
          {phase === "done"
            ? labels.saved
            : phase === "failed"
              ? labels.failed
              : phase === "bad"
                ? labels.badAmount
                : ""}
        </p>
      </div>
    </form>
  )
}

export type AiSpendAdminProps = React.ComponentProps<"div"> & {
  overview: AiSpendOverview
  caps: readonly AiSpendCap[]
  /** `PUT /caps`. Without it the screen is read-only. Return false (or throw) to show the failure. */
  onSetCap?: (input: AiSpendCapInput) => unknown
  /** `DELETE /caps/:scope/:subject/:period`. */
  onRemoveCap?: (cap: AiSpendCap) => unknown
  /** How cost units read. Default US dollars. */
  format?: (units: number) => string
  labels?: Partial<AiSpendLabels>
}

/** The admin AI spend screen: global spend against caps, top spenders, and the caps themselves. */
export function AiSpendAdmin({
  overview,
  caps,
  onSetCap,
  onRemoveCap,
  format = formatUnits,
  labels: labelsProp,
  className,
  ...props
}: AiSpendAdminProps) {
  const labels = React.useMemo(() => ({ ...DEFAULT_AI_SPEND_LABELS, ...labelsProp }), [labelsProp])
  return (
    <div data-slot="ai-spend-admin" className={cn("flex flex-col gap-6", className)} {...props}>
      <section data-slot="spend-global" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{labels.title}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Meter label={labels.today} usage={overview.global.day} labels={labels} format={format} />
          <Meter
            label={labels.month}
            usage={overview.global.month}
            labels={labels}
            format={format}
          />
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Spenders
          slot="spend-top-users"
          title={labels.topUsers}
          rows={overview.top.users}
          labels={labels}
          format={format}
        />
        <Spenders
          slot="spend-top-orgs"
          title={labels.topOrgs}
          rows={overview.top.orgs}
          labels={labels}
          format={format}
        />
      </div>
      <section data-slot="spend-caps" className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{labels.caps}</h3>
        {caps.length === 0 ? (
          <p className="text-sm text-text-muted">{labels.noCaps}</p>
        ) : (
          <Table>
            <TableBody>
              {caps.map((c) => (
                <TableRow key={c.id} data-cap={c.id}>
                  <TableCell>
                    <Badge variant="secondary">{labels.scope[c.scope] ?? c.scope}</Badge>
                  </TableCell>
                  <TableCell className="font-mono">
                    {c.subject === "*" ? labels.everyone : c.subject}
                  </TableCell>
                  <TableCell>{labels.period[c.period] ?? c.period}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.units === null ? labels.unlimited : format(c.units)}
                  </TableCell>
                  <TableCell className="w-0">
                    {onRemoveCap && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={labels.remove(c)}
                        onClick={() => onRemoveCap(c)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {onSetCap && (
          <>
            <h3 className="mt-2 text-sm font-medium">{labels.setCap}</h3>
            <CapForm labels={labels} onSetCap={onSetCap} />
          </>
        )}
      </section>
    </div>
  )
}
