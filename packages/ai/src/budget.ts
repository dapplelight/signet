import type { Pricing, Usage } from "./types.js"

export function costOf(usage: Usage | undefined, pricing: Pricing | undefined): number {
  if (!pricing) return 0
  const tokens = usage
    ? (usage.inputTokens / 1_000_000) * (pricing.inputPerMTokens ?? 0) +
      (usage.outputTokens / 1_000_000) * (pricing.outputPerMTokens ?? 0)
    : 0
  return tokens + (pricing.perCallUsd ?? 0)
}

/**
 * Where spend is kept. The default, `memoryBudgetStore`, lives in one isolate:
 * on Workers every isolate has its own and a cold start empties it, so the real
 * cap is `windowUsd × isolates`. Share a cap across isolates with
 * `durableObjectBudgetStore` (exact, from `@dapplelight/signet-ai/budget-do`)
 * or `kvBudgetStore` (approximate, cheap).
 */
export type BudgetStore = {
  /** USD recorded for `key` within the last `windowSeconds`. */
  spent(key: string, windowSeconds: number, now: number): number | Promise<number>
  record(key: string, usd: number, windowSeconds: number, now: number): void | Promise<void>
}

export function memoryBudgetStore(): BudgetStore {
  const spends = new Map<string, Array<{ at: number; usd: number }>>()
  return {
    spent(key, windowSeconds, now) {
      const cutoff = now - windowSeconds * 1000
      const kept = (spends.get(key) ?? []).filter((s) => s.at > cutoff)
      spends.set(key, kept)
      return kept.reduce((n, s) => n + s.usd, 0)
    },
    record(key, usd, _windowSeconds, now) {
      spends.set(key, [...(spends.get(key) ?? []), { at: now, usd }])
    },
  }
}

/** The subset of a Workers KV namespace this uses. Structural, so no workers-types dependency. */
export type BudgetKv = {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

/**
 * Spend in Workers KV, shared across isolates. APPROXIMATE, in two ways:
 * the window is fixed (it resets on the boundary, so up to 2× the cap can pass
 * across one), and concurrent records read-modify-write the same key, so one can
 * be lost. Use it as a cheap backstop; use `durableObjectBudgetStore` when the
 * cap must hold.
 */
export function kvBudgetStore(kv: BudgetKv, prefix = "signet-ai-budget"): BudgetStore {
  const bucket = (key: string, windowSeconds: number, now: number) =>
    `${prefix}:${key}:${Math.floor(now / (windowSeconds * 1000))}`
  return {
    async spent(key, windowSeconds, now) {
      return Number((await kv.get(bucket(key, windowSeconds, now))) ?? 0)
    },
    async record(key, usd, windowSeconds, now) {
      const k = bucket(key, windowSeconds, now)
      const total = Number((await kv.get(k)) ?? 0) + usd
      // KV's minimum TTL is 60s.
      await kv.put(k, String(total), { expirationTtl: Math.max(60, windowSeconds * 2) })
    },
  }
}

export type BudgetLedgerOptions = {
  /** Default: `memoryBudgetStore()`, which is per isolate. */
  store?: BudgetStore
  /** Cap per `budget.key` (per user, per API key) within the same window. */
  perKeyUsd?: number
}

const GLOBAL = "global"

/**
 * Rolling-window spend ledger.
 *
 * Fails CLOSED: once the window is exhausted, calls are refused rather than
 * allowed through. A product must not be able to run up an unbounded bill
 * through this package, and "allow on doubt" is how that happens. A store that
 * cannot be reached throws, and the call is refused.
 *
 * Calls already in flight are not reserved against the cap, so concurrent calls
 * can overshoot it by their own cost.
 */
export function createBudgetLedger(
  windowUsd: number,
  windowSeconds = 3600,
  options: BudgetLedgerOptions = {},
) {
  const store = options.store ?? memoryBudgetStore()
  const perKey = (key: string) => `key:${key}`

  return {
    windowUsd,
    async spentUsd(now = Date.now(), key?: string): Promise<number> {
      return store.spent(key === undefined ? GLOBAL : perKey(key), windowSeconds, now)
    },
    async remainingUsd(now = Date.now()): Promise<number> {
      return Math.max(0, windowUsd - (await store.spent(GLOBAL, windowSeconds, now)))
    },
    /** False when the global window, or `key`'s window, has no room for this estimate. */
    async canSpend(estimateUsd: number, now = Date.now(), key?: string): Promise<boolean> {
      if ((await store.spent(GLOBAL, windowSeconds, now)) + estimateUsd > windowUsd) return false
      if (key === undefined || options.perKeyUsd === undefined) return true
      return (await store.spent(perKey(key), windowSeconds, now)) + estimateUsd <= options.perKeyUsd
    },
    async record(usd: number, now = Date.now(), key?: string): Promise<void> {
      if (usd <= 0) return
      await store.record(GLOBAL, usd, windowSeconds, now)
      if (key !== undefined) await store.record(perKey(key), usd, windowSeconds, now)
    },
  }
}

export type BudgetLedger = ReturnType<typeof createBudgetLedger>
