/**
 * Admin routes for outbound webhooks (signet-db's `createWebhooks`). Requires
 * `hono` and `zod` as optional peers. Takes the store structurally, so this
 * package does not depend on signet-db. Put the app's auth in front; `owner`
 * is the user or org whose endpoints these are (check the caller may manage
 * that org's webhooks before returning its id).
 *
 *   app.use("/api/webhooks/*", requireStoredSession(sessionOpts))
 *   app.route("/api/webhooks", webhookRoutes({ webhooks, owner: (c) => c.get("session").payload.sub }))
 *
 *   GET    /endpoints                     the owner's endpoints (no secrets)
 *   POST   /endpoints                     register one; the answer has its secret, once
 *   PATCH  /endpoints/:id                 url, events, description, enabled
 *   DELETE /endpoints/:id
 *   POST   /endpoints/:id/rotate-secret   a new secret, once
 *   GET    /deliveries                    the delivery log (?endpointId, status, limit, before)
 *   POST   /deliveries/:id/redeliver      send one again, same event id
 *
 * Someone else's endpoint or delivery reads as 404. signet-db's BAD_VALUE
 * (a private or non-https url) is a 400 VALIDATION_FAILED on `url`, CONFLICT
 * (redeliver to a disabled endpoint) a 409.
 */

import { type Context, Hono } from "hono"
import { z } from "zod"
import { ApiException } from "./errors.js"
import { apiDoc } from "./openapi.js"
import { zValidator } from "./validate.js"

export type WebhookDeliveryStatus = "pending" | "retrying" | "delivered" | "failed" | "skipped"

/** What `webhookRoutes` needs from signet-db's `createWebhooks(...)`. */
export type WebhookStore<E, D> = {
  list(owner: string): Promise<E[]>
  register(input: {
    owner: string
    url: string
    events: string[]
    description?: string
  }): Promise<{ endpoint: E; secret: string }>
  update(
    owner: string,
    id: string,
    patch: { url?: string; events?: string[]; description?: string | null; enabled?: boolean },
  ): Promise<E | null>
  remove(owner: string, id: string): Promise<boolean>
  rotateSecret(owner: string, id: string): Promise<{ secret: string } | null>
  deliveries(
    owner: string,
    query: { endpointId?: string; status?: WebhookDeliveryStatus; limit?: number; before?: string },
  ): Promise<D[]>
  redeliver(owner: string, id: string): Promise<D | null>
}

const Id = z.object({ id: z.string().min(1) })
const Events = z.array(z.string().min(1).max(200)).min(1).max(100)
export const WebhookEndpointInput = z.object({
  url: z.url().max(2048).describe("Where deliveries are POSTed. https on a public host."),
  events: Events.describe('Event types to receive, or ["*"] for all.'),
  description: z.string().max(500).optional(),
})
export const WebhookEndpointPatch = z.object({
  url: z.url().max(2048).optional(),
  events: Events.optional(),
  description: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional().describe("true turns a disabled endpoint back on."),
})
export const WebhookDeliveryQuery = z.object({
  endpointId: z.string().optional(),
  status: z.enum(["pending", "retrying", "delivered", "failed", "skipped"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().optional().describe("A delivery id: older deliveries than this."),
})

const missing = (what: string) => new ApiException(404, `No such ${what}`, "NOT_FOUND")

// By shape: signet-db's SignetDbError, without depending on signet-db.
async function mapped<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (e) {
    const err = e as { name?: string; code?: string; message?: string }
    if (err?.name === "SignetDbError" && err.code === "BAD_VALUE")
      throw new ApiException(400, "Validation failed", "VALIDATION_FAILED", {
        formErrors: [],
        fieldErrors: { url: [err.message ?? "Invalid url"] },
      })
    if (err?.name === "SignetDbError" && err.code === "CONFLICT")
      throw new ApiException(409, err.message ?? "Conflict", "CONFLICT")
    throw e
  }
}

export function webhookRoutes<E, D>(opts: {
  webhooks: WebhookStore<E, D>
  owner: (c: Context) => string | Promise<string>
}) {
  const { webhooks } = opts
  const tags = ["Webhooks"]
  return new Hono()
    .get("/endpoints", apiDoc({ summary: "List webhook endpoints", tags }), async (c) =>
      c.json(await webhooks.list(await opts.owner(c))),
    )
    .post(
      "/endpoints",
      apiDoc({
        summary: "Register a webhook endpoint",
        description: "The response holds the signing secret. It is not shown again.",
        tags,
      }),
      zValidator("json", WebhookEndpointInput),
      async (c) => {
        const owner = await opts.owner(c)
        const body = c.req.valid("json")
        const res = await mapped(
          webhooks.register({
            owner,
            url: body.url,
            events: body.events,
            ...(body.description !== undefined ? { description: body.description } : {}),
          }),
        )
        return c.json(res, 201)
      },
    )
    .patch(
      "/endpoints/:id",
      apiDoc({ summary: "Update or re-enable a webhook endpoint", tags }),
      zValidator("param", Id),
      zValidator("json", WebhookEndpointPatch),
      async (c) => {
        const patch = Object.fromEntries(
          Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined),
        )
        const e = await mapped(webhooks.update(await opts.owner(c), c.req.valid("param").id, patch))
        if (!e) throw missing("webhook endpoint")
        return c.json(e)
      },
    )
    .delete(
      "/endpoints/:id",
      apiDoc({ summary: "Delete a webhook endpoint", tags }),
      zValidator("param", Id),
      async (c) => {
        if (!(await webhooks.remove(await opts.owner(c), c.req.valid("param").id)))
          throw missing("webhook endpoint")
        return c.json({ deleted: true })
      },
    )
    .post(
      "/endpoints/:id/rotate-secret",
      apiDoc({ summary: "Rotate a webhook endpoint's signing secret", tags }),
      zValidator("param", Id),
      async (c) => {
        const r = await webhooks.rotateSecret(await opts.owner(c), c.req.valid("param").id)
        if (!r) throw missing("webhook endpoint")
        return c.json(r)
      },
    )
    .get(
      "/deliveries",
      apiDoc({ summary: "The webhook delivery log, newest first", tags }),
      zValidator("query", WebhookDeliveryQuery),
      async (c) => {
        const q = Object.fromEntries(
          Object.entries(c.req.valid("query")).filter(([, v]) => v !== undefined),
        )
        return c.json(await webhooks.deliveries(await opts.owner(c), q))
      },
    )
    .post(
      "/deliveries/:id/redeliver",
      apiDoc({ summary: "Send a delivery again with the same event id", tags }),
      zValidator("param", Id),
      async (c) => {
        const d = await mapped(webhooks.redeliver(await opts.owner(c), c.req.valid("param").id))
        if (!d) throw missing("webhook delivery")
        return c.json(d, 201)
      },
    )
}

/** For `hc<WebhookRoutes<Endpoint, Delivery>>`, imported with `import type`. */
export type WebhookRoutes<E, D> = ReturnType<typeof webhookRoutes<E, D>>
