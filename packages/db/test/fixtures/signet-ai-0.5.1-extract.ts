// Verbatim packages/ai/src/extract.ts as published in signet-ai 0.5.1
// (git show aa4ae08^:packages/ai/src/extract.ts), with only the sibling imports
// repointed at ../../../ai/src. Do not edit: it stands in for the old extractor
// that an app may still run next to a newer signet-db. See ai-spend.test.ts "version skew".
import type { z } from "zod"
import { type BudgetLedger, costOf } from "../../../ai/src/budget.js"
import { cacheKey, fingerprintSchema } from "../../../ai/src/cache.js"
import {
  AiError,
  ALL_PROVIDERS_FAILED,
  BUDGET_EXCEEDED,
  BUDGET_STORE_FAILED,
  isTransient,
  NO_PROVIDERS,
  SCHEMA_INVALID,
  UNPRICED_PROVIDER,
} from "../../../ai/src/errors.js"
import type { BudgetOptions, Cache, ExtractResult, Provider } from "../../../ai/src/types.js"
import { type OnUsage, reportUsage } from "../../../ai/src/usage.js"

export type ExtractConfig = {
  /**
   * Tried in order. Failover to the next entry is a config change, not a code
   * change — which is the point of the array.
   */
  providers: Provider[]
  cache?: Cache
  cacheTtlSeconds?: number
  ledger?: BudgetLedger
  /**
   * With a ledger, every provider must have `pricing`: an unpriced one costs $0
   * to the ledger, so the cap never fills. Set true only when a provider really
   * is free at the point of use.
   */
  allowUnpriced?: boolean
  /** Per-attempt timeout. Default 20s. */
  timeoutMs?: number
  /** Retries of the SAME provider before failing over. Default 1. */
  maxRetriesPerProvider?: number
  onEvent?: (event: string, data: Record<string, unknown>) => void
  /**
   * Token usage and cost of every provider call that returned, including one
   * then refused by the per-call cap. A cache hit is reported too, with
   * `costUsd: 0`, `cacheHit: true` and `savedUsd`, the original call's cost.
   * Fallbacks spend nothing and are not reported. Wrap an analytics sink with
   * `analyticsUsage(sink)`.
   */
  onUsage?: OnUsage
  now?: () => number
}

export type ExtractArgs<S extends z.ZodType> = {
  /**
   * Any Zod schema. The result type is INFERRED from it — do not pass an
   * explicit type argument.
   *
   * This was `z.ZodType<T>` with `T` on the function, which under zod 4 does
   * not infer from a concrete schema: `T` collapsed to `unknown`, so `value`
   * was `unknown` and every field access was a type error. Internal tests did
   * not catch it because they annotate the expected type first; only a
   * consumer using the inferred value sees it.
   */
  schema: S
  input: string
  instructions: string
  budget?: BudgetOptions
  /**
   * "throw" (default), or a value returned when every provider fails.
   * A default value does NOT bypass a budget refusal — running out of money is
   * a configuration problem the caller must see, not a soft failure.
   */
  fallback?: "throw" | { value: z.infer<S> }
  cache?: boolean
}

/**
 * A store failure must not look like a provider failure: that would fail over
 * and pay another provider, or return the fallback without recording the spend.
 */
