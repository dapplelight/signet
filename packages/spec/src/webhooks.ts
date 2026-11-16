import { z } from "zod"

/** The outbox topic of webhook deliveries, as in `@dapplelight/signet-db/webhooks`. */
export const WEBHOOK_TOPIC = "signet.webhook"

/**
 * The JSON a receiver gets in the POST body. Verify the signature over the raw
 * text before parsing it.
 */
export const webhookBodySchema = z.object({
  type: z.string().min(1).describe("The event type, e.g. order.created."),
  timestamp: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "Not a date-time")
    .meta({ format: "date-time" })
    .describe("When the event was emitted, ISO 8601."),
  // JSON.stringify drops an undefined `data`, so a body may lack it.
  data: z.unknown().optional().describe("The event's payload."),
})

export type WebhookBody = z.infer<typeof webhookBodySchema>

/** The three Standard Webhooks headers `signWebhook` returns for one attempt. */
export const webhookHeadersSchema = z.object({
  "webhook-id": z
    .string()
    .min(1)
    .describe("The event id; the same on every retry, so receivers dedupe on it."),
  "webhook-timestamp": z
    .string()
    .regex(/^\d+$/)
    .describe("Unix seconds when this attempt was signed."),
  "webhook-signature": z
    .string()
    .regex(/^v1,[A-Za-z0-9+/]+={0,2}( v1,[A-Za-z0-9+/]+={0,2})*$/)
    .describe(
      "One or more space-separated v1,<base64 HMAC-SHA256> values; several while a secret rotates.",
    ),
})

export type WebhookHeaders = z.infer<typeof webhookHeadersSchema>

/** The outbox message a delivery is queued as: it names the delivery row to send. */
export const webhookOutboxMessageSchema = z.object({
  id: z.string().min(1),
  topic: z.literal(WEBHOOK_TOPIC),
  payload: z.object({ deliveryId: z.string().min(1) }),
})

export type WebhookOutboxMessage = z.infer<typeof webhookOutboxMessageSchema>

/** One delivery attempt, as three parts: the signed headers, the body and the queued outbox message. */
export const webhookDeliverySchema = z.object({
  headers: webhookHeadersSchema,
  body: webhookBodySchema,
  outbox: webhookOutboxMessageSchema,
})

export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>
