"use client"

import { useEffect, useState } from "react"

/**
 * `value`, but only after it has stopped changing for `delay` ms: search as
 * you type without a request per keystroke. The first render returns `value`
 * as is.
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
