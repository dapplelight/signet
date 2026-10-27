/**
 * @dapplelight/signet-ai — provider-agnostic structured LLM calls.
 *
 * The package never returns free text. Every call goes through a Zod schema, so
 * the result is typed and validated or it is an error.
 */

import type { z } from "zod"

/** Per-million-token pricing, used to compute and cap spend. */
export type Pricing = { inputPerMTokens: number; outputPerMTokens: number }

export type Usage = { inputTokens: number; outputTokens: number }

// biome-ignore lint/correctness/noUnusedVariables: T is part of the public Provider signature (generate<T>(args: GenerateArgs<T>)); removing it breaks implementations
export type GenerateArgs<T> = {
  /**
   * The schema, unparameterised. A provider only needs it at runtime — to pass
   * to the SDK or to shape a prompt — and narrowing it here fights variance at
   * every call site without buying the provider anything. The caller's type
   * comes from `generate<T>`.
   */
  schema: z.ZodType
  instructions: string
  input: string
  signal: AbortSignal
}

/**
 * One way to reach a model.
 *
 * Deliberately a plain function rather than an SDK type: the orchestration is
 * then testable with no network, and adding a provider is a config change
 * rather than a code change in every product.
 */
export type Provider = {
  /** Identifies this entry in `meta` and in logs. */
  name: string
  model: string
  /** Omit when the provider is free at the point of use. */
  pricing?: Pricing
  generate<T>(args: GenerateArgs<T>): Promise<{ value: T; usage?: Usage }>
}

export type CacheEntry = { value: unknown; meta: ExtractMeta }

/** Pluggable so Workers can use the Cache API and Node something else. */
export type Cache = {
  get(key: string): Promise<CacheEntry | undefined> | CacheEntry | undefined
  set(key: string, entry: CacheEntry, ttlSeconds: number): Promise<void> | void
}

export type BudgetOptions = {
  /** Hard ceiling for this call. Estimated before spending, enforced after. */
  maxCostUsd?: number
  /** Ceiling across a rolling window. Fails closed once exhausted. */
  windowUsd?: number
  windowSeconds?: number
}

export type ExtractMeta = {
  provider: string
  model: string
  usage?: Usage
  costUsd: number
  cacheHit: boolean
  /** Total provider calls made, including retries and failovers. */
  attempts: number
  durationMs: number
}

export type ExtractResult<T> = { value: T; meta: ExtractMeta }
