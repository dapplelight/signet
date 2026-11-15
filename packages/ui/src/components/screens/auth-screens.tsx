"use client"

// Sign-in and sign-up screens: a one-time code by email or phone, OAuth
// buttons, the code step, and a session-expired screen. Data in, callbacks
// out: wire `onRequestCode` and `onVerify` to signet-server's OTP routes (or
// better-auth) through `createRpcClient`. A callback that throws shows its
// message; one that returns a Promise keeps the button pending until it settles.
// Recipe: controllable-state + roving-focus + field-wiring + live-region
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { ClockIcon, MailIcon, PhoneIcon } from "lucide-react"
import * as React from "react"
import { useControllableState } from "../../behaviors/index.js"
import { cn } from "../../lib/utils.js"
import { Button } from "../ui/button.js"
import { Field, FieldControl, FieldLabel } from "../ui/field.js"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../ui/input-otp.js"
import { Spinner } from "../ui/spinner.js"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js"

export type AuthMode = "sign-in" | "sign-up"
export type AuthChannel = "email" | "phone"

export type OAuthProvider = {
  id: string
  /** Shown as "Continue with {label}". */
  label: string
  /** The provider's mark. Signet ships none: bring your own. */
  icon?: React.ReactNode
}

/** Every string the auth screens show. Spread it and override what you need. */
export const DEFAULT_AUTH_LABELS = {
  signInTitle: "Welcome back",
  signUpTitle: "Create your account",
  email: "Email",
  phone: "Phone",
  emailPlaceholder: "you@example.com",
  phonePlaceholder: "+91 98765 43210",
  channels: "Sign in with",
  sendCode: "Send code",
  or: "or",
  continueWith: (provider: string) => `Continue with ${provider}`,
  toSignUp: "New here?",
  signUp: "Create account",
  toSignIn: "Have an account?",
  signIn: "Sign in",
  verifyTitle: "Check your inbox",
  verifyPhoneTitle: "Check your messages",
  sentTo: (to: string) => `Code sent to ${to}`,
  code: "One-time code",
  verify: "Verify",
  resend: "Resend code",
  resendIn: (seconds: number) => `Resend in ${seconds}s`,
  change: "Change",
  expiredTitle: "Session expired",
  expiredDescription: "Sign in again to pick up where you left off.",
  expiredAction: "Sign in again",
  error: "Something went wrong. Try again.",
}

export type AuthLabels = typeof DEFAULT_AUTH_LABELS

/** Runs an async callback, tracking pending and the thrown message. */
function useAction<A extends unknown[]>(
  fn: ((...args: A) => unknown) | undefined,
  fallback: string,
) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const run = async (...args: A): Promise<boolean> => {
    if (!fn) return false
    setPending(true)
    setError(null)
    try {
      await fn(...args)
      return true
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : fallback)
      return false
    } finally {
      setPending(false)
    }
  }
  return { pending, error, run, setError }
}

// --- parts -------------------------------------------------------------------

/** The centred card every auth screen sits in. `render` swaps its element. */
function AuthCard({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">(
      {
        className: cn(
          "mx-auto flex w-full max-w-sm flex-col gap-6 rounded-xl bg-bg-surface p-6 text-sm text-text-primary ring-1 ring-foreground/10",
          className,
        ),
      },
      props,
    ),
    state: { slot: "auth-card" },
  })
}

type AuthHeaderProps = Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  /** An icon or your logo, above the title. */
  icon?: React.ReactNode
}

function AuthHeader({ title, description, icon, className, ...props }: AuthHeaderProps) {
  return (
    <div
      data-slot="auth-header"
      className={cn("flex flex-col items-center gap-2 text-center", className)}
      {...props}
    >
      {icon ? (
        <div
          data-slot="auth-icon"
          className="flex size-10 items-center justify-center rounded-full bg-bg-elevated text-text-secondary [&_svg]:size-5"
        >
          {icon}
        </div>
      ) : null}
      <h1 className="text-lg leading-tight font-medium">{title}</h1>
      {description ? <p className="text-text-muted">{description}</p> : null}
    </div>
  )
}

/** A live error line: announced when it appears, nothing rendered when empty. */
function AuthError({ className, children, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="auth-error"
      role="alert"
      className={cn("text-center text-sm text-destructive empty:hidden", className)}
      {...props}
    >
      {children}
    </p>
  )
}

type OAuthButtonsProps = Omit<React.ComponentProps<"div">, "onSelect"> & {
  providers: readonly OAuthProvider[]
  /** May redirect away; a returned Promise keeps that button pending. */
  onSelect: (provider: OAuthProvider) => unknown
  labels?: Partial<AuthLabels>
}

