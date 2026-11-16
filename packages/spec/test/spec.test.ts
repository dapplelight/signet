import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ERROR_CODES as LIB_ERROR_CODES } from "../../lib/src/api/codes"
import { generateWebhookSecret, signWebhook, verifyWebhook } from "../../lib/src/webhooks"
import { type IngestOptions, registerIngest } from "../../server/src/analytics/ingest"
import { memorySink } from "../../server/src/analytics/sinks"
import { STATUS_CODES } from "../../server/src/http/status-codes"
import { generate, PUBLIC_DIR, SCHEMAS_DIR } from "../scripts/gen"
import {
  analyticsIngestErrorSchema,
  analyticsIngestRequestSchema,
  analyticsIngestResponseSchema,
  MAX_EVENTS,
  MAX_NAME_LENGTH,
  MAX_PROPS,
  trackedEventSchema,
} from "../src/analytics"
import {
  ERROR_CODE_STATUS,
  ERROR_CODES,
  errorCodeSchema,
  errorEnvelopeSchema,
  SPEC_VERSION,
} from "../src/error"
import {
  WEBHOOK_TOPIC,
  webhookBodySchema,
  webhookDeliverySchema,
  webhookHeadersSchema,
  webhookOutboxMessageSchema,
} from "../src/webhooks"

const generated = generate()
const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8")

describe("committed files match the Zod source (run `bun run gen`)", () => {
  for (const [name, text] of Object.entries(generated)) {
    test(`schemas/${name}`, () => expect(read(SCHEMAS_DIR, name)).toBe(text))
    test(`apps/docs/public/spec/${SPEC_VERSION}/${name}`, () =>
      expect(read(PUBLIC_DIR, name)).toBe(text))
  }
})

test("the docs code table lists every code and status, in order", () => {
  const mdx = readFileSync(
    join(PUBLIC_DIR, "../../../content/docs/packages/spec/index.mdx"),
    "utf8",
  )
  const rows = [...mdx.matchAll(/^\| `(\w+)` \| (\d{3}) \|$/gm)].map(([, c, s]) => [c, Number(s)])
  expect(rows).toEqual(Object.entries(ERROR_CODE_STATUS))
})

describe("error-codes.json", () => {
  const file = JSON.parse(read(SCHEMAS_DIR, "error-codes.json")) as {
    specVersion: string
    codes: Record<string, number>
  }

  test("carries the spec version", () => expect(file.specVersion).toBe("v1"))

  test("has every code in lib's ERROR_CODES, in lib's order", () => {
    expect(Object.keys(file.codes)).toEqual([...LIB_ERROR_CODES])
    expect(ERROR_CODES).toEqual([...LIB_ERROR_CODES])
  })

  test("keeps the status server gives a bare HTTPException", () => {
    for (const [status, code] of Object.entries(STATUS_CODES))
      expect(file.codes[code]).toBe(Number(status))
  })

  test("every status is an HTTP error status", () => {
    for (const status of Object.values(ERROR_CODE_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(600)
    }
  })
})

describe("error-envelope.schema.json", () => {
  const schema = JSON.parse(read(SCHEMAS_DIR, "error-envelope.schema.json"))

  test("is JSON Schema 2020-12 and carries the spec version", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(schema.specVersion).toBe("v1")
  })

  test("requires success and error only", () =>
    expect(schema.required).toEqual(["success", "error"]))
})

describe("zod schemas", () => {
  test("envelope parses what errorHandler writes", () => {
    const body = {
      success: false as const,
      error: "Validation failed",
      code: "VALIDATION_FAILED",
      details: { formErrors: [], fieldErrors: { email: ["Required"] } },
      requestId: "r1",
    }
    expect(errorEnvelopeSchema.parse(body)).toEqual(body)
    expect(errorEnvelopeSchema.safeParse({ success: false, error: "x" }).success).toBe(true)
  })

  test("envelope rejects a success body and a missing message", () => {
    expect(errorEnvelopeSchema.safeParse({ success: true, error: "x" }).success).toBe(false)
    expect(errorEnvelopeSchema.safeParse({ success: false }).success).toBe(false)
  })

  test("code schema accepts the RFC 6750 spellings only as spelled", () => {
    expect(errorCodeSchema.safeParse("invalid_token").success).toBe(true)
    expect(errorCodeSchema.safeParse("INVALID_TOKEN").success).toBe(false)
  })
})

