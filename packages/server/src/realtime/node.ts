/**
 * The realtime hub on a Node `http.Server`, with no dependency.
 *
 * Node ships a WebSocket client (the global `WebSocket`) but no server, so
 * this is a small RFC 6455 server over the `upgrade` event: text frames,
 * fragmentation, ping/pong and close, masked client frames only, and a size
 * cap checked from the frame header before anything is buffered. No
 * extensions (permessage-deflate) and no binary frames.
 *
 * ```ts
 * const server = createServer(handler)      // or @hono/node-server's server
 * attachRealtime(server, hub, { path: "/realtime", authenticate })
 * ```
 */

import { createHash } from "node:crypto"
import type { IncomingMessage, Server } from "node:http"
import type { Duplex } from "node:stream"
import { type AdmitOptions, admit, type RealtimeHub } from "./index.js"

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

export type NodeRealtimeOptions = AdmitOptions & {
  /** The upgrade path. Other paths are left to other `upgrade` listeners. Default "/realtime". */
  path?: string
  maxMessageBytes?: number
}

function frame(opcode: number, payload: Buffer): Buffer {
  const n = payload.length
  const head = n < 126 ? Buffer.alloc(2) : n < 65_536 ? Buffer.alloc(4) : Buffer.alloc(10)
  head[0] = 0x80 | opcode
  if (n < 126) head[1] = n
  else if (n < 65_536) {
    head[1] = 126
    head.writeUInt16BE(n, 2)
  } else {
    head[1] = 127
    head.writeBigUInt64BE(BigInt(n), 2)
  }
  return Buffer.concat([head, payload])
}

function refuse(socket: Duplex, res: Response) {
  socket.end(
    `HTTP/1.1 ${res.status} ${res.statusText || "Refused"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  )
}

/** Serve the hub on `server`'s upgrade requests. Returns a function that detaches it. */
export function attachRealtime(
  server: Server,
  hub: RealtimeHub,
  options: NodeRealtimeOptions,
): () => void {
  const { path = "/realtime", maxMessageBytes = 16_384 } = options
  const timer = setInterval(() => hub.sweep(), Math.min(hub.heartbeatMs, 5_000))
  timer.unref()

  const onUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    if (url.pathname !== path) return
    socket.on("error", () => socket.destroy())
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers))
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v)
    const key = req.headers["sec-websocket-key"]
    if (
      req.headers.upgrade?.toLowerCase() !== "websocket" ||
      req.headers["sec-websocket-version"] !== "13" ||
      typeof key !== "string"
    )
      return refuse(socket, new Response(null, { status: 400, statusText: "Bad Request" }))
    const who = await admit(new Request(url, { headers }), options)
    if (who instanceof Response) return refuse(socket, who)
    if (socket.destroyed) return

    const accept = createHash("sha1")
      .update(key + GUID)
      .digest("base64")
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )

    let open = true
    const close = (code = 1000, reason = "") => {
      if (!open) return
      open = false
      const body = Buffer.alloc(2 + Buffer.byteLength(reason))
      body.writeUInt16BE(code, 0)
      body.write(reason, 2)
      socket.end(frame(0x8, body))
    }
    const conn = hub.connect(
      {
        send: (d) => {
          if (open) socket.write(frame(0x1, Buffer.from(d)))
        },
        close,
        buffered: () => socket.writableLength,
      },
      who,
    )

    let buf: Buffer = head.length ? Buffer.from(head) : Buffer.alloc(0)
    let parts: Buffer[] = []
    let partsLen = 0
    const parse = () => {
      while (open && buf.length >= 2) {
        const b0 = buf[0] as number
        const b1 = buf[1] as number
        const fin = (b0 & 0x80) !== 0
        const opcode = b0 & 0x0f
        if ((b1 & 0x80) === 0 || (b0 & 0x70) !== 0) return close(1002, "protocol error")
        let len = b1 & 0x7f
        let off = 2
        if (len === 126) {
          if (buf.length < 4) return
          len = buf.readUInt16BE(2)
          off = 4
        } else if (len === 127) {
          if (buf.length < 10) return
          const big = buf.readBigUInt64BE(2)
          if (big > BigInt(maxMessageBytes)) return close(1009, "message too big")
          len = Number(big)
          off = 10
        }
        if (opcode < 0x8 && partsLen + len > maxMessageBytes) return close(1009, "message too big")
        if (opcode >= 0x8 && len > 125) return close(1002, "protocol error")
        if (buf.length < off + 4 + len) return
        const mask = buf.subarray(off, off + 4)
        const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len))
        for (let i = 0; i < payload.length; i++)
          payload[i] = (payload[i] as number) ^ (mask[i & 3] as number)
        buf = buf.subarray(off + 4 + len)

        if (opcode === 0x8) {
          const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000
          close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000)
          return
        }
        if (opcode === 0x9) {
          socket.write(frame(0xa, payload))
          continue
        }
        if (opcode === 0xa) continue
        if (opcode === 0x2) return close(1003, "text frames only")
        if (opcode !== 0x0 && opcode !== 0x1) return close(1002, "protocol error")
        if ((opcode === 0x1) === parts.length > 0) return close(1002, "protocol error")
        parts.push(payload)
        partsLen += len
        if (fin) {
          const text = Buffer.concat(parts).toString("utf8")
          parts = []
          partsLen = 0
          void conn.receive(text)
        }
      }
    }
    socket.on("data", (chunk: Buffer) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
      parse()
    })
    socket.on("close", () => {
      open = false
      conn.closed()
    })
    parse()
  }

  const listener = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void onUpgrade(req, socket, head)
  }
  server.on("upgrade", listener)
  return () => {
    server.off("upgrade", listener)
    clearInterval(timer)
  }
}
