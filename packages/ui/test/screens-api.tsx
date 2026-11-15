/**
 * API screens: the OpenAPI endpoint reference and the webhook delivery log.
 * Keyboard, ARIA, labels, data-* hooks.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { ApiReference, WebhookDeliveryLog } = await import("../src/components/screens/api-screens")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (e) {
    ok(`${name} (threw: ${(e as Error).message.split("\n")[0]})`, false)
  } finally {
    cleanup()
  }
}

const spec = {
  openapi: "3.1.0",
  info: { title: "Notes API", version: "1.0.0", description: "Notes for teams." },
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "sid" },
      apiKey: {
        type: "http",
        scheme: "bearer",
        description: "An API key in Authorization: Bearer.",
      },
    },
  },
  paths: {
    "/notes": {
      get: {
        operationId: "getNotes",
        summary: "List notes",
        tags: ["Notes"],
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description: "Page size",
          },
          { name: "tag", in: "query", schema: { type: "array", items: { type: "string" } } },
        ],
        responses: {
          "200": { description: "OK" },
          default: { $ref: "#/components/responses/Error" },
        },
      },
      post: {
        operationId: "postNotes",
        summary: "Create a note",
        tags: ["Notes"],
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", properties: { title: { type: "string" } } },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/health": {
      get: {
        operationId: "getHealth",
        security: [],
        deprecated: true,
        responses: { "200": { description: "OK" } },
      },
    },
  },
}

await t("ApiReference", async () => {
  render(<ApiReference spec={spec} defaultOpen={["postNotes"]} />)
  const region = screen.getByRole("region", { name: /Notes API/ })
  ok("Reference: a labelled region", !!region)
  ok(
    "Reference: grouped by tag, untagged under Endpoints",
    !!screen.getByText("Notes") && !!screen.getByText("Endpoints"),
  )
  ok(
    "Reference: auth schemes listed",
    !!screen.getByText(/cookie sid/) && !!screen.getByText(/Authorization: Bearer/),
  )
  const ops = document.querySelectorAll("[data-slot=api-operation]")
  ok(
    "Reference: one per operation, data-method",
    ops.length === 3 && ops[0]?.getAttribute("data-method") === "get",
  )
  ok(
    "Reference: defaultOpen opens it",
    (ops[1] as HTMLDetailsElement).open && !(ops[0] as HTMLDetailsElement).open,
  )
  ok("Reference: request body schema shown", !!within(ops[1] as HTMLElement).getByText(/"title"/))
  const summary = (ops[0] as HTMLElement).querySelector("summary") as HTMLElement
  // Native <details>: the browser opens it on click, Enter and Space alike.
  await userEvent.click(summary)
  ok("Reference: the summary opens it", (ops[0] as HTMLDetailsElement).open)
  const params = within(ops[0] as HTMLElement).getByRole("table")
  ok(
    "Reference: params with type and description",
    !!within(params).getByText("integer") &&
      !!within(params).getByText("string[]") &&
      !!within(params).getByText("Page size"),
  )
  ok(
    "Reference: $ref responses read as the error envelope",
    !!within(ops[0] as HTMLElement).getByText("Error envelope"),
  )
  ok(
    "Reference: public and deprecated flagged",
    !!within(ops[2] as HTMLElement).getByText("No authentication") &&
      (ops[2] as HTMLElement).hasAttribute("data-deprecated"),
  )
  cleanup()
  render(
    <ApiReference
      spec={spec}
      labels={{ untagged: "Other", noAuth: "Public" }}
      className="custom"
    />,
  )
  ok("Reference: labels override", !!screen.getByText("Other"))
  ok("Reference: className merges", !!document.querySelector("[data-slot=api-reference].custom"))
})

const deliveries = [
  {
    id: "d3",
    endpointId: "e1",
    eventId: "evt_3",
    type: "order.paid",
    status: "failed",
    attempts: 10,
    responseStatus: 500,
    responseBody: "upstream down",
    body: '{"type":"order.paid"}',
    durationMs: 120,
    createdAt: "2026-11-01T10:00:00Z",
  },
  {
    id: "d2",
    endpointId: "e1",
    eventId: "evt_2",
    type: "order.created",
    status: "delivered",
    attempts: 1,
    responseStatus: 200,
    createdAt: "2026-11-01T09:00:00Z",
  },
  {
    id: "d1",
    endpointId: "e2",
    eventId: "evt_1",
    type: "user.deleted",
    status: "retrying",
    attempts: 2,
    error: "connect ECONNREFUSED",
    createdAt: 1_700_000_000_000,
  },
]

await t("WebhookDeliveryLog", async () => {
  const redone: string[] = []
  const statuses: string[] = []
  render(
    <WebhookDeliveryLog
      deliveries={deliveries}
      endpoints={{ e1: "https://hooks.example.com/in" }}
      onStatusChange={(s) => statuses.push(s)}
      onRedeliver={async (d) => {
        redone.push(d.id)
      }}
      formatTime={() => "t"}
    />,
  )
  ok("Log: a labelled region", !!screen.getByRole("region", { name: "Webhook deliveries" }))
  const rows = document.querySelectorAll("[data-slot=webhook-delivery]")
  ok(
    "Log: one row per delivery with data-status",
    rows.length === 3 && rows[0]?.getAttribute("data-status") === "failed",
  )
  ok(
    "Log: endpoint url, else id",
    screen.getAllByText("https://hooks.example.com/in").length === 2 && !!screen.getByText("e2"),
  )
  ok(
    "Log: response status, error and duration",
    !!screen.getByText("500") &&
      !!screen.getByText("connect ECONNREFUSED") &&
      !!screen.getByText(/120 ms/),
  )
  ok(
    "Log: no redeliver on delivered",
    !screen.queryByRole("button", { name: "Redeliver order.created d2" }),
  )
  await userEvent.click(screen.getByRole("button", { name: "Redeliver order.paid d3" }))
  await waitFor(() =>
    ok(
      "Log: redeliver announced",
      screen.getAllByRole("status").some((s) => s.textContent === "Redelivery queued"),
    ),
  )
  ok("Log: redeliver called with the row", redone.join() === "d3")
  const details = screen.getByRole("button", { name: "Details for order.paid" })
  ok("Log: details collapsed", details.getAttribute("aria-expanded") === "false")
  await userEvent.click(details)
  ok(
    "Log: details show the response and the sent body",
    details.getAttribute("aria-expanded") === "true" &&
      !!screen.getByText("upstream down") &&
      !!screen.getByText(/"order.paid"/),
  )
  const failed = screen.getByRole("button", { name: "Failed" })
  await userEvent.click(failed)
  ok(
    "Log: filter pressed and reported",
    failed.getAttribute("aria-pressed") === "true" && statuses.join() === "failed",
  )
  ok(
    "Log: filter narrows rows",
    document.querySelectorAll("[data-slot=webhook-delivery]").length === 1,
  )
  await userEvent.click(screen.getByRole("button", { name: "Delivered" }))
  ok(
    "Log: data-status on the section",
    document.querySelector("[data-slot=webhook-deliveries]")?.getAttribute("data-status") ===
      "delivered",
  )
})

await t("WebhookDeliveryLog: failing redeliver, empty, load more, controlled", async () => {
  let more = 0
  render(
    <WebhookDeliveryLog
      deliveries={deliveries}
      status="retrying"
      hasMore
      onLoadMore={() => more++}
      onRedeliver={async () => {
        throw new Error("no")
      }}
    />,
  )
  ok(
    "Controlled: only retrying rows",
    document.querySelectorAll("[data-slot=webhook-delivery]").length === 1,
  )
  await userEvent.click(screen.getByRole("button", { name: "All" }))
  ok(
    "Controlled: stays until the parent changes it",
    document.querySelectorAll("[data-slot=webhook-delivery]").length === 1,
  )
  await userEvent.click(screen.getByRole("button", { name: "Redeliver user.deleted d1" }))
  await waitFor(() =>
    ok(
      "Failure announced",
      screen
        .getAllByRole("status")
        .some((s) => s.textContent === "Something went wrong. Try again."),
    ),
  )
  await userEvent.click(screen.getByRole("button", { name: "Load more" }))
  ok("Load more", more === 1)
  cleanup()
  render(<WebhookDeliveryLog deliveries={[]} labels={{ empty: "Nothing sent" }} />)
  ok("Empty state with label override", !!screen.getByText("Nothing sent"))
})

console.log(`\nscreens-api: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
