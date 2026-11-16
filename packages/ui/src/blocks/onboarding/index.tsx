"use client"

// Block: onboarding. A Stepper on top (vertical on a phone) and the current
// step's content in a Card, with Back, Continue / Finish and an optional "Skip
// for now". Steps are props: each has a title, a description for the stepper
// and `content`, any React node. After every step change focus moves to the
// step heading. `onNext` and `onFinish` may be async: the button shows a
// spinner and the step stays put if they throw (the message shows under the
// content). Copy it in with `signet add block onboarding` and edit it.
import * as React from "react"
import { DESKTOP_QUERY, useMediaQuery } from "../../hooks/use-media-query.js"
import { Button } from "../../components/ui/button.js"
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "../../components/ui/card.js"
import { ErrorState } from "../../components/ui/error-state.js"
import { Skeleton } from "../../components/ui/skeleton.js"
import { Spinner } from "../../components/ui/spinner.js"
import { Stepper } from "../../components/ui/stepper.js"
import { cn } from "../../lib/utils.js"
import { SAMPLE_STEPS } from "./sample.js"

export type BlockState = "ready" | "loading" | "error"

export type OnboardingStep = {
  id: string
  title: string
  /** Under the title in the stepper, and under the heading in the card. */
  description?: string
  content: React.ReactNode
}

/** Every string the block shows. Spread it and override what you need. */
export const DEFAULT_ONBOARDING_LABELS = {
  onboarding: "Onboarding",
  back: "Back",
  next: "Continue",
  finish: "Finish",
  skip: "Skip for now",
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  error: "Something went wrong. Try again.",
  errorMessage: "We could not load onboarding.",
  loading: "Loading onboarding",
}

export type OnboardingLabels = typeof DEFAULT_ONBOARDING_LABELS

type Part = "stepper" | "card" | "heading" | "content" | "footer"

export type OnboardingProps = {
  steps?: readonly OnboardingStep[]
  /** Index of the current step, controlled. Leave unset to let the block keep it. */
  current?: number
  onCurrentChange?: (index: number) => void
  /** Runs on Continue, before moving on. Throw to stay on the step and show the message. */
  onNext?: (step: OnboardingStep, index: number) => void | Promise<void>
  /** Runs on Finish, on the last step. */
  onFinish?: () => void | Promise<void>
  /** Shows "Skip for now". Runs instead of moving on; the step does not change. */
  onSkip?: () => void | Promise<void>
  state?: BlockState
  onRetry?: () => void
  labels?: Partial<OnboardingLabels>
  classNames?: Partial<Record<Part, string>>
  className?: string
}

export function Onboarding({
  steps = SAMPLE_STEPS,
  current: currentProp,
  onCurrentChange,
  onNext,
  onFinish,
  onSkip,
  state = "ready",
  onRetry,
  labels: labelOverrides,
  classNames,
  className,
}: OnboardingProps) {
  const l = { ...DEFAULT_ONBOARDING_LABELS, ...labelOverrides }
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const [own, setOwn] = React.useState(0)
  const index = Math.min(Math.max(currentProp ?? own, 0), Math.max(steps.length - 1, 0))
  const step = steps[index]
  const last = index >= steps.length - 1
  const [pending, setPending] = React.useState<"next" | "skip" | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const heading = React.useRef<HTMLHeadingElement>(null)
  // Compared with the last index, not "first run", so StrictMode's double effect does not steal focus on mount.
  const shown = React.useRef(index)
  React.useEffect(() => {
    if (shown.current === index) return
    shown.current = index
    heading.current?.focus()
  }, [index])

  const go = (to: number) => {
    setError(null)
    setOwn(to)
    onCurrentChange?.(to)
  }
  const run = async (kind: "next" | "skip", fn: () => void | Promise<void>, after?: () => void) => {
    setPending(kind)
    setError(null)
    try {
      await fn()
      after?.()
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : l.error)
    } finally {
      setPending(null)
    }
  }

  return (
    <section
      data-block="onboarding"
      data-state={state}
      aria-busy={state === "loading" || undefined}
      className={cn("mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6", className)}
    >
      {state === "error" ? (
        <Card data-slot="onboarding-error">
          <CardContent>
            <ErrorState message={l.errorMessage} onRetry={onRetry} />
          </CardContent>
        </Card>
      ) : state === "loading" ? (
        <OnboardingSkeleton label={l.loading} />
      ) : step ? (
        <>
          <div data-slot="onboarding-stepper" className={cn("w-full", classNames?.stepper)}>
            <Stepper
              aria-label={l.onboarding}
              steps={steps.map((s) => ({ title: s.title, description: s.description }))}
              current={index}
              orientation={desktop ? "horizontal" : "vertical"}
            />
          </div>
          <Card data-slot="onboarding-card" className={classNames?.card}>
            <CardHeader>
              <h2
                ref={heading}
                tabIndex={-1}
                data-slot="onboarding-heading"
                title={step.title}
                className={cn(
                  "truncate text-base leading-snug font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring",
                  classNames?.heading,
                )}
              >
                {step.title}
              </h2>
              <p className="text-xs text-text-muted">{l.stepOf(index + 1, steps.length)}</p>
              {step.description ? (
                <CardDescription className="truncate" title={step.description}>
                  {step.description}
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent
              data-slot="onboarding-content"
              className={cn("grid max-w-xl gap-4", classNames?.content)}
            >
              {step.content}
              <p role="alert" className="text-sm text-destructive empty:hidden">
                {error}
              </p>
            </CardContent>
            <CardFooter
              data-slot="onboarding-footer"
              className={cn("flex-wrap justify-between gap-2", classNames?.footer)}
            >
              <div className="flex flex-wrap gap-2">
                {index > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
                    className="md:h-8"
                    disabled={pending !== null}
                    onClick={() => go(index - 1)}
                  >
                    {l.back}
                  </Button>
                ) : null}
                {onSkip ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="touch"
                    className="md:h-8"
                    disabled={pending !== null}
                    onClick={() => run("skip", onSkip)}
                  >
                    {pending === "skip" && <Spinner className="text-current" aria-hidden="true" />}
                    {l.skip}
                  </Button>
                ) : null}
              </div>
              <Button
                type="button"
                size="touch"
                className="ml-auto md:h-8"
                disabled={pending !== null}
                onClick={() =>
                  run(
                    "next",
                    () => (last ? onFinish?.() : onNext?.(step, index)),
                    last ? undefined : () => go(index + 1),
                  )
                }
              >
                {pending === "next" && <Spinner className="text-current" aria-hidden="true" />}
                {last ? l.finish : l.next}
              </Button>
            </CardFooter>
          </Card>
        </>
      ) : null}
    </section>
  )
}

/** The stepper's row and a card with a heading, a field and the buttons. */
function OnboardingSkeleton({ label }: { label: string }) {
  return (
    <div data-slot="onboarding-skeleton" role="status" aria-label={label} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:justify-between">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full md:h-9" />
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="flex max-w-xl flex-col gap-4">
          <Skeleton className="h-11 w-full md:h-8" />
          <Skeleton className="h-11 w-full md:h-8" />
        </CardContent>
        <CardFooter className="justify-end">
          <Skeleton className="h-11 w-28 md:h-8" />
        </CardFooter>
      </Card>
    </div>
  )
}
