// Streamed bodies: text, NDJSON, SSE. Chunks are split mid-line and mid-code-point on purpose.
import { readNdjson, readSse, readSseJson, readText } from "../src/api/stream"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const enc = new TextEncoder()
/** A Response whose body arrives in exactly these byte chunks. */
const chunked = (parts: (string | Uint8Array)[], onCancel?: () => void) =>
  new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        const next = parts.shift()
        if (next === undefined) c.close()
        else c.enqueue(typeof next === "string" ? enc.encode(next) : next)
      },
      cancel: onCancel,
    }),
  )
const all = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

{
  const rupee = enc.encode("₹") // 3 bytes, split across chunks
  const text = (await all(readText(chunked(["a", rupee.slice(0, 1), rupee.slice(1), "b"])))).join(
    "",
  )
  ok("readText: rejoins a split code point", text === "a₹b", text)
  ok("readText: empty body yields nothing", (await all(readText(new Response(null)))).length === 0)
}
{
  const rows = await all(
    readNdjson<{ n: number }>(chunked(['{"n":1}\n{"n"', ":2}\r\n\n", '{"n":3}'])),
  )
  ok(
    "readNdjson: split lines, CRLF, blank lines, no final newline",
    rows.map((r) => r.n).join() === "1,2,3",
    rows,
  )
  let threw = false
  try {
    await all(readNdjson(chunked(["{bad}\n"])))
  } catch {
    threw = true
  }
  ok("readNdjson: a bad line throws", threw)
}
{
  const events = await all(
    readSse(
      chunked([
        ": comment\n",
        "event: note\nid: 7\ndata: one\nda",
        "ta: two\n\n",
        "retry: 3000\ndata:x\n\n",
        "event: empty\n\n",
        "data: last",
      ]),
    ),
  )
  ok(
    "readSse: event, id, multi-line data",
    events[0]?.event === "note" && events[0]?.id === "7" && events[0]?.data === "one\ntwo",
    events[0],
  )
  ok(
    "readSse: default event name, retry, optional space",
    events[1]?.event === "message" && events[1]?.data === "x" && events[1]?.retry === 3000,
    events[1],
  )
  ok("readSse: id carries over (last event id)", events[1]?.id === "7")
  ok(
    "readSse: event with no data dropped; unterminated last event kept",
    events.length === 3 && events[2]?.data === "last",
    events,
  )
}
{
  const chunks = await all(
    readSseJson<{ type: string }>(
      chunked(['data: {"type":"start"}\n\n', "data: [DONE]\n\n", 'data: {"type":"after"}\n\n']),
    ),
  )
  ok(
    "readSseJson: parses data, stops at [DONE]",
    chunks.length === 1 && chunks[0]?.type === "start",
    chunks,
  )
}
{
  let cancelled = false
  const res = chunked(["data: 1\n\n", "data: 2\n\n", "data: 3\n\n"], () => {
    cancelled = true
  })
  for await (const e of readSse(res)) if (e.data === "1") break
  ok("break cancels the body", cancelled)
}

console.log(`\nstream: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
