import type { Provider } from "./types.js"

/**
 * Deterministic provider for tests. No network, no spend.
 *
 * Products must be able to test their own extraction logic without either.
 */
export function fakeProvider(
  responses: unknown | unknown[] | ((input: string) => unknown),
  options: {
    name?: string
    model?: string
    usage?: { inputTokens: number; outputTokens: number }
    failTimes?: number
    error?: unknown
  } = {},
): Provider {
  let call = 0
  let failed = 0
  const list = Array.isArray(responses) ? responses : null

  return {
    name: options.name ?? "fake",
    model: options.model ?? "fake-1",
    pricing: { inputPerMTokens: 0, outputPerMTokens: 0 },
    async generate<T>({
      input,
    }: {
      input: string
    }): Promise<{ value: T; usage?: { inputTokens: number; outputTokens: number } }> {
      if (options.failTimes && failed < options.failTimes) {
        failed++
        throw options.error ?? Object.assign(new Error("fake transient"), { status: 503 })
      }
      const value =
        typeof responses === "function"
          ? (responses as (i: string) => unknown)(input)
          : list
            ? list[Math.min(call, list.length - 1)]
            : responses
      call++
      return { value: value as T, usage: options.usage }
    },
  }
}
