import type { Usage } from "./types.js"

/** One model call's spend, as reported to `onUsage`. */
export type UsageReport = {
  /** Which helper made the call. */
  operation: "extract" | "tools" | "stream" | "embed" | "ground"
  provider: string
  model: string
  /** Missing when the provider reports none. Embeddings report input tokens only. */
  usage?: Usage
  /** From the provider's `pricing`; 0 when unpriced. */
  costUsd: number
  /** The budget key (a user id, an API key) when the caller passed one, for per-user cost. */
  key?: string
  durationMs: number
}

export type OnUsage = (report: UsageReport) => void

/**
 * Calls the hook and swallows what it throws: a broken analytics hook must not
 * fail a call whose money is already spent.
 */
export function reportUsage(onUsage: OnUsage | undefined, report: UsageReport): void {
  try {
    onUsage?.(report)
  } catch {
    // deliberately ignored, see above
  }
}

/**
 * Structural match for `AnalyticsSink` from `@dapplelight/signet-server/analytics`,
 * so this package does not depend on the server one.
 */
export type UsageSink = {
  write(
    events: { name: string; props?: Record<string, string | number | undefined>; ts?: number }[],
  ): unknown
}

/**
 * An `onUsage` that writes each report to an analytics sink as one event
 * (default name `ai.usage`) with token counts, cost and the budget key as props.
 */
export function analyticsUsage(sink: UsageSink, name = "ai.usage"): OnUsage {
  return (r) => {
    void Promise.resolve(
      sink.write([
        {
          name,
          props: {
            operation: r.operation,
            provider: r.provider,
            model: r.model,
            inputTokens: r.usage?.inputTokens,
            outputTokens: r.usage?.outputTokens,
            costUsd: r.costUsd,
            durationMs: r.durationMs,
            key: r.key,
          },
        },
      ]),
    ).catch(() => {})
  }
}
