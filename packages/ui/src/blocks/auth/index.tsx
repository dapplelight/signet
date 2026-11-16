"use client"

// Block: sign-in, sign-up and one-time-code screens. A thin page around
// AuthScreen (request a code, or continue with OAuth) and VerifyCodeScreen (the
// code step on its own, for apps that route it separately). Back-end calls come
// in as callbacks: wire `onRequestCode` and `onVerify` to your auth routes
// through signet-lib's `createRpcClient`. A callback that throws shows its
// message; one that returns a Promise keeps its button pending. OAuth buttons
// show only when `providers` is not empty. Copy it in with `signet add block
// auth` and edit it: labels, parts and the root's className are props.
import * as React from "react"
import {
  type AuthChannel,
  type AuthLabels,
  type AuthMode,
  type AuthScreenProps,
  AuthScreen,
  type CodeRequest,
  DEFAULT_AUTH_LABELS,
  type OAuthProvider,
  VerifyCodeScreen,
} from "../../components/screens/auth-screens.js"
import { Card, CardContent } from "../../components/ui/card.js"
import { ErrorState } from "../../components/ui/error-state.js"
import { Skeleton } from "../../components/ui/skeleton.js"
import { cn } from "../../lib/utils.js"

export type BlockState = "ready" | "loading" | "error"

/** Every string the block shows: the auth screens' defaults plus the block's own. */
export const DEFAULT_AUTH_BLOCK_LABELS = {
  ...DEFAULT_AUTH_LABELS,
  errorMessage: "We could not load the sign-in page.",
  loading: "Loading sign-in",
}

export type AuthBlockLabels = typeof DEFAULT_AUTH_BLOCK_LABELS

/** Generic OAuth entries. Signet ships no provider marks: pass your own `icon`. */
export const SAMPLE_PROVIDERS: OAuthProvider[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
]

type Part = NonNullable<AuthScreenProps["classNames"]>

export type AuthProps = {
  /** "sign-in" or "sign-up". Controlled with `onModeChange`; uncontrolled starts at "sign-in". */
  mode?: AuthMode
  onModeChange?: (mode: AuthMode) => void
  /** "request" asks for an email or phone; "verify" shows only the code step. */
  step?: "request" | "verify"
  /** Code channels to offer on the request step, in order. Empty for OAuth only. */
  channels?: readonly AuthChannel[]
  /** On the verify step: where the code went, and how (email or phone). */
  to?: string
  channel?: AuthChannel
  /** On the verify step: shows "Change" and goes back to the request step. */
  onBack?: () => void
  onRequestCode?: (request: CodeRequest) => unknown
  onVerify?: (request: CodeRequest & { code: string }) => unknown
  providers?: readonly OAuthProvider[]
  onOAuth?: (provider: OAuthProvider, mode: AuthMode) => unknown
  logo?: React.ReactNode
  /** Under the form: terms, a privacy link. */
  footer?: React.ReactNode
  state?: BlockState
  onRetry?: () => void
  labels?: Partial<AuthBlockLabels>
  classNames?: Partial<Part>
  className?: string
}

// The screens are 40px controls; below md they grow to the 44px touch size.
const TOUCH =
  "max-md:[&_input]:h-11 max-md:[&_button[type=submit]]:h-11 max-md:[&_button[data-provider]]:h-11 max-md:[&_[role=tablist]]:h-11 max-md:[&_[data-slot=input-otp-slot]]:size-11"

export function Auth({
  mode,
  onModeChange,
  step = "request",
  channels,
  to,
  channel,
  onBack,
  onRequestCode,
  onVerify,
  providers = [],
  onOAuth,
  logo,
  footer,
  state = "ready",
  onRetry,
  labels: labelOverrides,
  classNames,
  className,
}: AuthProps) {
  const l = { ...DEFAULT_AUTH_BLOCK_LABELS, ...labelOverrides }
  const labels: Partial<AuthLabels> = l
  const card = cn(TOUCH, classNames?.card)

  return (
    <section
      data-block="auth"
      data-state={state}
      data-step={step}
      aria-busy={state === "loading" || undefined}
      className={cn("mx-auto w-full max-w-7xl p-4 py-8 md:p-6 md:py-16", className)}
    >
      {state === "error" ? (
        <Card data-slot="auth-error" className="mx-auto max-w-sm">
          <CardContent>
            <ErrorState message={l.errorMessage} onRetry={onRetry} />
          </CardContent>
        </Card>
      ) : state === "loading" ? (
        <AuthSkeleton label={l.loading} />
      ) : step === "verify" ? (
        <VerifyCodeScreen
          channel={channel}
          to={to}
          onBack={onBack}
          logo={logo}
          labels={labels}
          onVerify={(code) =>
            onVerify?.({ channel: channel ?? "email", to: to ?? "", mode: mode ?? "sign-in", code })
          }
          onResend={
            onRequestCode
              ? () =>
                  onRequestCode({
                    channel: channel ?? "email",
                    to: to ?? "",
                    mode: mode ?? "sign-in",
                  })
              : undefined
          }
          className={card}
          classNames={{ header: classNames?.header, form: classNames?.verify }}
        />
      ) : (
        <AuthScreen
          mode={mode}
          onModeChange={onModeChange}
          channels={channels}
          onRequestCode={onRequestCode}
          onVerify={onVerify}
          providers={providers}
          onOAuth={onOAuth}
          logo={logo}
          footer={footer}
          labels={labels}
          className={card}
          classNames={{ ...classNames, card: undefined }}
        />
      )}
    </section>
  )
}

/** The shape of the request step: a heading, two fields' worth of rows and a button. */
function AuthSkeleton({ label }: { label: string }) {
  return (
    <div
      data-slot="auth-skeleton"
      role="status"
      aria-label={label}
      className="mx-auto flex w-full max-w-sm flex-col gap-6 rounded-xl bg-bg-surface p-6 ring-1 ring-foreground/10"
    >
      <Skeleton className="mx-auto h-6 w-40" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  )
}
