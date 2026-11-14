/**
 * Tool loops and streaming chat over the Vercel AI SDK. Requires `ai` 7 or later
 * (optional peer), so this is a subpath and not on the barrel.
 *
 * Models are passed in, from any AI SDK provider package: nothing here names a
 * provider.
 */

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  type LanguageModel,
  type ModelMessage,
  streamText,
  type ToolSet,
  toUIMessageStream,
  type UIMessage,
} from "ai"
import { costOf } from "./budget.js"
import { modelIdOf, toUsage } from "./providers/ai-sdk.js"
import type { Pricing, Usage } from "./types.js"
import { type OnUsage, reportUsage } from "./usage.js"

type CommonOptions = {
  /** A model from any AI SDK provider package. */
  model: LanguageModel
  system?: string
  tools?: ToolSet
  /**
   * Hard cap on model calls in the loop. Each tool round trip is one step.
   * Default 5. The loop also ends as soon as the model answers without calling
   * a tool.
   */
  maxSteps?: number
  /** Names this call in `onUsage`. Default "ai-sdk". */
  provider?: string
  pricing?: Pricing
  onUsage?: OnUsage
  /** Budget key passed through to `onUsage`, e.g. a user id. */
  key?: string
  abortSignal?: AbortSignal
}

export type RunToolsOptions = CommonOptions &
  ({ prompt: string; messages?: never } | { messages: ModelMessage[]; prompt?: never })

export type RunToolsResult = {
  text: string
  /** Model calls made. */
  steps: number
  /** True when the loop stopped at `maxSteps` with the model still calling tools. */
  capped: boolean
  toolCalls: { toolName: string; input: unknown }[]
  usage?: Usage
  costUsd: number
}

const DEFAULT_MAX_STEPS = 5

/** Token cost of the total, plus the flat per-call price once per step. */
const loopCost = (usage: Usage | undefined, pricing: Pricing | undefined, steps: number) =>
  costOf(usage, pricing) + (pricing?.perCallUsd ?? 0) * Math.max(0, steps - 1)

/**
 * Multi-step tool calling with a step cap. Tools run with their own `execute`;
 * the SDK feeds results back until the model answers or the cap is hit.
 *
 * Check `capped`: a capped run's `text` is whatever the last step said, often
 * empty, because the model wanted another tool call.
 */
export async function runTools(options: RunToolsOptions): Promise<RunToolsResult> {
  const started = Date.now()
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
  const result = await generateText({
    model: options.model,
    system: options.system,
    tools: options.tools,
    stopWhen: isStepCount(maxSteps),
    abortSignal: options.abortSignal,
    // Same rule as the extractor: no silent SDK retries under a budget.
    maxRetries: 0,
    ...(options.prompt !== undefined
      ? { prompt: options.prompt }
      : { messages: options.messages as ModelMessage[] }),
  })
  // AI SDK 7: `result.usage` is the total over every step.
  const usage = toUsage(result.usage)
  const costUsd = loopCost(usage, options.pricing, result.steps.length)
  reportUsage(options.onUsage, {
    operation: "tools",
    provider: options.provider ?? "ai-sdk",
    model: modelIdOf(options.model),
    usage,
    costUsd,
    key: options.key,
    durationMs: Date.now() - started,
  })
  const last = result.steps.at(-1)
  return {
    text: result.text,
    steps: result.steps.length,
    capped: result.steps.length >= maxSteps && last?.finishReason === "tool-calls",
    toolCalls: result.steps.flatMap((s) =>
      s.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
    ),
    usage,
    costUsd,
  }
}

/** Message metadata `streamChat` attaches to each assistant message. */
export type ChatMetadata = { usage?: Usage }
export type ChatMessage = UIMessage<ChatMetadata>

export type StreamChatOptions = CommonOptions & {
  /** The `messages` array `useChat` (or `useSignetChat`) POSTs. */
  messages: UIMessage[]
}

const isToolPart = (p: { type: string }) => p.type === "dynamic-tool" || p.type.startsWith("tool-")

/**
 * The client owns `messages`, so they are untrusted input. Keep only user and
 * assistant messages (system instructions come from `options.system`), and drop
 * tool parts: a browser could invent a tool result the model would take as real.
 * Tools the model calls in this request still run with their own `execute`.
 * ponytail: tool history from earlier turns is not replayed; keep it server-side if needed.
 */
function untrusted(messages: UIMessage[]): UIMessage[] {
  if (!Array.isArray(messages)) throw new TypeError("streamChat: messages must be an array")
  return messages
    .filter((m) => m?.role === "user" || m?.role === "assistant")
    .map((m) => ({ ...m, parts: (m.parts ?? []).filter((p) => !isToolPart(p)) }))
    .filter((m) => m.parts.length > 0)
}

/**
 * Server half of a streaming chat: takes the UI messages from the client,
 * streams the reply (tools and step cap included) and returns the `Response`
 * that `useSignetChat` from `@dapplelight/signet-ai/react` reads.
 *
 * Token usage goes to `onUsage` when the stream ends, and to the client as
 * message metadata (`message.metadata.usage`).
 *
 *   app.post("/api/chat", async (c) => {
 *     const { messages } = await c.req.json()
 *     return streamChat({ model, messages, onUsage, abortSignal: c.req.raw.signal })
 *   })
 */
export async function streamChat(options: StreamChatOptions): Promise<Response> {
  const started = Date.now()
  const result = streamText({
    model: options.model,
    system: options.system,
    tools: options.tools,
    messages: await convertToModelMessages(untrusted(options.messages), {
      tools: options.tools,
    }),
    stopWhen: isStepCount(options.maxSteps ?? DEFAULT_MAX_STEPS),
    abortSignal: options.abortSignal,
    maxRetries: 0,
    onEnd: (event) => {
      const usage = toUsage(event.usage)
      reportUsage(options.onUsage, {
        operation: "stream",
        provider: options.provider ?? "ai-sdk",
        model: modelIdOf(options.model),
        usage,
        costUsd: loopCost(usage, options.pricing, event.stepNumber + 1),
        key: options.key,
        durationMs: Date.now() - started,
      })
    },
  })
  return createUIMessageStreamResponse({
    stream: toUIMessageStream<ToolSet, ChatMessage>({
      stream: result.stream,
      messageMetadata: ({ part }) =>
        part.type === "finish" ? { usage: toUsage(part.totalUsage) } : undefined,
    }),
  })
}
