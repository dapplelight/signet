import type { Pricing, Usage } from "./types.js"

export function costOf(usage: Usage | undefined, pricing: Pricing | undefined): number {
  if (!usage || !pricing) return 0
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTokens +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTokens
  )
}

/**
 * Rolling-window spend ledger.
 *
 * Fails CLOSED: once the window is exhausted, calls are refused rather than
 * allowed through. A product must not be able to run up an unbounded bill
 * through this package, and "allow on doubt" is how that happens.
 */
export function createBudgetLedger(windowUsd: number, windowSeconds = 3600) {
  let spends: Array<{ at: number; usd: number }> = []

  const prune = (now: number) => {
    const cutoff = now - windowSeconds * 1000
    spends = spends.filter((s) => s.at > cutoff)
  }

  return {
    spentUsd(now = Date.now()): number {
      prune(now)
      return spends.reduce((n, s) => n + s.usd, 0)
    },
    remainingUsd(now = Date.now()): number {
      return Math.max(0, windowUsd - this.spentUsd(now))
    },
    /** False when the window has no room left for this estimate. */
    canSpend(estimateUsd: number, now = Date.now()): boolean {
      return this.spentUsd(now) + estimateUsd <= windowUsd
    },
    record(usd: number, now = Date.now()): void {
      if (usd > 0) spends.push({ at: now, usd })
    },
    reset(): void {
      spends = []
    },
  }
}

export type BudgetLedger = ReturnType<typeof createBudgetLedger>
