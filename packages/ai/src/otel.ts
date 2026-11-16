/**
 * Usage hooks for `onUsage`: put a call's tokens and cost on the active
 * OpenTelemetry span, record spend per user or org, or run several hooks.
 *
 * `@opentelemetry/api` is an optional peer loaded on first use. Without it, or
 * without an SDK registered, `otelUsage` does nothing. No exporter here.
 * Takes configuration; never reads env. Spans carry no prompts or outputs.
 */

import { type OnUsage, reportUsage, type UsageReport } from "./usage.js"

type Attrs = Record<string, string | number | boolean>
/** The slice of the OpenTelemetry API used here, so types need no install. */
export type OtelApiLike = {
  trace: {
    getActiveSpan():
      | { setAttribute(key: string, value: string | number | boolean): unknown }
      | undefined
  }
}

export type OtelUsageConfig = {
  /** Extra span attributes per report. Keep PII out: nothing here is scrubbed. */
  attributes?: (report: UsageReport) => Attrs
  /** Also set the budget key (often a user id) as `signet.key`. Default: false. */
  includeKey?: boolean
}

let loading: Promise<OtelApiLike | null> | undefined
/** The OpenTelemetry API, or null if it is not installed. Loaded once. */
function loadApi(): Promise<OtelApiLike | null> {
  // Literal specifier so bundlers (wrangler, Vite, webpack) include the optional peer.
  loading ??= import("@opentelemetry/api").then(
    (m) => m as unknown as OtelApiLike,
    () => null,
  )
  return loading
}

function attrsOf(r: UsageReport, cfg: OtelUsageConfig): Attrs {
  return {
    "gen_ai.system": r.provider,
    "gen_ai.request.model": r.model,
    ...(r.usage ? { "gen_ai.usage.input_tokens": r.usage.inputTokens } : {}),
    ...(r.usage ? { "gen_ai.usage.output_tokens": r.usage.outputTokens } : {}),
    "signet.cost_usd": r.costUsd,
    "signet.cache_hit": r.cacheHit === true,
    ...(r.savedUsd !== undefined ? { "signet.saved_usd": r.savedUsd } : {}),
    ...(cfg.includeKey && r.key !== undefined ? { "signet.key": r.key } : {}),
    ...cfg.attributes?.(r),
  }
}

/**
 * An `onUsage` that sets `gen_ai.system`, `gen_ai.request.model`,
 * `gen_ai.usage.input_tokens` and `output_tokens` (left out when the provider
 * reports no usage), `signet.cost_usd`, `signet.cache_hit` and `signet.saved_usd`
 * on the active span. Never the budget key, unless `includeKey`. No active
 * span: nothing happens.
 */
export function otelUsage(
  cfg: OtelUsageConfig = {},
  // ponytail: second argument exists so tests can pass a fake API without installing one
  load: () => Promise<OtelApiLike | null> = loadApi,
): OnUsage {
  void load() // start loading now so the first report finds it ready
  return (report) => {
    // The span is read after the load settles, still inside the caller's async context.
    void load()
      .then((otel) => {
        const span = otel?.trace.getActiveSpan()
        if (!span) return
        for (const [k, v] of Object.entries(attrsOf(report, cfg))) span.setAttribute(k, v)
      })
      .catch(() => {})
  }
}

/** Runs each hook in turn. A hook that throws never stops the others or fails the call. */
export function onUsageAll(...hooks: OnUsage[]): OnUsage {
  return (report) => {
    for (const hook of hooks) reportUsage(hook, report)
  }
}

export type SpendSubject = { userId?: string | null; orgId?: string | null }

/** Structural match for `createAiSpend(...)` from `@dapplelight/signet-db`, so this package does not import it. */
export type SpendRecorder = {
  record(subject: SpendSubject, units: number): unknown
}

export type SpendUsageConfig = {
  spend: SpendRecorder
  /** Who to charge for this report. An empty object charges only the global counter. */
  subject: (report: UsageReport) => SpendSubject
}

// Same as `usdToUnits` in signet-db: 1 unit = 1e-6 USD, rounded up.
const toUnits = (usd: number): number =>
  usd > 0 ? Math.ceil(Math.round(usd * 1_000_000 * 1000) / 1000) : 0

/**
 * An `onUsage` that records each report's cost (in cost units) per subject.
 * Unpriced and cache-hit reports record 0, which the ledger ignores. Do not
 * also pass it to an extractor that has `ledger`, or spend counts twice.
 */
export function spendUsage(cfg: SpendUsageConfig): OnUsage {
  return (report) => {
    void Promise.resolve(cfg.spend.record(cfg.subject(report), toUnits(report.costUsd))).catch(
      () => {},
    )
  }
}
