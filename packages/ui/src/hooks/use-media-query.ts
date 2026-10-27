"use client"

import { useEffect, useState } from "react"

/** The `md` breakpoint as a media query: phone below it, desktop at or above. */
export const DESKTOP_QUERY = "(min-width: 768px)"

/**
 * Tracks a CSS media query in JS, for the rare case where a breakpoint has to
 * change *which component* renders (a bottom Drawer on phone, a Dialog on
 * desktop), not just its classes. Prefer Tailwind responsive classes for
 * anything that is only a style change.
 *
 * With no `window` (SSR, tests without a DOM) or no `matchMedia`, it reports
 * `false`: phone-first.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    setMatches(mq.matches)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [query])

  return matches
}
