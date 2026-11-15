/**
 * A clock tests move by hand. Signet modules that care about time take a
 * `now: () => number` (epoch milliseconds, like `Date.now`); pass `clock.now`.
 *
 *   const clock = fakeClock("2026-11-01T10:00:00Z")
 *   const payments = appstore({ ...config, now: clock.now })
 *   clock.advance(31 * DAY)
 *
 * It does not patch the global `Date`: for code that calls `Date.now()`
 * directly, use `setSystemTime` from `bun:test` or Playwright's `page.clock`.
 */

export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export type FakeClock = {
  /** Epoch milliseconds. A bound function: pass it as `now` directly. */
  now: () => number
  date: () => Date
  /** Jump to a time. */
  set: (to: number | string | Date) => void
  /** Move forward (or back, negative) by `ms`; returns the new time. */
  advance: (ms: number) => number
}

const toMs = (t: number | string | Date) => (typeof t === "number" ? t : new Date(t).getTime())

export function fakeClock(start: number | string | Date = "2026-01-01T00:00:00Z"): FakeClock {
  let t = toMs(start)
  if (!Number.isFinite(t)) throw new Error(`fakeClock: not a time: ${String(start)}`)
  return {
    now: () => t,
    date: () => new Date(t),
    set: (to) => {
      t = toMs(to)
    },
    advance: (ms) => {
      t += ms
      return t
    },
  }
}
