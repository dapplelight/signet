"use client"
import {
  ApiReference,
  type ApiSpec,
  type WebhookDeliveryEntry,
  WebhookDeliveryLog,
  type WebhookStatusFilter,
} from "@dapplelight/signet-ui/screens/api-screens"
import { useState } from "react"
import { ClientOnly } from "./client-only"

const spec: ApiSpec = {
  info: { title: "Orders API", version: "1.0.0" },
  components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
  paths: {
    "/orders": {
      get: {
        operationId: "listOrders",
        summary: "List orders",
        tags: ["Orders"],
        security: [{ bearer: [] }],
        parameters: [
          {
            name: "status",
            in: "query",
            description: "Filter by status",
            schema: { type: "string", enum: ["open", "paid", "refunded"] },
          },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "A page of orders" } },
      },
      post: {
        operationId: "createOrder",
        summary: "Create an order",
        tags: ["Orders"],
        security: [{ bearer: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { customerId: { type: "string" }, amount: { type: "integer" } },
                required: ["customerId", "amount"],
              },
            },
          },
        },
        responses: {
          "201": { description: "The new order" },
          "422": { description: "Validation failed" },
        },
      },
    },
    "/health": {
      get: {
        operationId: "health",
        summary: "Health check",
        tags: ["Status"],
        security: [],
        responses: { "200": { description: "OK" } },
      },
    },
  },
}

const now = Date.now()
const deliveries: WebhookDeliveryEntry[] = [
  {
    id: "dl_1",
    endpointId: "ep_1",
    eventId: "evt_101",
    type: "order.paid",
    status: "delivered",
    attempts: 1,
    responseStatus: 200,
    durationMs: 142,
    createdAt: now - 60_000,
  },
  {
    id: "dl_2",
    endpointId: "ep_1",
    eventId: "evt_100",
    type: "order.refunded",
    status: "failed",
    attempts: 5,
    responseStatus: 500,
    responseBody: "Internal Server Error",
    error: "Endpoint returned 500",
    createdAt: now - 3_600_000,
  },
  {
    id: "dl_3",
    endpointId: "ep_2",
    eventId: "evt_099",
    type: "customer.created",
    status: "retrying",
    attempts: 2,
    responseStatus: 503,
    createdAt: now - 7_200_000,
  },
]

function ApiReferenceDemoInner() {
  return (
    <div className="w-full">
      <ApiReference spec={spec} defaultOpen={["createOrder"]} />
    </div>
  )
}

function WebhookDeliveryLogDemoInner() {
  const [status, setStatus] = useState<WebhookStatusFilter>("all")
  const shown = status === "all" ? deliveries : deliveries.filter((d) => d.status === status)
  return (
    <div className="w-full">
      <WebhookDeliveryLog
        deliveries={shown}
        status={status}
        onStatusChange={setStatus}
        endpoints={{
          ep_1: "https://acme.example/hooks/orders",
          ep_2: "https://acme.example/hooks/crm",
        }}
        onRedeliver={() => new Promise((r) => setTimeout(r, 500))}
      />
    </div>
  )
}

export const ApiReferenceDemo = () => (
  <ClientOnly>
    <ApiReferenceDemoInner />
  </ClientOnly>
)

export const WebhookDeliveryLogDemo = () => (
  <ClientOnly>
    <WebhookDeliveryLogDemoInner />
  </ClientOnly>
)
