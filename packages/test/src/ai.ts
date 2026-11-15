/**
 * A fake AI model on the AI SDK's own mock (`MockLanguageModelV4` from
 * `ai/test`): pass it anywhere a `LanguageModel` goes (`generateText`,
 * `streamText`, signet-ai's `aiSdkProvider`, `streamChat`). No network, no spend.
 *
 *   const model = fakeModel(["first answer", { budget: 8000 }])
 *   const ai = createExtractor({ providers: [aiSdkProvider({ name: "fake", model, pricing })] })
 *   expect(model.prompts()[0]).toContain("snowboard")
 *
 * Each reply is a string (sent as text) or any other value (sent as its JSON,
 * for structured output). A list answers in order, repeating the last one; a
 * function gets the prompt as text.
 */
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test"

export type FakeReply = unknown
export type FakeModel = MockLanguageModelV4 & {
  /** Every prompt so far (generate and stream), as JSON text, oldest first. */
  prompts(): string[]
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}
const stop = { unified: "stop" as const, raw: undefined }

export function fakeModel(
  replies: (prompt: string) => FakeReply,
  options?: { modelId?: string },
): FakeModel
export function fakeModel(replies: FakeReply, options?: { modelId?: string }): FakeModel
export function fakeModel(replies: unknown, options: { modelId?: string } = {}): FakeModel {
  const prompts: string[] = []
  let call = 0
  const next = (prompt: unknown): string => {
    const text = JSON.stringify(prompt)
    prompts.push(text)
    const r =
      typeof replies === "function"
        ? (replies as (p: string) => FakeReply)(text)
        : Array.isArray(replies)
          ? replies[Math.min(call, replies.length - 1)]
          : replies
    call++
    return typeof r === "string" ? r : JSON.stringify(r)
  }
  const model = new MockLanguageModelV4({
    provider: "signet-test",
    modelId: options.modelId ?? "fake-1",
    doGenerate: async (o) => ({
      content: [{ type: "text", text: next(o.prompt) }],
      finishReason: stop,
      usage,
      warnings: [],
    }),
    doStream: async (o) => {
      const text = next(o.prompt)
      return {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          // Word-sized deltas, so a UI test sees the stream arrive in pieces.
          ...(text.match(/\S+\s*/g) ?? [text]).map((delta) => ({
            type: "text-delta" as const,
            id: "t",
            delta,
          })),
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: stop, usage },
        ]),
      }
    },
  }) as FakeModel
  model.prompts = () => [...prompts]
  return model
}
