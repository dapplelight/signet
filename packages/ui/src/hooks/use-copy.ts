"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Copies text to the clipboard. `copied` is true for `timeout` ms after a
 * successful copy, for a "Copied" label or check icon; `copy` resolves false
 * when the clipboard is unavailable or permission is denied.
 */
export function useCopy(timeout = 2000): {
  copy: (text: string) => Promise<boolean>
  copied: boolean
} {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        setCopied(false)
        return false
      }
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), timeout)
      return true
    },
    [timeout],
  )
  return { copy, copied }
}