async function budgetStore<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (err) {
    throw new AiError("AI budget store unavailable", BUDGET_STORE_FAILED, 503, err)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createExtractor(config: ExtractConfig) {
  const timeoutMs = config.timeoutMs ?? 20_000
  const maxRetries = config.maxRetriesPerProvider ?? 1
  const ttl = config.cacheTtlSeconds ?? 3600
  const now = config.now ?? (() => Date.now())
  // Part of the cache key: a different model is a different answer.
  const chain = config.providers.map((p) => `${p.name}/${p.model}`).join(",")
  if (config.ledger && !config.allowUnpriced) {
    const unpriced = config.providers.filter((p) => !p.pricing).map((p) => p.name)
    if (unpriced.length) {
      throw new AiError(
        `Budget ledger set but provider(s) ${unpriced.join(", ")} have no pricing, so their spend counts as $0. Add pricing (perCallUsd for flat-rate) or pass allowUnpriced: true.`,
        UNPRICED_PROVIDER,
        500,
      )
    }
  }

  /**
   * A cache is an optimisation: a store that is down reads as a miss, and a
   * failed write must not throw away an answer that was already paid for (it
   * would fail over and pay again).
   */
  async function cacheOp<R>(op: "get" | "set", fn: () => R | Promise<R>): Promise<R | undefined> {
    try {
      return await fn()
    } catch (err) {
      config.onEvent?.("ai.cache_error", { op, error: String((err as Error)?.message ?? err) })
      return undefined
    }
  }

  async function extract<S extends z.ZodType>(
    args: ExtractArgs<S>,
  ): Promise<ExtractResult<z.infer<S>>> {
    type T = z.infer<S>
    const started = now()
    if (!config.providers.length) {
      throw new AiError("No providers configured", NO_PROVIDERS, 500)
    }

    const useCache = args.cache !== false && !!config.cache
    let key: string | undefined
    if (useCache) {
      key = await cacheKey(fingerprintSchema(args.schema), args.instructions, args.input, chain)
      const hit = await cacheOp("get", () => config.cache?.get(key as string))
      if (hit) {
        config.onEvent?.("ai.cache_hit", { key })
        reportUsage(config.onUsage, {
          operation: "extract",
          provider: hit.meta.provider,
          model: hit.meta.model,
          costUsd: 0,
          cacheHit: true,
          savedUsd: hit.meta.costUsd,
          key: args.budget?.key,
          durationMs: now() - started,
        })
        return {
          value: hit.value as T,
          meta: { ...hit.meta, cacheHit: true, durationMs: now() - started },
        }
      }
    }

    // Window budget is checked BEFORE spending, whenever a ledger is set. Fails
    // closed, including when the store cannot be reached.
    const budgetKey = args.budget?.key
    if (config.ledger) {
      const ledger = config.ledger
      const room = await budgetStore(() =>
        ledger.canSpend(args.budget?.maxCostUsd ?? 0, now(), budgetKey),
      )
      if (!room) {
        throw new AiError(
          `AI budget window exhausted (${(await config.ledger.spentUsd(now())).toFixed(4)} USD spent)`,
          BUDGET_EXCEEDED,
          429,
        )
      }
    }

    let attempts = 0
    let lastError: unknown

    for (const provider of config.providers) {
      for (let retry = 0; retry <= maxRetries; retry++) {
        attempts++
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const { value, usage } = await provider.generate<T>({
            schema: args.schema,
            instructions: args.instructions,
            input: args.input,
            signal: controller.signal,
          })

          const costUsd = costOf(usage, provider.pricing)

          // Spend is recorded BEFORE validation: output that fails the schema
          // was still billed, and must count toward the window ledger.
          // Per-call ceiling is enforced AFTER the spend, because the true cost
          // is only known from usage. It is recorded either way — the money is
          // already gone, and hiding it would corrupt the window ledger.
          reportUsage(config.onUsage, {
            operation: "extract",
            provider: provider.name,
            model: provider.model,
            usage,
            costUsd,
            key: budgetKey,
            durationMs: now() - started,
          })
          const ledger = config.ledger
          if (ledger) await budgetStore(() => ledger.record(costUsd, now(), budgetKey))
          if (args.budget?.maxCostUsd !== undefined && costUsd > args.budget.maxCostUsd) {
            throw new AiError(
              `Call cost ${costUsd.toFixed(6)} USD exceeded cap ${args.budget.maxCostUsd} USD`,
              BUDGET_EXCEEDED,
              429,
            )
          }

          // Validate even though the provider claims to have done so — a
          // provider returning an unvalidated object is the failure this
          // package exists to prevent.
          const parsed = args.schema.safeParse(value)
          if (!parsed.success) {
            throw new AiError(
              `Model output failed schema validation: ${parsed.error.issues[0]?.message ?? "unknown"}`,
              SCHEMA_INVALID,
              502,
            )
          }

          const meta = {
            provider: provider.name,
            model: provider.model,
            usage,
            costUsd,
            cacheHit: false,
            attempts,
            durationMs: now() - started,
          }
          if (useCache && key) {
            const k = key
            await cacheOp("set", () => config.cache?.set(k, { value: parsed.data, meta }, ttl))
          }
          config.onEvent?.("ai.ok", { provider: provider.name, costUsd, attempts })
          return { value: parsed.data, meta }
        } catch (err) {
          lastError = err
          // A budget refusal is the caller's answer, not something to retry or
          // fail over — every other provider would be refused identically.
          if (
            err instanceof AiError &&
            (err.code === BUDGET_EXCEEDED || err.code === BUDGET_STORE_FAILED)
          )
            throw err

          const transient = isTransient(err)
          config.onEvent?.("ai.attempt_failed", {
            provider: provider.name,
            retry,
            transient,
            error: String((err as Error)?.message ?? err),
          })
          if (!transient) break // next provider; retrying this one cannot help
          if (retry < maxRetries) await sleep(Math.min(250 * 2 ** retry, 2000))
        } finally {
          clearTimeout(timer)
        }
      }
    }

    if (args.fallback && args.fallback !== "throw") {
      config.onEvent?.("ai.fallback_used", { attempts })
      return {
        value: args.fallback.value,
        meta: {
          provider: "fallback",
          model: "none",
          costUsd: 0,
          cacheHit: false,
          attempts,
          durationMs: now() - started,
        },
      }
    }

    throw new AiError(
      `All ${config.providers.length} provider(s) failed after ${attempts} attempt(s)`,
      ALL_PROVIDERS_FAILED,
      502,
      lastError,
    )
  }

  return { extract }
}

export type Extractor = ReturnType<typeof createExtractor>
