"use client"

import type * as React from "react"

import { cn } from "../../lib/utils.js"
import { MASKED_VALUE, useMaskedRatio } from "./privacy-mask.js"

/** A piece of the sentence: text, or a number the UI renders (and masks) itself. */
type AnswerSegment = string | { value: number }

interface AnswerHeadlineData {
  /** The question the sentence answers (small, muted, above it). */
  question: string
  sentence: AnswerSegment[]
  /** An optional supporting fact line under the sentence. */
  detail?: AnswerSegment[]
  /** "warn" renders amber (at risk). Never red, which means destructive. */
  tone: "neutral" | "good" | "warn"
}

/**
 * Plain text of a sentence, for aria-labels, notifications and tests.
 * `format` turns a value into text; default is the locale's number format.
 */
function answerText(
  segments: AnswerSegment[],
  format: (value: number) => string = (n) => n.toLocaleString(),
): string {
  return segments.map((s) => (typeof s === "string" ? s : format(s.value))).join("")
}

function Segments({
  segments,
  renderValue,
}: {
  segments: AnswerSegment[]
  renderValue: (value: number) => React.ReactNode
}) {
  const ratio = useMaskedRatio()
  return segments.map((seg, i) =>
    typeof seg === "string" ? (
      <span key={i}>{ratio.text(seg)}</span>
    ) : (
      <strong key={i} className="font-semibold">
        {renderValue(seg.value)}
      </strong>
    ),
  )
}

/**
 * The one-line answer a screen leads with: a question, then a sentence with
 * the deciding numbers bold, then one optional fact line. The sentence is
 * built by rules in the app, so its values stay separate from its text and
 * each is rendered by `renderValue` (the app's currency or unit component).
 *
 * Under the privacy mask, percentages in the text become "••%". The default
 * `renderValue` renders "••••••"; a custom one must mask itself.
 */
function AnswerHeadline({
  headline,
  renderValue,
  className,
  children,
}: {
  headline: AnswerHeadlineData
  renderValue?: (value: number) => React.ReactNode
  className?: string
  /** Extra controls under the sentence (period pills, a link). */
  children?: React.ReactNode
}) {
  const { masked } = useMaskedRatio()
  const render = renderValue ?? ((n: number) => (masked ? MASKED_VALUE : n.toLocaleString()))
  return (
    <section
      data-slot="answer-headline"
      data-tone={headline.tone}
      aria-label={headline.question}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl bg-bg-surface p-4 ring-1 ring-border-subtle md:p-5",
        className,
      )}
    >
      <h2 className="text-body font-medium text-text-muted">{headline.question}</h2>
      <p
        data-slot="answer-headline-sentence"
        className={cn(
          "text-subhead font-medium leading-snug tracking-tight text-text-primary md:text-title",
          headline.tone === "warn" && "text-accent-amber",
        )}
      >
        <Segments segments={headline.sentence} renderValue={render} />
      </p>
      {headline.detail && (
        <p data-slot="answer-headline-detail" className="text-caption text-text-secondary">
          <Segments segments={headline.detail} renderValue={render} />
        </p>
      )}
      {children}
    </section>
  )
}

export { AnswerHeadline, type AnswerHeadlineData, type AnswerSegment, answerText }