function OAuthButtons({ providers, onSelect, labels, className, ...props }: OAuthButtonsProps) {
  const l = { ...DEFAULT_AUTH_LABELS, ...labels }
  const [busy, setBusy] = React.useState<string | null>(null)
  const action = useAction(onSelect, l.error)
  if (!providers.length) return null
  return (
    <div data-slot="oauth-buttons" className={cn("flex flex-col gap-2", className)} {...props}>
      {providers.map((p) => (
        <Button
          key={p.id}
          type="button"
          variant="outline"
          size="lg"
          data-provider={p.id}
          disabled={action.pending}
          onClick={async () => {
            setBusy(p.id)
            await action.run(p)
            setBusy(null)
          }}
        >
          {busy === p.id ? <Spinner /> : p.icon}
          {l.continueWith(p.label)}
        </Button>
      ))}
      <AuthError>{action.error}</AuthError>
    </div>
  )
}

function AuthDivider({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="auth-divider"
      className={cn(
        "flex items-center gap-3 text-xs text-text-hint before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

type CodeRequestFormProps = Omit<React.ComponentProps<"form">, "onSubmit"> & {
  channel: AuthChannel
  /** Send the code. The address goes on to the verify step once this resolves. */
  onSubmit: (to: string) => unknown
  defaultValue?: string
  labels?: Partial<AuthLabels>
}

/** One field (email or phone) and a send button. */
function CodeRequestForm({
  channel,
  onSubmit,
  defaultValue,
  labels,
  className,
  ...props
}: CodeRequestFormProps) {
  const l = { ...DEFAULT_AUTH_LABELS, ...labels }
  const [value, setValue] = React.useState(defaultValue ?? "")
  const action = useAction(onSubmit, l.error)
  const email = channel === "email"
  return (
    <form
      data-slot="code-request-form"
      data-channel={channel}
      noValidate
      className={cn("flex flex-col gap-3", className)}
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) void action.run(value.trim())
      }}
      {...props}
    >
      <Field invalid={action.error ? true : undefined}>
        <FieldLabel>{email ? l.email : l.phone}</FieldLabel>
        <FieldControl
          type={email ? "email" : "tel"}
          inputMode={email ? "email" : "tel"}
          autoComplete={email ? "email" : "tel"}
          placeholder={email ? l.emailPlaceholder : l.phonePlaceholder}
          required
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
          className="h-10"
        />
      </Field>
      <Button type="submit" size="lg" disabled={action.pending || !value.trim()}>
        {action.pending ? <Spinner aria-label={l.sendCode} /> : null}
        {l.sendCode}
      </Button>
      <AuthError>{action.error}</AuthError>
    </form>
  )
}

type VerifyCodeFormProps = Omit<React.ComponentProps<"form">, "onSubmit"> & {
  onVerify: (code: string) => unknown
  onResend?: () => unknown
  /** Seconds before "Resend" unlocks. Default 30; 0 unlocks at once. */
  resendAfterSeconds?: number
  /** Digits in the code. Default 6, signet-server's default. */
  length?: number
  labels?: Partial<AuthLabels>
}

/** The code slots, submitted when full or with the button, and a resend timer. */
function VerifyCodeForm({
  onVerify,
  onResend,
  resendAfterSeconds = 30,
  length = 6,
  labels,
  className,
  ...props
}: VerifyCodeFormProps) {
  const l = { ...DEFAULT_AUTH_LABELS, ...labels }
  const [code, setCode] = React.useState("")
  const [wait, setWait] = React.useState(resendAfterSeconds)
  const verify = useAction(onVerify, l.error)
  const resend = useAction(onResend, l.error)
  React.useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])
  const submit = async (value: string) => {
    if (value.length === length && !(await verify.run(value))) setCode("")
  }
  const error = verify.error ?? resend.error
  return (
    <form
      data-slot="verify-code-form"
      data-invalid={verify.error ? "" : undefined}
      className={cn("flex flex-col items-center gap-4", className)}
      onSubmit={(e) => {
        e.preventDefault()
        void submit(code)
      }}
      {...props}
    >
      <InputOTP
        maxLength={length}
        value={code}
        onChange={setCode}
        onComplete={submit}
        inputMode="numeric"
        pattern="^[0-9]*$"
        autoComplete="one-time-code"
        aria-label={l.code}
        aria-invalid={verify.error ? true : undefined}
        disabled={verify.pending}
        autoFocus
      >
        <InputOTPGroup>
          {Array.from({ length }, (_, i) => (
            <InputOTPSlot key={i} index={i} className="size-10 text-base" />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <AuthError>{error}</AuthError>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={verify.pending || code.length < length}
      >
        {verify.pending ? <Spinner aria-label={l.verify} /> : null}
        {l.verify}
      </Button>
      {onResend ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          data-slot="resend"
          disabled={wait > 0 || resend.pending}
          onClick={async () => {
            if (await resend.run()) setWait(resendAfterSeconds)
          }}
        >
          {wait > 0 ? (
            <>
              <ClockIcon aria-hidden />
              <span className="tabular-nums">{l.resendIn(wait)}</span>
            </>
          ) : (
            l.resend
          )}
        </Button>
      ) : null}
    </form>
  )
}

// --- screens -----------------------------------------------------------------

export type CodeRequest = { channel: AuthChannel; to: string; mode: AuthMode }

type AuthScreenProps = {
  /** "sign-in" or "sign-up", controlled. */
  mode?: AuthMode
  defaultMode?: AuthMode
  onModeChange?: (mode: AuthMode) => void
  /** Which code channels to offer, in order. Default both. Empty for OAuth only. */
  channels?: readonly AuthChannel[]
  /** Selected channel, controlled. */
  channel?: AuthChannel
  defaultChannel?: AuthChannel
  onChannelChange?: (channel: AuthChannel) => void
  /** Send a code. Throw to show an error (an `ApiError`'s message is shown). */
  onRequestCode?: (request: CodeRequest) => unknown
  /** Check the code and start the session. */
  onVerify?: (request: CodeRequest & { code: string }) => unknown
  providers?: readonly OAuthProvider[]
  onOAuth?: (provider: OAuthProvider, mode: AuthMode) => unknown
  /** Shown above the title: your logo. */
  logo?: React.ReactNode
  /** Under the form: terms, a privacy link. */
  footer?: React.ReactNode
  codeLength?: number
  resendAfterSeconds?: number
  /** Hide the "New here? / Have an account?" switch. */
  hideModeSwitch?: boolean
  labels?: Partial<AuthLabels>
  className?: string
  classNames?: Partial<
    Record<"card" | "header" | "oauth" | "divider" | "tabs" | "form" | "verify" | "footer", string>
  >
}

/** Sign in or sign up with an email or phone code, or OAuth, then verify the code. */
function AuthScreen({
  mode: modeProp,
  defaultMode = "sign-in",
  onModeChange,
  channels = ["email", "phone"],
  channel: channelProp,
  defaultChannel,
  onChannelChange,
  onRequestCode,
  onVerify,
  providers = [],
  onOAuth,
  logo,
  footer,
  codeLength,
  resendAfterSeconds,
  hideModeSwitch,
  labels,
  className,
  classNames = {},
}: AuthScreenProps) {
  const l = { ...DEFAULT_AUTH_LABELS, ...labels }
  const [mode, setMode] = useControllableState({
    value: modeProp,
    defaultValue: defaultMode,
    onChange: onModeChange,
  })
  const [channel, setChannel] = useControllableState<AuthChannel>({
    value: channelProp,
    defaultValue: defaultChannel ?? channels[0] ?? "email",
    onChange: onChannelChange,
  })
  const [sent, setSent] = React.useState<CodeRequest | null>(null)

  if (sent) {
    return (
      <AuthCard data-step="verify" data-mode={mode} className={cn(className, classNames.card)}>
        <AuthHeader
          icon={logo ?? (sent.channel === "email" ? <MailIcon /> : <PhoneIcon />)}
          title={sent.channel === "email" ? l.verifyTitle : l.verifyPhoneTitle}
          description={
            <>
              {l.sentTo(sent.to)}{" "}
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setSent(null)}>
                {l.change}
              </Button>
            </>
          }
          className={classNames.header}
        />
        <VerifyCodeForm
          length={codeLength}
          resendAfterSeconds={resendAfterSeconds}
          onVerify={(code) => onVerify?.({ ...sent, code })}
          onResend={onRequestCode ? () => onRequestCode(sent) : undefined}
          labels={labels}
          className={classNames.verify}
        />
      </AuthCard>
    )
  }

  const request = (c: AuthChannel) => async (to: string) => {
    const req = { channel: c, to, mode }
    await onRequestCode?.(req)
    setSent(req)
  }
  const form = (c: AuthChannel) => (
    <CodeRequestForm
      key={c}
      channel={c}
      onSubmit={request(c)}
      labels={labels}
      className={classNames.form}
    />
  )

  return (
    <AuthCard data-step="request" data-mode={mode} className={cn(className, classNames.card)}>
      <AuthHeader
        icon={logo}
        title={mode === "sign-in" ? l.signInTitle : l.signUpTitle}
        className={classNames.header}
      />
      {providers.length ? (
        <OAuthButtons
          providers={providers}
          onSelect={(p) => onOAuth?.(p, mode)}
          labels={labels}
          className={classNames.oauth}
        />
      ) : null}
      {providers.length && channels.length ? (
        <AuthDivider className={classNames.divider}>{l.or}</AuthDivider>
      ) : null}
      {channels.length > 1 ? (
        <Tabs
          value={channel}
          onValueChange={(v) => setChannel(v as AuthChannel)}
          className={cn("gap-4", classNames.tabs)}
        >
          <TabsList aria-label={l.channels} className="w-full">
            {channels.map((c) => (
              <TabsTrigger key={c} value={c}>
                {c === "email" ? <MailIcon aria-hidden /> : <PhoneIcon aria-hidden />}
                {c === "email" ? l.email : l.phone}
              </TabsTrigger>
            ))}
          </TabsList>
          {channels.map((c) => (
            <TabsContent key={c} value={c}>
              {form(c)}
            </TabsContent>
          ))}
        </Tabs>
      ) : channels[0] ? (
        form(channels[0])
      ) : null}
      {hideModeSwitch ? null : (
        <p data-slot="auth-mode-switch" className="text-center text-text-muted">
          {mode === "sign-in" ? l.toSignUp : l.toSignIn}{" "}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          >
            {mode === "sign-in" ? l.signUp : l.signIn}
          </Button>
        </p>
      )}
      {footer ? (
        <div
          data-slot="auth-footer"
          className={cn("text-center text-xs text-text-hint", classNames.footer)}
        >
          {footer}
        </div>
      ) : null}
    </AuthCard>
  )
}

