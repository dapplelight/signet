import type { z } from "zod"
import { type BudgetLedger, costOf } from "./budget.js"
import { cacheKey, fingerprintSchema } from "./cache.js"
import {
  AiError,
  ALL_PROVIDERS_FAILED,
  BUDGET_EXCEEDED,
  isTransient,
  NO_PROVIDERS,
  SCHEMA_INVALID,
  UNPRICED_PROVIDER,
} from "./errors.js"
import type { BudgetOptions, Cache, ExtractResult, Provider } from "./types.js"

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createExtractor(config: ExtractConfig) {
  const timeoutMs = config.timeoutMs ?? 20_000
  const maxRetries = config.maxRetriesPerProvider ?? 1
  const ttl = config.cacheTtlSeconds ?? 3600
  const now = config.now ?? (() => Date.now())
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
      key = await cacheKey(fingerprintSchema(args.schema), args.instructions, args.input)
      const hit = await config.cache?.get(key)
      if (hit) {
        config.onEvent?.("ai.cache_hit", { key })
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
      if (!(await config.ledger.canSpend(args.budget?.maxCostUsd ?? 0, now(), budgetKey))) {
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

          const costUsd = costOf(usage, provider.pricing)

          // Per-call ceiling is enforced AFTER the spend, because the true cost
          // is only known from usage. It is recorded either way — the money is
          // already gone, and hiding it would corrupt the window ledger.
          await config.ledger?.record(costUsd, now(), budgetKey)
          if (args.budget?.maxCostUsd !== undefined && costUsd > args.budget.maxCostUsd) {
            throw new AiError(
              `Call cost ${costUsd.toFixed(6)} USD exceeded cap ${args.budget.maxCostUsd} USD`,
              BUDGET_EXCEEDED,
              429,
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
          if (useCache && key) await config.cache?.set(key, { value: parsed.data, meta }, ttl)
          config.onEvent?.("ai.ok", { provider: provider.name, costUsd, attempts })
          return { value: parsed.data, meta }
        } catch (err) {
          lastError = err
          // A budget refusal is the caller's answer, not something to retry or
          // fail over — every other provider would be refused identically.
          if (err instanceof AiError && err.code === BUDGET_EXCEEDED) throw err

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
