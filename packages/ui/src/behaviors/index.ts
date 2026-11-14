"use client"

// Signet behaviours: the keyboard, state and matching logic the components are
// built from, with Signet's own names and types. UI SDK implements them today;
// nothing from it appears in this module's types, so it can be swapped here
// without touching an app. Build a new component from these plus token classes.
import { fuzzyScore } from "@ui-sdk/core/text-match"
import { useShortcut as useSdkShortcut, useShortcutHint } from "@ui-sdk/react/shortcuts"
import { useCallback, useRef, useState } from "react"

export interface ShortcutOptions {
  /** Default true. A disabled shortcut is not registered. */
  enabled?: boolean
}

/**
 * Runs `handler` while mounted when `keys` is pressed, like "mod+k" (⌘ on Apple
 * platforms, Ctrl elsewhere). Pass null to register nothing. A modal dialog
 * built on these behaviours pauses page shortcuts while it is open. The latest
 * handler always runs, so it need not be stable.
 */
export function useShortcut(
  keys: string | null | undefined,
  handler: (event: KeyboardEvent) => void,
  { enabled = true }: ShortcutOptions = {},
): void {
  useSdkShortcut(enabled ? keys : null, handler)
}

/**
 * `keys` formatted for this platform ("⌘K" or "Ctrl+K") and the matching
 * `aria-keyshortcuts` value. Server and first client render agree.
 */
export function useShortcutLabel(keys: string): { text: string; ariaKeyShortcuts: string } {
  const { text, ariaKeyshortcuts } = useShortcutHint(keys)
  return { text, ariaKeyShortcuts: ariaKeyshortcuts }
}

export interface ControllableStateOptions<T> {
  /** Controlled value. Leave undefined for uncontrolled. */
  value?: T
  defaultValue: T
  onChange?: (value: T) => void
}

/**
 * One state that works controlled (`value` + `onChange`) or uncontrolled
 * (`defaultValue`), the contract every stateful Signet component follows.
 */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: ControllableStateOptions<T>): [T, (next: T) => void] {
  const [own, setOwn] = useState(defaultValue)
  const controlled = value !== undefined
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const set = useCallback(
    (next: T) => {
      if (!controlled) setOwn(next)
      onChangeRef.current?.(next)
    },
    [controlled],
  )
  return [controlled ? (value as T) : own, set]
}

/**
 * How well `text` matches `query`, from 0 (no match) to 1 (the same text):
 * the query's letters in order, ignoring case and accents. The score Command
 * ranks by; use it to filter or sort your own lists the same way.
 */
export function matchScore(text: string, query: string): number {
  return fuzzyScore(text, query)
}
