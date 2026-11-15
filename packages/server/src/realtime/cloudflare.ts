/**
 * The realtime hub in a Cloudflare Durable Object: one object per org, so
 * every connection and channel of a tenant meets in one place and two orgs
 * never share an instance.
 *
 * ```ts
 * // worker entry: export the class for the binding
 * export const RealtimeRoom = realtimeRoom({ authorize: (who, ch) => ch.startsWith("record:") })
 *
 * // wrangler.jsonc
 * "durable_objects": { "bindings": [{ "name": "REALTIME", "class_name": "RealtimeRoom" }] },
 * "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RealtimeRoom"] }]
 *
 * app.get("/realtime", (c) => connectRoom(c.env.REALTIME, c.req.raw, { authenticate }))
 * await roomPublisher(env.REALTIME).publish(orgId, "record:projects:42", "updated", { id: "42" })
 * ```
 *
 * The worker authenticates and picks the org's object; the object trusts the
 * identity it is handed, which is safe because a Durable Object is reachable
 * only through its binding. No `cloudflare:workers` import, so this module
 * loads (and is testable) under Bun and Node.
 */

import {
  type AdmitOptions,
  admit,
  createRealtime,
  type RealtimeHub,
  type RealtimeIdentity,
  type RealtimeOptions,
  type RealtimePublisher,
} from "./index.js"

/** The subset of DurableObjectNamespace this uses. */
export type RealtimeNamespace = {
  idFromName(name: string): unknown
  get(id: never): { fetch(input: string | Request, init?: RequestInit): Promise<Response> }
}

/** The subset of a workerd server-side WebSocket this uses. */
export type WorkerSocket = {
  accept(): void
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: "message", fn: (e: { data: unknown }) => void): void
  addEventListener(type: "close" | "error", fn: () => void): void
}

const IDENTITY = "x-signet-realtime-identity"
const stub = (ns: RealtimeNamespace, orgId: string) => ns.get(ns.idFromName(orgId) as never)

/**
 * A Durable Object class running a hub. `pair` makes the socket pair; the
 * default is workerd's global `WebSocketPair` (tests pass a fake).
 */
export function realtimeRoom(
  options: RealtimeOptions & { pair?: () => [client: unknown, server: WorkerSocket] } = {},
) {
  return class RealtimeRoom {
    readonly hub: RealtimeHub = createRealtime(options)
    timer: ReturnType<typeof setInterval> | undefined

    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      if (url.pathname === "/__publish" && request.method === "POST") {
        const p = (await request.json()) as {
          orgId: string
          channel: string
          event: string
          data?: unknown
          id?: string
        }
        await this.hub.publish(p.orgId, p.channel, p.event, p.data, p.id)
        return new Response(null, { status: 204 })
      }
      const raw = request.headers.get(IDENTITY)
      if (!raw || request.headers.get("upgrade")?.toLowerCase() !== "websocket")
        return new Response("Expected a WebSocket upgrade", { status: 426 })
      const who = JSON.parse(raw) as RealtimeIdentity
      const [client, server] = options.pair
        ? options.pair()
        : (Object.values(
            new (globalThis as unknown as { WebSocketPair: new () => object }).WebSocketPair(),
          ) as [unknown, WorkerSocket])
      server.accept()
      const conn = this.hub.connect(
        { send: (d) => server.send(d), close: (code, reason) => server.close(code, reason) },
        who,
      )
      server.addEventListener("message", (e) => {
        void conn.receive(e.data as string)
      })
      server.addEventListener("close", () => conn.closed())
      server.addEventListener("error", () => conn.closed())
      // ponytail: plain (non-hibernating) sockets keep presence in memory; the
      // object stays awake while anyone is connected. Move to the hibernation
      // API with presence in storage if idle-connection cost matters.
      this.timer ??= setInterval(() => {
        this.hub.sweep()
        if (this.hub.size === 0) {
          clearInterval(this.timer)
          this.timer = undefined
        }
      }, 5_000)
      return new Response(null, { status: 101, webSocket: client } as ResponseInit)
    }
  }
}

/** Authenticate an upgrade in the worker and hand it to the caller's org object. */
export async function connectRoom(
  ns: RealtimeNamespace,
  request: Request,
  options: AdmitOptions,
): Promise<Response> {
  const who = await admit(request, options)
  if (who instanceof Response) return who
  const headers = new Headers(request.headers)
  headers.set(IDENTITY, JSON.stringify(who))
  return stub(ns, who.orgId).fetch(new Request(request.url, { headers }))
}

/** Publish into an org's object from a worker, a cron or `realtimeOutbox`. */
export function roomPublisher(ns: RealtimeNamespace): RealtimePublisher {
  return {
    async publish(orgId, channel, event, data = null, id) {
      const res = await stub(ns, orgId).fetch("https://realtime/__publish", {
        method: "POST",
        body: JSON.stringify({ orgId, channel, event, data, id }),
      })
      if (!res.ok) throw new Error(`realtime publish failed: ${res.status}`)
    },
  }
}
