"use client"

import { useCallback, useRef, useState } from "react"

export interface IntersectionOptions extends IntersectionObserverInit {
  /** Stop watching after the element first becomes visible. Default false. */
  once?: boolean
}

/**
 * Whether an element is on screen, for lazy loading, infinite lists and
 * reveal-on-scroll. Put `ref` on the element. Without IntersectionObserver
 * (SSR, old browsers) the element counts as visible, so content still loads.
 */
export function useIntersection<T extends Element = HTMLElement>({
  root,
  rootMargin,
  threshold,
  once = false,
}: IntersectionOptions = {}): {
  ref: (el: T | null) => void
  isIntersecting: boolean
  entry: IntersectionObserverEntry | undefined
} {
  const [entry, setEntry] = useState<IntersectionObserverEntry>()
  const [fallback, setFallback] = useState(false)
  const observer = useRef<IntersectionObserver>(undefined)
  const thresholdKey = JSON.stringify(threshold)
  // biome-ignore lint/correctness/useExhaustiveDependencies: threshold is compared by value through thresholdKey
  const ref = useCallback(
    (el: T | null) => {
      observer.current?.disconnect()
      observer.current = undefined
      if (!el) return
      if (typeof IntersectionObserver === "undefined") {
        setFallback(true)
        return
      }
      const io = new IntersectionObserver(
        ([e]) => {
          if (!e) return
          setEntry(e)
          if (once && e.isIntersecting) io.disconnect()
        },
        { root, rootMargin, threshold },
      )
      io.observe(el)
      observer.current = io
    },
    [root, rootMargin, thresholdKey, once],
  )
  return { ref, isIntersecting: fallback || !!entry?.isIntersecting, entry }
}
