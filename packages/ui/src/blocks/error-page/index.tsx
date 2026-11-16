"use client"

// Block: error page for 404 and 500. A large muted code (hidden from screen
// readers), the title as the page's h1, a description and buttons: "Go home"
// on both, "Try again" on 500. `onHome` / `onRetry` are callbacks, or pass
// `homeHref` to make "Go home" a link. Copy it in with `signet add block
// error-page` and edit it.
import { Button, buttonVariants } from "../../components/ui/button.js"
import { Card, CardContent } from "../../components/ui/card.js"
import { ErrorState } from "../../components/ui/error-state.js"
import { Skeleton } from "../../components/ui/skeleton.js"
import { cn } from "../../lib/utils.js"

export type BlockState = "ready" | "loading" | "error"

/** Every string the block shows. Spread it and override what you need. */
export const DEFAULT_ERROR_PAGE_LABELS = {
  notFoundTitle: "Page not found",
  notFoundDescription: "The page you're looking for doesn't exist or has moved.",
  serverTitle: "Something went wrong",
  serverDescription: "We hit an error on our side. Try again in a moment.",
  home: "Go home",
  retry: "Try again",
  errorMessage: "We could not load this page.",
  loading: "Loading",
}

export type ErrorPageLabels = typeof DEFAULT_ERROR_PAGE_LABELS

type Part = "code" | "title" | "description" | "actions"

export type ErrorPageProps = {
  code?: 404 | 500
  /** "Go home" as a link. */
  homeHref?: string
  /** "Go home" as a button, when there is no `homeHref`. */
  onHome?: () => void
  /** "Try again" on a 500. The button shows only when this is set. */
  onTryAgain?: () => void
  state?: BlockState
  /** The retry for `state="error"`. */
  onRetry?: () => void
  labels?: Partial<ErrorPageLabels>
  classNames?: Partial<Record<Part, string>>
  className?: string
}

export function ErrorPage({
  code = 404,
  homeHref,
  onHome,
  onTryAgain,
  state = "ready",
  onRetry,
  labels: labelOverrides,
  classNames,
  className,
}: ErrorPageProps) {
  const l = { ...DEFAULT_ERROR_PAGE_LABELS, ...labelOverrides }
  const notFound = code === 404
  const title = notFound ? l.notFoundTitle : l.serverTitle
  const description = notFound ? l.notFoundDescription : l.serverDescription
  const btn = "md:h-8"
  return (
    <section
      data-block="error-page"
      data-code={code}
      data-state={state}
      aria-busy={state === "loading" || undefined}
      className={cn("mx-auto w-full max-w-7xl p-4 md:p-6", className)}
    >
      {state === "error" ? (
        <Card data-slot="error-page-error">
          <CardContent>
            <ErrorState message={l.errorMessage} onRetry={onRetry} />
          </CardContent>
        </Card>
      ) : state === "loading" ? (
        <div
          data-slot="error-page-skeleton"
          role="status"
          aria-label={l.loading}
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3"
        >
          <Skeleton className="h-20 w-40" />
          <Skeleton className="h-6 w-56 max-w-full" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-11 w-28 md:h-8" />
        </div>
      ) : (
        <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
          <p
            aria-hidden="true"
            data-slot="error-page-code"
            className={cn(
              "text-8xl leading-none font-semibold tabular-nums text-text-muted md:text-9xl",
              classNames?.code,
            )}
          >
            {code}
          </p>
          <h1
            data-slot="error-page-title"
            title={title}
            className={cn("mt-4 max-w-full truncate text-xl font-medium", classNames?.title)}
          >
            {title}
          </h1>
          <p
            data-slot="error-page-description"
            className={cn("mt-1 max-w-md text-text-secondary", classNames?.description)}
          >
            {description}
          </p>
          <div
            data-slot="error-page-actions"
            className={cn("mt-6 flex flex-wrap justify-center gap-2", classNames?.actions)}
          >
            {notFound || !onTryAgain ? null : (
              <Button type="button" size="touch" className={btn} onClick={onTryAgain}>
                {l.retry}
              </Button>
            )}
            {homeHref ? (
              <a
                href={homeHref}
                className={cn(
                  buttonVariants({ variant: notFound ? "default" : "outline", size: "touch" }),
                  btn,
                )}
              >
                {l.home}
              </a>
            ) : onHome ? (
              <Button
                type="button"
                variant={notFound ? "default" : "outline"}
                size="touch"
                className={btn}
                onClick={onHome}
              >
                {l.home}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
