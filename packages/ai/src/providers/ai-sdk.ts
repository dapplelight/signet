/**
 * Vercel AI SDK adapter. Requires `ai` (>=5) as an optional peer.
 *
 * `generateObject` takes the Zod schema directly and returns a typed, validated
 * object — which is why the SDK was chosen over a workflow framework: this
 * package makes single extraction calls and needs nothing else.
 *
 * The model is passed in rather than constructed here, so adding a provider is
 * a config change in the product, not an edit to this package.
 */

import { generateObject, type LanguageModel } from "ai"
import type { GenerateArgs, Pricing, Provider, Usage } from "../types.js"

export type AiSdkProviderOptions = {
  /** Identifies this entry in `meta` and logs, e.g. "workers-ai". */
  name: string
  /** A model from any AI SDK provider package. */
  model: LanguageModel
  /** Shown in meta; omit when free at point of use, like Workers AI's allocation. */
  pricing?: Pricing
  /** Label for `meta.model` when the model object does not expose an id. */
  modelId?: string
  temperature?: number
  maxRetries?: number
}

export function aiSdkProvider(options: AiSdkProviderOptions): Provider {
  const modelId =
    options.modelId ??
    (typeof options.model === "string"
      ? options.model
      : ((options.model as { modelId?: string }).modelId ?? "unknown"))

  return {
    name: options.name,
    model: modelId,
    pricing: options.pricing,
    async generate<T>({ schema, instructions, input, signal }: GenerateArgs<T>) {
      const result = await generateObject({
        model: options.model,
        schema,
        system: instructions,
        prompt: input,
        abortSignal: signal,
        temperature: options.temperature ?? 0,
        // Retries and failover are this package's job, not the SDK's — doing
        // both means silent multiplication of spend under a budget cap.
        maxRetries: options.maxRetries ?? 0,
      })

      const u = result.usage as { inputTokens?: number; outputTokens?: number } | undefined
      const usage: Usage | undefined = u
        ? { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 }
        : undefined

      return { value: result.object as T, usage }
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
export function workersAiProvider(model: LanguageModel, modelId?: string): Provider {
  return aiSdkProvider({ name: "workers-ai", model, modelId, pricing: undefined })
}
