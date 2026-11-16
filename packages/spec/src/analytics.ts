import { z } from "zod"
import { errorEnvelopeSchema } from "./error.js"

// Limits match the defaults of `registerIngest` in `@dapplelight/signet-server/analytics/ingest`.
/** Events per ingest request. */
export const MAX_EVENTS = 50
/** Props per event. */
export const MAX_PROPS = 20
/** Characters in an event name. */
export const MAX_NAME_LENGTH = 64

/** `cleanId` in the server's ingest route uses this pattern. */
const id = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,64}$/)
  .describe("1 to 64 characters of letters, digits and _ . : -")

const propValue = z.union([z.string(), z.number(), z.boolean(), z.null()])

/**
 * One analytics event, as the browser sends it and as the server stores it.
 * Zod is the source of truth; `schemas/tracked-event.schema.json` is generated from it.
 */
export const trackedEventSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  ts: z.number().optional().describe("Unix milliseconds. The server stamps now when absent."),
  anonymousId: id.optional().describe("Random per-browser id."),
  sessionId: id.optional().describe("Random per-visit id."),
  userId: id
    .optional()
    .describe("The signed-in user. The server drops a client-sent value unless told to trust it."),
  props: z
    .record(z.string(), propValue)
    .refine((p) => Object.keys(p).length <= MAX_PROPS, `At most ${MAX_PROPS} props`)
    .meta({ maxProperties: MAX_PROPS })
    .optional(),
})

export type TrackedEvent = z.infer<typeof trackedEventSchema>

/** Body of `POST` to the ingest route. */
export const analyticsIngestRequestSchema = z.object({
  events: z.array(trackedEventSchema).max(MAX_EVENTS),
})

export type AnalyticsIngestRequest = z.infer<typeof analyticsIngestRequestSchema>

/** The 202 reply: nothing to report back except how many events were accepted. */
export const analyticsIngestResponseSchema = z.object({
  success: z.literal(true),
  written: z.number().int().min(0).describe("How many events the sink accepted."),
})

export type AnalyticsIngestResponse = z.infer<typeof analyticsIngestResponseSchema>

/** The 400 reply to a body without an `events` array: the error envelope with this code. */
export const analyticsIngestErrorSchema = errorEnvelopeSchema.extend({
  code: z.literal("INVALID_PAYLOAD"),
})

export type AnalyticsIngestError = z.infer<typeof analyticsIngestErrorSchema>
