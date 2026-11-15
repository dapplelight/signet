"use client"

import { useCallback, useMemo, useSyncExternalStore } from "react"

const EVENT = "signet:local-storage"

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null // storage disabled (private mode, sandboxed iframe)
  }
}

/**
 * A JSON value kept in localStorage under `key`, shared by every component
 * using the same key and kept in sync across tabs. The server render and the
 * first client render use `initial`, so hydration matches; unreadable or
 * missing storage also falls back to `initial`. Set `undefined` to remove it.
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, (next: T | undefined | ((prev: T) => T | undefined)) => void] {
  const raw = useSyncExternalStore(
    (onChange) => {
      const onStorage = (e: Event) => {
        if (!(e instanceof StorageEvent) || e.key === key || e.key === null) onChange()
      }
      window.addEventListener("storage", onStorage)
      window.addEventListener(EVENT, onStorage)
      return () => {
        window.removeEventListener("storage", onStorage)
        window.removeEventListener(EVENT, onStorage)
      }
    },
    () => read(key),
    () => null,
  )
  // Parsed once per stored string, so an object value keeps its identity between renders.
  const parsed = useMemo(() => {
    if (raw === null) return undefined
    try {
      return { v: JSON.parse(raw) as T }
    } catch {
      return undefined // not JSON (written by something else): use `initial`
    }
  }, [raw])
  const value = parsed ? parsed.v : initial

  const set = useCallback(
    (next: T | undefined | ((prev: T) => T | undefined)) => {
      const stored = read(key)
      let prev = initial
      if (stored !== null) {
        try {
          prev = JSON.parse(stored) as T
        } catch {}
      }
      const v = typeof next === "function" ? (next as (p: T) => T | undefined)(prev) : next
      try {
        if (v === undefined) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, JSON.stringify(v))
      } catch {
        return // quota exceeded or storage disabled: nothing changes
      }
      window.dispatchEvent(new Event(EVENT))
    },
    [key, initial],
  )
  return [value, set]
}
