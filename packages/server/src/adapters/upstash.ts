/**
 * Upstash over plain fetch: Redis REST as a `KeyValue` (atomic `incr`), and QStash as a `Queue`.
 *
 * Works on Workers, Node, Bun, Netlify and Vercel. Pass the REST URL and token
 * from your env at request time; nothing is read at import.
 */

import type { RateLimitStore } from "../middleware/rate-limit.js"
import { type KeyValue, kvRateLimitStore, type Queue } from "./index.js"

export type UpstashConfig = { url: string; token: string }

type Reply = { result?: unknown; error?: string }

async function post(cfg: UpstashConfig, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${cfg.url.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as Reply | Reply[] | null
  if (!res.ok || !data || (!Array.isArray(data) && data.error)) {
    throw new Error(`Upstash ${res.status}: ${(data as Reply | null)?.error ?? "bad response"}`)
  }
  return data
}

async function command(cfg: UpstashConfig, args: string[]): Promise<unknown> {
  return ((await post(cfg, "", args)) as Reply).result
}

/**
 * Upstash Redis as a `KeyValue`. `incr` runs `SET key 0 EX ttl NX` then `INCR`
 * in one MULTI/EXEC, so the count is exact and the TTL is set once, when the
 * key is created.
 */
export function upstashKv(cfg: UpstashConfig): KeyValue {
  return {
    async get(key) {
      return ((await command(cfg, ["GET", key])) as string | null) ?? null
    },
    async set(key, value, opts) {
      await command(
        cfg,
        opts?.ttlSeconds ? ["SET", key, value, "EX", String(opts.ttlSeconds)] : ["SET", key, value],
      )
    },
    async delete(key) {
      await command(cfg, ["DEL", key])
    },
    async incr(key, ttlSeconds) {
      const replies = (await post(cfg, "/multi-exec", [
        ["SET", key, "0", "EX", String(ttlSeconds), "NX"],
        ["INCR", key],
      ])) as Reply[]
      const incr = replies[1]
      if (!incr || incr.error) throw new Error(`Upstash INCR: ${incr?.error ?? "no reply"}`)
      return Number(incr.result)
    },
  }
}

/** Exact, shared rate limiting anywhere fetch runs. */
export function upstashRateLimitStore(cfg: UpstashConfig): RateLimitStore {
  return kvRateLimitStore(upstashKv(cfg))
}

export type QstashConfig = {
  token: string
  /** Where QStash delivers each message, as a JSON POST. */
  destinationUrl: string
  /** Default `https://qstash.upstash.io`. Set your region's URL, e.g. `https://qstash-us-east-1.upstash.io`. */
  baseUrl?: string
}

/**
 * QStash as a `Queue`: each `send` publishes the message as JSON to
 * `destinationUrl`, with `Upstash-Delay` when a delay is given. Verify the
 * `Upstash-Signature` header in the receiving handler; QStash signs every delivery.
 */
export function qstashQueue<T>(cfg: QstashConfig): Queue<T> {
  const base = (cfg.baseUrl ?? "https://qstash.upstash.io").replace(/\/+$/, "")
  return {
    async send(message, opts) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      }
      if (opts?.delaySeconds) headers["Upstash-Delay"] = `${Math.ceil(opts.delaySeconds)}s`
      const res = await fetch(`${base}/v2/publish/${cfg.destinationUrl}`, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
      })
      if (!res.ok) throw new Error(`QStash ${res.status}: ${await res.text().catch(() => "")}`)
    },
  }
}
