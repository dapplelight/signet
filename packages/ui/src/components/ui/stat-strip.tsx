"use client"

import type * as React from "react"

import { DESKTOP_QUERY, useMediaQuery } from "../../hooks/use-media-query.js"
import { cn } from "../../lib/utils.js"
import { useMaskedRatio } from "./privacy-mask.js"

interface StatItem {
  label: string
  value: React.ReactNode
  meta?: React.ReactNode
  /** Colours the meta line: good = green, warn = amber (at risk). Never red, which means destructive. */
  tone?: "good" | "warn" | "muted"
}

const DESKTOP_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
}

/**
 * A row of headline numbers. Desktop: one card per stat in a grid. Phone: one
 * card of stacked label/value rows, so long values never squeeze into a third
 * of a 390px screen. Labels must be unique (they are the keys).
 *
 * Under the privacy mask, percentages in string values and meta lines become
 * "••%". A value that is a component (a formatted amount) masks itself.
 */
function StatStrip({
  items,
  isDesktop: isDesktopProp,
  className,
}: {
  items: StatItem[]
  /** Which layout. Default: follows the `md` breakpoint. */
  isDesktop?: boolean
  className?: string
}) {
  const ratio = useMaskedRatio()
  const matches = useMediaQuery(DESKTOP_QUERY)
  const isDesktop = isDesktopProp ?? matches
  const shown = items.map((s) => ({ ...s, value: ratio.node(s.value), meta: ratio.node(s.meta) }))

  if (isDesktop) {
    return (
      <div
        data-slot="stat-strip"
        data-layout="grid"
        className={cn(
          "grid gap-3 lg:gap-4",
          DESKTOP_COLS[shown.length] ?? "grid-cols-3",
          className,
        )}
      >
        {shown.map((s) => (
          <div
            key={s.label}
            className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-bg-surface p-4 ring-1 ring-border-subtle md:p-5"
          >
            <p className="text-caption text-text-muted">{s.label}</p>
            <p className="truncate font-mono text-title font-semibold tracking-tight text-text-primary">
              {s.value}
            </p>
            {s.meta && <Meta tone={s.tone}>{s.meta}</Meta>}
          </div>
        ))}
      </div>
    )
  }

  return (
    <dl
      data-slot="stat-strip"
      data-layout="rows"
      className={cn(
        "divide-y divide-border-subtle rounded-xl bg-bg-surface ring-1 ring-border-subtle",
        className,
      )}
    >
      {shown.map((s) => (
        <div key={s.label} className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
          <dt className="min-w-0">
            <span className="block text-body text-text-secondary">{s.label}</span>
            {s.meta && <Meta tone={s.tone}>{s.meta}</Meta>}
          </dt>
          <dd className="shrink-0 font-mono text-callout font-semibold text-text-primary">
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Meta({
  tone = "muted",
  children,
}: {
  tone?: StatItem["tone"]
  children: React.ReactNode
}) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "block text-caption",
        tone === "good" && "text-accent-green",
        tone === "warn" && "text-accent-amber",
        tone === "muted" && "text-text-muted",
      )}
    >
      {children}
    </span>
  )
}

export { type StatItem, StatStrip }
