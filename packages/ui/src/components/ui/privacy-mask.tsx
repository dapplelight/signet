"use client"

/**
 * A one-tap "hide values" mask, for showing a screen to someone else.
 *
 * It is a display preference, NOT a security boundary: the data is still in
 * memory. While masked, components that read `usePrivacyMask()` keep the real
 * numbers out of the rendered DOM: no text, no title, no aria-label, and no
 * bar width derived from them. A ratio of hidden values (a savings rate, 92%
 * of a budget, a bar's length) leaks as much as the values, so the ratio
 * helpers here mask those too.
 *
 * Lifted from app-a, where it hides amounts. Apps render their own value
 * component (app-a's `<Amount>`) and check `masked` in it.
 */

import { EyeIcon, EyeOffIcon } from "lucide-react"
import type * as React from "react"
import { createContext, useCallback, useContext, useMemo, useState } from "react"

import { cn } from "../../lib/utils.js"
import { Button } from "./button.js"
import { Progress } from "./progress.js"

/** Stands in for any hidden value. The same for every value, so masked rows keep one width. */
export const MASKED_VALUE = "••••••"

/** Stands in for a percentage derived from hidden values. */
export const MASKED_PERCENT = "••%"

/**
 * Replace every percentage in a string ("73%", "+12.5 %", "−4%") with
 * `MASKED_PERCENT`. Numbers without a percent sign are left alone.
 */
export function maskPercentText(text: string): string {
  return text.replace(/[+\-−]?\d[\d,]*(?:\.\d+)?\s?%/g, MASKED_PERCENT)
}

type PrivacyMaskContextValue = {
  masked: boolean
  setMasked: (masked: boolean) => void
  toggle: () => void
}

const PrivacyMaskContext = createContext<PrivacyMaskContextValue | null>(null)

const UNMASKED: PrivacyMaskContextValue = { masked: false, setMasked: () => {}, toggle: () => {} }

function readPersisted(storageKey: string | false, fallback: boolean): boolean {
  if (!storageKey) return fallback
  try {
    const v = localStorage.getItem(storageKey)
    return v === null ? fallback : v === "1"
  } catch {
    return fallback
  }
}

function persist(storageKey: string | false, masked: boolean) {
  if (!storageKey) return
  try {
    if (masked) localStorage.setItem(storageKey, "1")
    else localStorage.removeItem(storageKey)
  } catch {
    // Private mode or blocked storage: the mask still applies for this tab.
  }
}

export type PrivacyMaskProviderProps = {
  children: React.ReactNode
  /**
   * Controlled: the app owns the state (its own store, a server setting).
   * `storageKey` and `defaultMasked` are then ignored.
   */
  masked?: boolean
  onMaskedChange?: (masked: boolean) => void
  /** Uncontrolled starting value, when nothing is stored. Default false. */
  defaultMasked?: boolean
  /**
   * localStorage key for the uncontrolled choice, per device. Masked is
   * stored as "1"; unmasked removes the key. `false` keeps it for this tab only.
   */
  storageKey?: string | false
}

export function PrivacyMaskProvider({
  children,
  masked: controlled,
  onMaskedChange,
  defaultMasked = false,
  storageKey = "signet-privacy-mask",
}: PrivacyMaskProviderProps) {
  const [own, setOwn] = useState(() => readPersisted(storageKey, defaultMasked))
  const isControlled = controlled !== undefined
  const masked = isControlled ? controlled : own

  const setMasked = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        persist(storageKey, next)
        setOwn(next)
      }
      onMaskedChange?.(next)
    },
    [isControlled, storageKey, onMaskedChange],
  )

  const value = useMemo<PrivacyMaskContextValue>(
    () => ({ masked, setMasked, toggle: () => setMasked(!masked) }),
    [masked, setMasked],
  )

  return <PrivacyMaskContext.Provider value={value}>{children}</PrivacyMaskContext.Provider>
}

/** The mask state. Outside a provider: never masked, and the setters do nothing. */
export function usePrivacyMask(): PrivacyMaskContextValue {
  return useContext(PrivacyMaskContext) ?? UNMASKED
}

/**
 * Helpers for ratios of hidden values. While masked:
 *   text(s)   every "NN%" in s becomes "••%"
 *   node(n)   the same, for a node that is a plain string; other nodes pass through
 *   value(n)  a neutral 0 (a Progress value)
 *   width(p)  "0%" (a style width)
 */
export function useMaskedRatio() {
  const { masked } = usePrivacyMask()
  return {
    masked,
    text: (s: string) => (masked ? maskPercentText(s) : s),
    node: (n: React.ReactNode) => (masked && typeof n === "string" ? maskPercentText(n) : n),
    value: (n: number) => (masked ? 0 : n),
    width: (pct: number) => (masked ? "0%" : `${pct}%`),
  }
}

/** Text containing percentages of hidden values ("73%", "92% used"). */
export function RatioText({ children }: { children: string }) {
  const ratio = useMaskedRatio()
  return <>{ratio.text(children)}</>
}

/** A Progress whose value is a ratio of hidden values; masked, it sits at 0. */
export function RatioProgress({ value, ...props }: React.ComponentProps<typeof Progress>) {
  const ratio = useMaskedRatio()
  return (
    <Progress
      value={typeof value === "number" ? ratio.value(value) : value}
      data-masked={ratio.masked || undefined}
      {...props}
    />
  )
}

/** A hand-drawn bar fill whose width is a ratio of hidden values; masked, it is 0% wide. */
export function RatioFill({
  pct,
  as: Tag = "div",
  className,
  style,
}: {
  pct: number
  as?: "div" | "span"
  className?: string
  style?: React.CSSProperties
}) {
  const ratio = useMaskedRatio()
  return (
    <Tag
      className={className}
      data-masked={ratio.masked || undefined}
      style={{ ...style, width: ratio.width(pct) }}
    />
  )
}

/**
 * The header's eye button. Eye means values are showing (tap to hide);
 * eye-off means masked (tap to show). 44px on phone, 32px from md up. The
 * labels name what is hidden; pass `shortcut` to show a key in the tooltip
 * (the app binds the key itself).
 */
export function MaskToggle({
  disabled,
  className,
  hideLabel = "Hide values",
  showLabel = "Show values",
  shortcut,
}: {
  disabled?: boolean
  className?: string
  hideLabel?: string
  showLabel?: string
  shortcut?: string
}) {
  const { masked, toggle } = usePrivacyMask()
  const label = masked ? showLabel : hideLabel
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-touch"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onClick={toggle}
      data-slot="mask-toggle"
      className={cn("text-text-secondary md:size-8", className)}
    >
      {masked ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
    </Button>
  )
}