type VerifyCodeScreenProps = Omit<VerifyCodeFormProps, "className"> & {
  channel?: AuthChannel
  /** Where the code went, shown masked as you pass it ("+91******3210"). */
  to?: string
  /** Shows a "Change" link back to the previous step. */
  onBack?: () => void
  logo?: React.ReactNode
  className?: string
  classNames?: Partial<Record<"card" | "header" | "form", string>>
}

/** The code step on its own, for apps that route it separately. */
function VerifyCodeScreen({
  channel = "email",
  to,
  onBack,
  logo,
  labels,
  className,
  classNames = {},
  ...form
}: VerifyCodeScreenProps) {
  const l = { ...DEFAULT_AUTH_LABELS, ...labels }
  return (
    <AuthCard data-step="verify" className={cn(className, classNames.card)}>
      <AuthHeader
        icon={logo ?? (channel === "email" ? <MailIcon /> : <PhoneIcon />)}
        title={channel === "email" ? l.verifyTitle : l.verifyPhoneTitle}
        description={
          to || onBack ? (
            <>
              {to ? l.sentTo(to) : null}{" "}
              {onBack ? (
                <Button variant="link" size="sm" className="h-auto p-0" onClick={onBack}>
                  {l.change}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
        className={classNames.header}
      />
      <VerifyCodeForm labels={labels} className={classNames.form} {...form} />
    </AuthCard>
  )
}

type SessionExpiredScreenProps = {
  onSignIn: () => unknown
  logo?: React.ReactNode
  labels?: Partial<AuthLabels>
  className?: string
  classNames?: Partial<Record<"card" | "header" | "action", string>>
}

/** Shown when the session ended (a 401 `AuthError` from the typed client). */
function SessionExpiredScreen({
  onSignIn,
  logo,
  labels,
  className,
  classNames = {},
}: SessionExpiredScreenProps) {
  const l = { ...DEFAULT_AUTH_LABELS, ...labels }
  return (
    <AuthCard data-step="expired" className={cn(className, classNames.card)}>
      <AuthHeader
        icon={logo ?? <ClockIcon />}
        title={l.expiredTitle}
        description={l.expiredDescription}
        className={classNames.header}
      />
      <Button size="lg" className={classNames.action} onClick={() => onSignIn()} autoFocus>
        {l.expiredAction}
      </Button>
    </AuthCard>
  )
}

export type {
  AuthHeaderProps,
  AuthScreenProps,
  CodeRequestFormProps,
  OAuthButtonsProps,
  SessionExpiredScreenProps,
  VerifyCodeFormProps,
  VerifyCodeScreenProps,
}
export {
  AuthCard,
  AuthDivider,
  AuthError,
  AuthHeader,
  AuthScreen,
  CodeRequestForm,
  OAuthButtons,
  SessionExpiredScreen,
  VerifyCodeForm,
  VerifyCodeScreen,
}