describe("analytics schemas", () => {
  const ingest = async (body: unknown, opts: Partial<IngestOptions> = {}) => {
    const sink = memorySink()
    // The spec package has no hono; a one-route stand-in captures the handler.
    let handler!: (c: unknown) => Promise<unknown>
    registerIngest({ post: (_path: string, h: typeof handler) => (handler = h) } as never, "/e", {
      engine: sink,
      ...opts,
    })
    const out = (await handler({
      req: { json: async () => JSON.parse(JSON.stringify(body)) },
      json: (json: unknown, status: number) => ({ json, status }),
    })) as { json: Record<string, unknown>; status: number }
    // As on the wire: undefined props are gone.
    const events = JSON.parse(JSON.stringify(sink.events)) as Record<string, unknown>[]
    return { res: { status: out.status }, json: out.json, events }
  }
  const event = { name: "page_view", ts: 1_700_000_000_000, anonymousId: "a-1", sessionId: "s:1" }

  test("the real ingest route accepts what the request schema accepts", async () => {
    const body = { events: [{ ...event, props: { plan: "pro", n: 2, on: true, none: null } }] }
    expect(analyticsIngestRequestSchema.safeParse(body).success).toBe(true)
    const { res, json } = await ingest(body)
    expect(res.status).toBe(202)
    expect(analyticsIngestResponseSchema.parse(json)).toEqual({ success: true, written: 1 })
  })

  test("a TrackedEvent the route stores parses as a tracked event", async () => {
    const { events } = await ingest(
      { events: [{ ...event, userId: "u1", props: { plan: "pro" } }] },
      { trustClientUserId: true },
    )
    expect(events).toHaveLength(1)
    expect(trackedEventSchema.parse(events[0]) as unknown).toEqual(events[0])
  })

  test("the 400 for a body without events is the envelope with INVALID_PAYLOAD", async () => {
    const { res, json } = await ingest({ nope: 1 })
    expect(res.status).toBe(400)
    expect(analyticsIngestErrorSchema.parse(json).code).toBe("INVALID_PAYLOAD")
    expect(analyticsIngestRequestSchema.safeParse({ nope: 1 }).success).toBe(false)
  })

  test("limits equal the route's defaults: 50 events, 64-char name, 20 props", async () => {
    expect([MAX_EVENTS, MAX_NAME_LENGTH, MAX_PROPS]).toEqual([50, 64, 20])
    const many = Array.from({ length: 51 }, () => event)
    expect((await ingest({ events: many })).json.written).toBe(50)
    expect(analyticsIngestRequestSchema.safeParse({ events: many.slice(0, 50) }).success).toBe(true)
    expect(analyticsIngestRequestSchema.safeParse({ events: many }).success).toBe(false)

    const longName = { name: "x".repeat(65) }
    expect(
      ((await ingest({ events: [longName] })).events[0] as { name: string }).name,
    ).toHaveLength(64)
    expect(trackedEventSchema.safeParse({ name: "x".repeat(64) }).success).toBe(true)
    expect(trackedEventSchema.safeParse(longName).success).toBe(false)

    const props = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]))
    expect(trackedEventSchema.safeParse({ name: "e", props: props(20) }).success).toBe(true)
    expect(trackedEventSchema.safeParse({ name: "e", props: props(21) }).success).toBe(false)
  })

  test("ids use the route's pattern and props take scalars only", () => {
    for (const bad of ["", "has space", "x".repeat(65), "a/b"])
      expect(trackedEventSchema.safeParse({ name: "e", anonymousId: bad }).success).toBe(false)
    expect(trackedEventSchema.safeParse({ name: "e", anonymousId: "A_b.c:d-1" }).success).toBe(true)
    expect(trackedEventSchema.safeParse({ name: "e", props: { a: { b: 1 } } }).success).toBe(false)
    expect(trackedEventSchema.safeParse({ name: "" }).success).toBe(false)
  })

  test("the JSON Schema carries the limits", () => {
    const req = JSON.parse(read(SCHEMAS_DIR, "analytics-ingest-request.schema.json"))
    expect(req.properties.events.maxItems).toBe(50)
    const ev = JSON.parse(read(SCHEMAS_DIR, "tracked-event.schema.json"))
    expect(ev.properties.name.maxLength).toBe(64)
    expect(ev.properties.props.maxProperties).toBe(20)
    expect(ev.properties.userId.pattern).toBe("^[A-Za-z0-9_.:-]{1,64}$")
  })
})

