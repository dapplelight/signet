/**
 * Read a streamed response body as an async iterator: plain text chunks,
 * newline-delimited JSON, or server-sent events. Works on any `Response`, so
 * on `createRpcClient` calls (which have already thrown on a non-2xx), plain
 * `fetch`, and signet-ai's `streamChat`:
 *
 *   const res = await api.api.chat.$post({ json: { messages } })
 *   for await (const chunk of readSseJson<UIMessageChunk>(res)) {
 *     if (chunk.type === "text-delta") append(chunk.delta)
 *   }
 *
 * Breaking out of the loop cancels the body, so the server sees the client go.
 * The type parameter is what the server promised, not something checked here:
 * parse with a schema when the stream crosses a trust boundary.
 */

/** One server-sent event. `event` is "message" when the server named none. */
export type SseEvent = { event: string; data: string; id?: string; retry?: number }

/** The body's text, chunk by chunk as it arrives (UTF-8, split code points rejoined). */
export async function* readText(res: Response): AsyncGenerator<string> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        const tail = decoder.decode()
        if (tail) yield tail
        return
      }
      const text = decoder.decode(value, { stream: true })
      if (text) yield text
    }
  } finally {
    // Runs on a normal end, a throw, or the caller's `break`.
    await reader.cancel().catch(() => {})
  }
}

/** The body's lines, without their `\n` or `\r\n`. A last line with no newline is kept. */
async function* readLines(res: Response): AsyncGenerator<string> {
  let buffer = ""
  for await (const chunk of readText(res)) {
    buffer += chunk
    let nl = buffer.indexOf("\n")
    while (nl !== -1) {
      yield buffer.slice(0, nl).replace(/\r$/, "")
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf("\n")
    }
  }
  if (buffer) yield buffer.replace(/\r$/, "")
}

/** Newline-delimited JSON (`application/x-ndjson`): one value per non-blank line. */
export async function* readNdjson<T = unknown>(res: Response): AsyncGenerator<T> {
  for await (const line of readLines(res)) {
    if (line.trim()) yield JSON.parse(line) as T
  }
}

/**
 * Server-sent events (`text/event-stream`), parsed per the WHATWG spec:
 * multi-line `data:` joined with `\n`, comments (`:`) skipped, an event with
 * no data dropped.
 */
export async function* readSse(res: Response): AsyncGenerator<SseEvent> {
  let event = ""
  let data: string[] = []
  let id: string | undefined
  let retry: number | undefined
  for await (const line of readLines(res)) {
    if (line === "") {
      if (data.length) yield { event: event || "message", data: data.join("\n"), id, retry }
      event = ""
      data = []
      retry = undefined
      continue
    }
    if (line.startsWith(":")) continue
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "")
    if (field === "data") data.push(value)
    else if (field === "event") event = value
    else if (field === "id") id = value
    else if (field === "retry" && /^\d+$/.test(value)) retry = Number(value)
  }
  if (data.length) yield { event: event || "message", data: data.join("\n"), id, retry }
}

/**
 * Each event's `data` parsed as JSON, ending at the `[DONE]` sentinel that
 * OpenAI-style streams and the AI SDK's UI message stream (`streamChat`) send.
 */
export async function* readSseJson<T = unknown>(res: Response): AsyncGenerator<T> {
  for await (const e of readSse(res)) {
    if (e.data === "[DONE]") return
    yield JSON.parse(e.data) as T
  }
}
