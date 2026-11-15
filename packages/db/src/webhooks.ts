/**
 * Outbound webhooks: endpoints registered per user or org, each with its own
 * signing secret; deliveries signed Standard-Webhooks style; retries with
 * backoff through the transactional outbox; a delivery log with every
 * attempt's response; manual redelivery; endpoints switched off after
 * repeated failures.
 *
 * ```ts
 * const webhooks = createWebhooks(db, { endpoints: schema.webhookEndpoints, deliveries: schema.webhookDeliveries })
 * const { endpoint, secret } = await webhooks.register({ owner: orgId, url, events: ["order.created"] })
 *
 * // With the change that caused it, in one atomic write:
 * await db.batch([(tx) => tx.insert(orders).values(order), ...(await webhooks.statements({ owner: orgId, type: "order.created", data: order }))])
 *
 * // From a cron: webhook messages go to `webhooks.send`, the rest to the app's queue.
 * await drainOutbox(db, { send: (m) => (m.topic === WEBHOOK_TOPIC ? webhooks.send(m) : queue.send(m)) })
 * ```
 *
 * Each delivery is one outbox row: a failed attempt throws, so `drainOutbox`
 * retries it with its backoff and marks it dead after its `maxAttempts`.
 * Give `createWebhooks` the same `maxAttempts`, so the log shows the last
 * attempt as `failed` rather than `retrying`.
 *
 * Receivers dedupe on `webhook-id` (the event id): it is the same on every
 * retry and redelivery. Verify with `verifyWebhook` from
 * `@dapplelight/signet-lib/webhooks`.
 */

import { generateWebhookSecret, signWebhook } from "@dapplelight/signet-lib/webhooks"
import { and, desc, eq, getTableColumns, isNull, lt, type Table } from "drizzle-orm"
import { isCiphertext } from "./cipher.js"
import type { SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import { newId } from "./id.js"
import { enqueue, type OutboxMessage } from "./outbox.js"

/** The outbox topic of webhook deliveries. */
export const WEBHOOK_TOPIC = "signet.webhook"

export type WebhookEndpoint = {
  id: string
  owner: string
  url: string
  events: string[]
  description: string | null
  /** Failed attempts since the last success. */
  failures: number
  disabledAt: Date | null
  disabledReason: string | null
  createdAt: Date
  updatedAt: Date
}

export type WebhookDeliveryStatus = "pending" | "retrying" | "delivered" | "failed" | "skipped"

export type WebhookDelivery = {
  id: string
  endpointId: string
  owner: string
  eventId: string
  type: string
  body: string
  status: WebhookDeliveryStatus
  attempts: number
  responseStatus: number | null
  responseBody: string | null
  error: string | null
  durationMs: number | null
  createdAt: Date
  lastAttemptAt: Date | null
  deliveredAt: Date | null
}

export type WebhooksOptions = {
  endpoints: Table
  deliveries: Table
  /** Default global `fetch`. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  /** Attempts per delivery; match `drainOutbox`'s. Default 10. */
  maxAttempts?: number
  /** Consecutive failed attempts (across deliveries) before the endpoint is switched off. Default 20. */
  disableAfter?: number
  /** Per attempt. Default 10 s. */
  timeoutMs?: number
  /**
   * Allow `http:` and private or loopback hosts (local development, tests).
   * Default false: endpoints must be `https:` on a public host name.
   */
  allowPrivateUrls?: boolean
}

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
// biome-ignore lint/suspicious/noExplicitAny: webhook columns are known by name
type Cols = Record<string, any>

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i

/**
 * Throws BAD_VALUE unless `url` is an absolute https URL on a public host.
 * Literal IPs in private ranges and IPv6 literals are refused; a public name
 * that resolves to a private address is not caught here (the runtime's
 * egress rules are the place for that).
 */
export function assertWebhookUrl(url: string, allowPrivate = false): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new SignetDbError("BAD_VALUE", "Webhook url is not a valid URL.")
  }
  if (allowPrivate) {
    if (u.protocol !== "https:" && u.protocol !== "http:")
      throw new SignetDbError("BAD_VALUE", "Webhook url must be http or https.")
    return
  }
  if (u.protocol !== "https:") throw new SignetDbError("BAD_VALUE", "Webhook url must be https.")
  if (PRIVATE_HOST.test(u.hostname) || u.username || u.password)
    throw new SignetDbError("BAD_VALUE", "Webhook url must be a public host without credentials.")
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

