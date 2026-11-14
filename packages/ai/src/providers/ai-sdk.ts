/**
 * Vercel AI SDK adapter. Requires `ai` (>=5) as an optional peer.
 *
 * `generateText` with `output: Output.object({ schema })` takes the Zod schema
 * directly and returns a typed, validated object. It replaced `generateObject`,
 * which AI SDK 6 deprecated. Requires `ai` 7 or later.
 *
 * The model is passed in rather than constructed here, so adding a provider is
 * a config change in the product, not an edit to this package.
 */

import { generateText, type LanguageModel, Output } from "ai"
import type { GenerateArgs, Pricing, Provider, Usage } from "../types.js"

export type AiSdkProviderOptions = {
  /** Identifies this entry in `meta` and logs, e.g. "workers-ai". */
  name: string
  /** A model from any AI SDK provider package. */
  model: LanguageModel
  /** Required with a budget ledger, unless the extractor sets `allowUnpriced`. */
  pricing?: Pricing
  /** Label for `meta.model` when the model object does not expose an id. */
  modelId?: string
  temperature?: number
  maxRetries?: number
}

/** A label for a model: the string itself, or the model object's `modelId`. */
export function modelIdOf(model: unknown): string {
  if (typeof model === "string") return model
  return (model as { modelId?: string } | undefined)?.modelId ?? "unknown"
}

/** The SDK's usage shape to this package's, which has no undefined counts. */
export function toUsage(
  u: { inputTokens?: number; outputTokens?: number } | undefined,
): Usage | undefined {
  return u ? { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 } : undefined
}

export function aiSdkProvider(options: AiSdkProviderOptions): Provider {
  const modelId = options.modelId ?? modelIdOf(options.model)

  return {
    name: options.name,
    model: modelId,
    pricing: options.pricing,
    async generate<T>({ schema, instructions, input, signal }: GenerateArgs<T>) {
      const result = await generateText({
        model: options.model,
        output: Output.object({ schema }),
        system: instructions,
        prompt: input,
        abortSignal: signal,
        temperature: options.temperature ?? 0,
        // Retries and failover are this package's job, not the SDK's — doing
        // both means silent multiplication of spend under a budget cap.
        maxRetries: options.maxRetries ?? 0,
      })

      return { value: result.output as T, usage: toUsage(result.usage) }
    },
  }
}

/**
 * Workers AI through the Worker's `AI` binding — no extra network hop.
 *
 * Free allocation is 10,000 Neurons/day on both Workers plans. Exhausting it
 * returns error 3036 as a 429, which `isTransient` classifies as retryable and
 * the provider chain turns into a failover.
 *
 * Pass the model from `workers-ai-provider`:
 *   createWorkersAI({ binding: env.AI })("@cf/zai-org/glm-4.7-flash")
 */
export function workersAiProvider(
  model: LanguageModel,
  modelId?: string,
  pricing?: Pricing,
): Provider {
  return aiSdkProvider({ name: "workers-ai", model, modelId, pricing })
}