describe("webhook schemas", () => {
  const secret = generateWebhookSecret()
  const body = JSON.stringify({
    type: "order.created",
    timestamp: new Date().toISOString(),
    data: { orderId: "o1" },
  })

  test("parses a real signWebhook output", async () => {
    const headers = await signWebhook({ secret, id: "evt_1", body })
    expect(webhookHeadersSchema.parse(headers)).toEqual(headers)
    expect(webhookBodySchema.parse(JSON.parse(body)).type).toBe("order.created")
    expect(await verifyWebhook(secret, headers, body)).toBe(true)
  })

  test("parses a rotation: several space-separated signatures", async () => {
    const headers = await signWebhook({
      secret: [secret, generateWebhookSecret()],
      id: "evt_1",
      body,
    })
    expect(headers["webhook-signature"].split(" ")).toHaveLength(2)
    expect(webhookHeadersSchema.safeParse(headers).success).toBe(true)
  })

  test("rejects malformed headers", () => {
    const ok = {
      "webhook-id": "e",
      "webhook-timestamp": "1700000000",
      "webhook-signature": "v1,AAAA",
    }
    expect(webhookHeadersSchema.safeParse(ok).success).toBe(true)
    expect(webhookHeadersSchema.safeParse({ ...ok, "webhook-timestamp": "1.5" }).success).toBe(
      false,
    )
    expect(webhookHeadersSchema.safeParse({ ...ok, "webhook-signature": "v2,AAAA" }).success).toBe(
      false,
    )
    expect(webhookHeadersSchema.safeParse({ ...ok, "webhook-id": undefined }).success).toBe(false)
  })

  test("body needs type and an ISO timestamp", () => {
    expect(webhookBodySchema.safeParse({ type: "a", timestamp: "yesterday" }).success).toBe(false)
    expect(webhookBodySchema.safeParse({ timestamp: new Date().toISOString() }).success).toBe(false)
  })

  test("outbox message uses the topic the db package queues deliveries under", () => {
    const dbSource = readFileSync(join(import.meta.dirname, "../../db/src/webhooks.ts"), "utf8")
    expect(dbSource).toContain(`export const WEBHOOK_TOPIC = "${WEBHOOK_TOPIC}"`)
    const message = { id: "m1", topic: WEBHOOK_TOPIC, payload: { deliveryId: "d1" } } as const
    expect(webhookOutboxMessageSchema.parse(message)).toEqual(message)
    expect(webhookOutboxMessageSchema.safeParse({ ...message, topic: "other" }).success).toBe(false)
  })

  test("a whole delivery parses", async () => {
    const headers = await signWebhook({ secret, id: "evt_1", body })
    const delivery = {
      headers,
      body: JSON.parse(body),
      outbox: { id: "m1", topic: WEBHOOK_TOPIC, payload: { deliveryId: "d1" } },
    }
    expect(webhookDeliverySchema.safeParse(delivery).success).toBe(true)
  })
})
