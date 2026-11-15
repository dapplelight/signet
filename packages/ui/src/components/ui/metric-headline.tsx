"use client"

// "Answers, not dashboards": one metric as a plain sentence, its number and
// its trend ("Signups up 18% this week"). Feed it `{ current, previous }`,
// e.g. signet-db analytics' `store.trend(...)`. For a sentence the app builds
// itself, use AnswerHeadline.
import type * as React from "react"

import { cn } from "../../lib/utils.js"
import { MASKED_VALUE, useMaskedRatio } from "./privacy-mask.js"

/** `{ current, previous }` for one period and the one before it. */
interface MetricTrendInput {
  current: number
  previous: number | null
}

type MetricDirection = "up" | "down" | "flat" | "new"
type MetricTone = "good" | "warn" | "neutral"

interface MetricCopyContext {
  /** The metric's name, e.g. "Signups". */
  label: string
  /** e.g. "this week". */
  period: string
  /** The change, formatted: "18%". Empty for "new". */
  percent: string
  /** The current value, formatted. */
  value: string
}

/** Every string the component renders. Override any for tone or translation. */
interface MetricHeadlineCopy {
  up: (c: MetricCopyContext) => string
  down: (c: MetricCopyContext) => string
  flat: (c: MetricCopyContext) => string
  /** Nothing to compare with: no previous period, or it was 0. */
  new: (c: MetricCopyContext) => string
  /** The small trend label: "↑ 18%". */
  trend: (direction: MetricDirection, percent: string) => string
}

const DEFAULT_METRIC_COPY: MetricHeadlineCopy = {
  up: (c) => `${c.label} up ${c.percent} ${c.period}`,
  down: (c) => `${c.label} down ${c.percent} ${c.period}`,
  flat: (c) => `${c.label} steady ${c.period}`,
  new: (c) => `${c.label} ${c.period}`,
  trend: (d, p) => (d === "up" ? `↑ ${p}` : d === "down" ? `↓ ${p}` : d === "flat" ? "→" : ""),
}

interface MetricTrendOptions {
  /** Changes smaller than this (percent) read as flat. Default 1. */
  flatWithin?: number
  /** Which way is good. Default "up"; "down" for errors, churn, load time. */
  goodWhen?: "up" | "down"
}

interface MetricTrend {
  direction: MetricDirection
  tone: MetricTone
  /** Rounded whole percent, unsigned; null for "new". */
  percent: number | null
}

/** The rule behind the headline, for an app that renders its own. */
function metricTrend(
  { current, previous }: MetricTrendInput,
  { flatWithin = 1, goodWhen = "up" }: MetricTrendOptions = {},
): MetricTrend {
  if (!previous) {
    return { direction: current ? "new" : "flat", tone: "neutral", percent: current ? null : 0 }
  }
  const change = ((current - previous) / Math.abs(previous)) * 100
  const percent = Math.round(Math.abs(change))
  if (Math.abs(change) < flatWithin) return { direction: "flat", tone: "neutral", percent }
  const direction = change > 0 ? "up" : "down"
  return { direction, tone: direction === goodWhen ? "good" : "warn", percent }
}

/** The plain sentence, for aria-labels, notifications and agents. */
function metricSentence(
  input: MetricTrendInput,
  {
    label,
    period = "this week",
    copy,
    format = (n: number) => n.toLocaleString(),
    ...options
  }: MetricTrendOptions & {
    label: string
    period?: string
    copy?: Partial<MetricHeadlineCopy>
    format?: (n: number) => string
  },
): string {
  const t = metricTrend(input, options)
  const c = { ...DEFAULT_METRIC_COPY, ...copy }
  return c[t.direction]({
    label,
    period,
    percent: t.percent === null ? "" : `${t.percent}%`,
    value: format(input.current),
  })
}

function MetricHeadlineRoot({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="metric-headline"
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-xl bg-bg-surface p-4 ring-1 ring-border-subtle md:p-5",
        className,
      )}
      {...props}
    />
  )
}

function MetricHeadlineValue({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="metric-headline-value"
      className={cn(
        "text-title font-semibold tabular-nums tracking-tight text-text-primary",
        className,
      )}
      {...props}
    />
  )
}

function MetricHeadlineSentence({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="metric-headline-sentence"
      className={cn("text-body font-medium text-text-secondary", className)}
      {...props}
    />
  )
}

/** Green when good, amber when not. Never red, which means destructive. */
function MetricHeadlineTrend({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: MetricTone }) {
  return (
    <span
      data-slot="metric-headline-trend"
      data-tone={tone}
      className={cn(
        "text-caption font-medium text-text-muted",
        tone === "good" && "text-accent-green",
        tone === "warn" && "text-accent-amber",
        className,
      )}
      {...props}
    />
  )
}

interface MetricHeadlineProps
  extends MetricTrendOptions,
    Omit<React.ComponentProps<"section">, "children"> {
  /** `{ current, previous }`, e.g. from signet-db analytics' `store.trend()`. */
  result: MetricTrendInput
  /** The metric's name as the sentence starts it: "Signups". */
  label: string
  /** Default "this week". */
  period?: string
  copy?: Partial<MetricHeadlineCopy>
  /** Formats the value (and the value in copy). Default: the locale's number format. */
  format?: (n: number) => string
  /** Class per part. */
  classNames?: { value?: string; sentence?: string; trend?: string }
  /** Extra content under the sentence (a link, period pills). */
  children?: React.ReactNode
}

/**
 * One metric answered in a sentence. Under the privacy mask the value shows
 * "••••••" and percentages "••%".
 */
function MetricHeadline({
  result,
  label,
  period = "this week",
  copy,
  format = (n) => n.toLocaleString(),
  flatWithin,
  goodWhen,
  classNames,
  children,
  ...props
}: MetricHeadlineProps) {
  const ratio = useMaskedRatio()
  const t = metricTrend(result, { flatWithin, goodWhen })
  const c = { ...DEFAULT_METRIC_COPY, ...copy }
  const sentence = metricSentence(result, { label, period, copy, format, flatWithin, goodWhen })
  const trend = c.trend(t.direction, t.percent === null ? "" : `${t.percent}%`)
  return (
    <MetricHeadlineRoot
      aria-label={ratio.text(sentence)}
      data-direction={t.direction}
      data-tone={t.tone}
      {...props}
    >
      <MetricHeadlineValue className={classNames?.value}>
        {ratio.masked ? MASKED_VALUE : format(result.current)}
      </MetricHeadlineValue>
      <MetricHeadlineSentence className={classNames?.sentence}>
        {ratio.text(sentence)}{" "}
        {trend && (
          <MetricHeadlineTrend tone={t.tone} className={classNames?.trend}>
            {ratio.text(trend)}
          </MetricHeadlineTrend>
        )}
      </MetricHeadlineSentence>
      {children}
    </MetricHeadlineRoot>
  )
}

export {
  DEFAULT_METRIC_COPY,
  type MetricCopyContext,
  type MetricDirection,
  MetricHeadline,
  type MetricHeadlineCopy,
  type MetricHeadlineProps,
  MetricHeadlineRoot,
  MetricHeadlineSentence,
  MetricHeadlineTrend,
  MetricHeadlineValue,
  type MetricTone,
  type MetricTrend,
  type MetricTrendInput,
  type MetricTrendOptions,
  metricSentence,
  metricTrend,
}
