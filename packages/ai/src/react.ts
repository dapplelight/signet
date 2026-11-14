/**
 * Client half of `streamChat`. Requires `@ai-sdk/react` and `ai` (optional
 * peers), so this is a subpath and not on the barrel.
 */

import { type UseChatOptions, useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type HttpChatTransportInitOptions } from "ai"
import type { ChatMessage } from "./chat.js"
import type { Usage } from "./types.js"

export type { ChatMessage } from "./chat.js"

export type UseSignetChatOptions = Omit<UseChatOptions<ChatMessage>, "transport"> & {
  /** The route that returns `streamChat(...)`. Default "/api/chat". */
  api?: string
  /**
   * Extra headers, e.g. a CSRF token. Pass a function to read a fresh value per
   * request: `api` and `headers` are read once per chat `id`, like `useChat`.
   */
  headers?: HttpChatTransportInitOptions<ChatMessage>["headers"]
}

/** Token usage summed over the assistant messages' `metadata.usage`. */
export function sumUsage(messages: ChatMessage[]): Usage {
  let inputTokens = 0
  let outputTokens = 0
  for (const m of messages) {
    inputTokens += m.metadata?.usage?.inputTokens ?? 0
    outputTokens += m.metadata?.usage?.outputTokens ?? 0
  }
  return { inputTokens, outputTokens }
}

/**
 * `useChat` from `@ai-sdk/react` pointed at a `streamChat` route, plus `usage`
 * for the conversation so far. Everything `useChat` returns is passed through.
 *
 *   const { messages, sendMessage, status, stop, usage } = useSignetChat()
 *   sendMessage({ text: "Where is my order?" })
 */
export function useSignetChat({
  api = "/api/chat",
  headers,
  ...options
}: UseSignetChatOptions = {}) {
  const chat = useChat<ChatMessage>({
    ...options,
    transport: new DefaultChatTransport({ api, headers }),
  })
  return { ...chat, usage: sumUsage(chat.messages) }
}
