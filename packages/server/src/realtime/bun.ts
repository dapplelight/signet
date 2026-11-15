/**
 * The realtime hub on Bun's built-in WebSocket server.
 *
 * ```ts
 * const hub = createRealtime({ authorize })
 * const live = bunRealtime(hub, { authenticate })
 * Bun.serve({
 *   fetch: (req, server) =>
 *     new URL(req.url).pathname === "/realtime" ? live.upgrade(req, server) : app.fetch(req),
 *   websocket: live.websocket,
 * })
 * ```
 *
 * Bun's types are structural here, so this module typechecks without bun-types.
 */

import {
  type AdmitOptions,
  admit,
  type RealtimeConnection,
  type RealtimeHub,
  type RealtimeIdentity,
} from "./index.js"

type Data = { who: RealtimeIdentity; conn?: RealtimeConnection }

/** The subset of Bun's ServerWebSocket this uses. */
export type BunSocket = {
  data: Data
  send(data: string): number
  close(code?: number, reason?: string): void
  getBufferedAmount(): number
}

/** The subset of Bun's Server this uses. */
export type BunServer = {
  upgrade(request: Request, options: { data: Data }): boolean
}

export function bunRealtime(
  hub: RealtimeHub,
  options: AdmitOptions & { maxMessageBytes?: number; maxBufferedBytes?: number },
) {
  const { maxMessageBytes = 16_384, maxBufferedBytes = 1_048_576 } = options
  const timer = setInterval(() => hub.sweep(), Math.min(hub.heartbeatMs, 5_000))
  ;(timer as { unref?: () => void }).unref?.()
  return {
    /** Answer an upgrade request: undefined once upgraded, else the refusal. */
    async upgrade(request: Request, server: BunServer): Promise<Response | undefined> {
      const who = await admit(request, options)
      if (who instanceof Response) return who
      return server.upgrade(request, { data: { who } })
        ? undefined
        : new Response("Expected a WebSocket upgrade", { status: 426 })
    },
    /** Pass as `Bun.serve({ websocket })`. */
    websocket: {
      maxPayloadLength: maxMessageBytes,
      backpressureLimit: maxBufferedBytes,
      closeOnBackpressureLimit: true,
      open(ws: BunSocket) {
        ws.data.conn = hub.connect(
          {
            send: (d) => void ws.send(d),
            close: (code, reason) => ws.close(code, reason),
            buffered: () => ws.getBufferedAmount(),
          },
          ws.data.who,
        )
      },
      message(ws: BunSocket, message: string | Uint8Array) {
        // Binary frames are not part of the protocol: the hub closes on non-strings.
        void ws.data.conn?.receive(message as string)
      },
      close(ws: BunSocket) {
        ws.data.conn?.closed()
      },
    },
    /** Stop the sweep timer. */
    stop() {
      clearInterval(timer)
    },
  }
}