export function createWebhooks(db: SignetDb<unknown>, options: WebhooksOptions) {
  const E = options.endpoints
  const D = options.deliveries
  const e = getTableColumns(E) as Cols
  const d = getTableColumns(D) as Cols
  const o = db.orm as AnyOrm
  const maxAttempts = options.maxAttempts ?? 10
  const disableAfter = options.disableAfter ?? 20
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init))

  const seal = async (secret: string) => (db.cipher ? db.cipher.encrypt(secret) : secret)
  const unseal = async (stored: string) =>
    db.cipher && isCiphertext(stored) ? db.cipher.decrypt(stored) : stored

  const publicEndpoint = (row: Cols): WebhookEndpoint => {
    const { secret: _, ...rest } = row
    return rest as WebhookEndpoint
  }
  const mine = (owner: string, id: string) => and(eq(e.owner, owner), eq(e.id, id))

  const checkEvents = (events: string[]) => {
    if (
      !Array.isArray(events) ||
      events.length === 0 ||
      events.some((x) => typeof x !== "string" || !x)
    )
      throw new SignetDbError("BAD_VALUE", 'events is a non-empty list of event types, or ["*"].')
  }

  async function getRow(owner: string, id: string): Promise<Cols | undefined> {
    return (await o.select().from(E).where(mine(owner, id)).limit(1))[0]
  }

  /** Statements that create a delivery row and its outbox row for one endpoint. */
  function deliveryStatements(endpoint: Cols, event: { id: string; type: string; body: string }) {
    const id = newId()
    return {
      id,
      statements: [
        (tx: unknown) =>
          (tx as AnyOrm).insert(D).values({
            id,
            endpointId: endpoint.id,
            owner: endpoint.owner,
            eventId: event.id,
            type: event.type,
            body: event.body,
          }),
        enqueue(db, WEBHOOK_TOPIC, { deliveryId: id }),
      ],
    }
  }

  const api = {
    /** Register an endpoint. The secret is returned here only; store it on the receiver. */
    async register(input: {
      owner: string
      url: string
      /** Event types, or `["*"]` for all. */
      events: string[]
      description?: string
      /** Bring your own `whsec_` secret. Default: a new random one. */
      secret?: string
    }): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
      assertWebhookUrl(input.url, options.allowPrivateUrls)
      checkEvents(input.events)
      const secret = input.secret ?? generateWebhookSecret()
      const [row] = await o
        .insert(E)
        .values({
          owner: input.owner,
          url: input.url,
          events: input.events,
          description: input.description ?? null,
          secret: await seal(secret),
        })
        .returning()
      return { endpoint: publicEndpoint(row), secret }
    },

    /** The owner's endpoints, newest first, without secrets. */
    async list(owner: string): Promise<WebhookEndpoint[]> {
      const rows = await o.select().from(E).where(eq(e.owner, owner)).orderBy(desc(e.id))
      return rows.map(publicEndpoint)
    },

    async get(owner: string, id: string): Promise<WebhookEndpoint | null> {
      const row = await getRow(owner, id)
      return row ? publicEndpoint(row) : null
    },

    /** Change the url, events or description; `enabled: true` turns a disabled endpoint back on and clears its failures. */
    async update(
      owner: string,
      id: string,
      patch: { url?: string; events?: string[]; description?: string | null; enabled?: boolean },
    ): Promise<WebhookEndpoint | null> {
      if (patch.url !== undefined) assertWebhookUrl(patch.url, options.allowPrivateUrls)
      if (patch.events !== undefined) checkEvents(patch.events)
      const set: Cols = { updatedAt: new Date() }
      if (patch.url !== undefined) set.url = patch.url
      if (patch.events !== undefined) set.events = patch.events
      if (patch.description !== undefined) set.description = patch.description
      if (patch.enabled === true)
        Object.assign(set, { disabledAt: null, disabledReason: null, failures: 0 })
      if (patch.enabled === false)
        Object.assign(set, { disabledAt: new Date(), disabledReason: "Disabled by owner" })
      const [row] = await o.update(E).set(set).where(mine(owner, id)).returning()
      return row ? publicEndpoint(row) : null
    },

    /** A new secret; the old one stops signing at once. */
    async rotateSecret(owner: string, id: string): Promise<{ secret: string } | null> {
      const secret = generateWebhookSecret()
      const rows = await o
        .update(E)
        .set({ secret: await seal(secret), updatedAt: new Date() })
        .where(mine(owner, id))
        .returning({ id: e.id })
      return rows.length ? { secret } : null
    },

    /** Delete an endpoint. Its pending deliveries are skipped when they come up. */
    async remove(owner: string, id: string): Promise<boolean> {
      const rows = await o.delete(E).where(mine(owner, id)).returning({ id: e.id })
      return rows.length > 0
    },

    /**
     * The statements that queue `type` to every enabled endpoint of `owner`
     * subscribed to it: put them in the same `db.batch` as the change. `id` is
     * the event id (`webhook-id`); pass a stable one to make the emit itself
     * idempotent on the receiver's side.
     */
    async statements(event: {
      owner: string
      type: string
      data: unknown
      id?: string
    }): Promise<((tx: unknown) => unknown)[]> {
      const id = event.id ?? `evt_${newId()}`
      const body = JSON.stringify({
        type: event.type,
        timestamp: new Date().toISOString(),
        data: event.data,
      })
      const endpoints: Cols[] = await o
        .select()
        .from(E)
        .where(and(eq(e.owner, event.owner), isNull(e.disabledAt)))
      return endpoints
        .filter((x) => (x.events as string[]).some((t) => t === "*" || t === event.type))
        .flatMap((x) => deliveryStatements(x, { id, type: event.type, body }).statements)
    },

    /** `statements` run on their own. Returns how many deliveries were queued. */
    async emit(event: {
      owner: string
      type: string
      data: unknown
      id?: string
    }): Promise<number> {
      const s = await api.statements(event)
      await db.batch(s)
      return s.length / 2
    },

    /**
     * Deliver one outbox message: sign, POST, log the attempt. Resolves on a
     * 2xx, or when there is nothing to do (already delivered, endpoint gone or
     * disabled); throws otherwise so `drainOutbox` retries it.
     */
    async send(message: OutboxMessage): Promise<void> {
      if (message.topic !== WEBHOOK_TOPIC)
        throw new SignetDbError("BAD_VALUE", `webhooks.send got topic "${message.topic}".`)
      const deliveryId = (message.payload as { deliveryId?: string } | null)?.deliveryId ?? ""
      const [del]: Cols[] = await o.select().from(D).where(eq(d.id, deliveryId)).limit(1)
      // Outbox delivery is at least once: a delivered (or given-up) row is never sent again.
      if (!del || del.status === "delivered" || del.status === "skipped" || del.status === "failed")
        return
      const [ep]: Cols[] = await o.select().from(E).where(eq(e.id, del.endpointId)).limit(1)
      if (!ep || ep.disabledAt) {
        await o
          .update(D)
          .set({ status: "skipped", error: ep ? "Endpoint disabled" : "Endpoint deleted" })
          .where(eq(d.id, del.id))
        return
      }

      const attempts = del.attempts + 1
      const headers = await signWebhook({
        secret: await unseal(ep.secret),
        id: del.eventId,
        body: del.body,
      })
      const started = Date.now()
      let status: number | null = null
      let text: string | null = null
      let error: string | null = null
      try {
        const res = await doFetch(ep.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Signet-Webhooks",
            ...headers,
          },
          body: del.body,
          redirect: "manual",
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        })
        status = res.status
        text = truncate(await res.text().catch(() => ""), 2048)
        if (!res.ok) error = `HTTP ${res.status}`
      } catch (err) {
        error = truncate(String(err instanceof Error ? err.message : err), 1000)
      }
      const now = new Date()
      const ok = error === null
      const last = !ok && attempts >= maxAttempts
      await o
        .update(D)
        .set({
          status: ok ? "delivered" : last ? "failed" : "retrying",
          attempts,
          responseStatus: status,
          responseBody: text,
          error,
          durationMs: Date.now() - started,
          lastAttemptAt: now,
          ...(ok ? { deliveredAt: now } : {}),
        })
        .where(eq(d.id, del.id))
      if (ok) {
        if (ep.failures) await o.update(E).set({ failures: 0 }).where(eq(e.id, ep.id))
        return
      }
      const failures = ep.failures + 1
      const disable = failures >= disableAfter
      await o
        .update(E)
        .set({
          failures,
          ...(disable
            ? {
                disabledAt: now,
                disabledReason: `Disabled after ${failures} failed attempts in a row`,
              }
            : {}),
        })
        .where(eq(e.id, ep.id))
      // Disabled now: stop retrying this one too; redeliver after turning it back on.
      if (disable) {
        if (!last) await o.update(D).set({ status: "failed" }).where(eq(d.id, del.id))
        return
      }
      throw new SignetDbError("WEBHOOK_FAILED", `Webhook ${del.id} to ${ep.url}: ${error}`)
    },

    /** The owner's delivery log, newest first. `before` is a delivery id, for paging. */
    async deliveries(
      owner: string,
      query: {
        endpointId?: string
        status?: WebhookDeliveryStatus
        limit?: number
        before?: string
      } = {},
    ): Promise<WebhookDelivery[]> {
      const where = and(
        eq(d.owner, owner),
        query.endpointId ? eq(d.endpointId, query.endpointId) : undefined,
        query.status ? eq(d.status, query.status) : undefined,
        query.before ? lt(d.id, query.before) : undefined,
      )
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
      return (await o
        .select()
        .from(D)
        .where(where)
        .orderBy(desc(d.id))
        .limit(limit)) as WebhookDelivery[]
    },

    /**
     * Send a logged delivery again, as a new delivery with the same event id
     * and body (so the receiver can dedupe). Null when it is not the owner's;
     * throws CONFLICT when the endpoint is disabled or deleted.
     */
    async redeliver(owner: string, deliveryId: string): Promise<WebhookDelivery | null> {
      const [del]: Cols[] = await o
        .select()
        .from(D)
        .where(and(eq(d.owner, owner), eq(d.id, deliveryId)))
        .limit(1)
      if (!del) return null
      const ep = await getRow(owner, del.endpointId)
      if (!ep || ep.disabledAt)
        throw new SignetDbError("CONFLICT", "The endpoint is disabled or deleted; enable it first.")
      const { id, statements } = deliveryStatements(ep, {
        id: del.eventId,
        type: del.type,
        body: del.body,
      })
      await db.batch(statements)
      const [row] = await o.select().from(D).where(eq(d.id, id)).limit(1)
      return row as WebhookDelivery
    },
  }
  return api
}

export type Webhooks = ReturnType<typeof createWebhooks>
