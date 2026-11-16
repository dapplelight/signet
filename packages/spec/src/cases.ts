/**
 * The conformance cases, as data. `bun run gen` writes them to
 * `conformance/cases.json`, which any backend, in any language, can run.
 * Paths may hold `{authPrefix}`, `{ingestPath}`, `{sessionsPrefix}` and
 * `{jsonPath}`; the runner swaps in the values it was given.
 */

export type ConformanceCase = {
  id: string
  /** Where the behaviour is specified. */
  spec: string
  request: {
    method: string
    path: string
    headers?: Record<string, string>
    /** A string is sent as is; any other value is sent as JSON. */
    body?: unknown
  }
  expect: {
    /** One status, or the statuses that are all right. */
    status: number | number[]
    /** Each named header must equal this value. Names are case-insensitive. */
    headers?: Record<string, string>
    /** A file in /spec/v1/ (`error-envelope.schema.json`), or an inline JSON Schema. Checked when the body is not empty. */
    bodySchema?: string | Record<string, unknown>
    /** Every key here must be in the JSON body with this exact value. */
    body?: Record<string, unknown>
    /** Keys the JSON body must carry. */
    bodyRequired?: string[]
  }
}

const ENVELOPE = "error-envelope.schema.json"
const form = { "content-type": "application/x-www-form-urlencoded" }

export const CASES: ConformanceCase[] = [
  {
    id: "unknown-route-404",
    spec: "error envelope",
    request: { method: "GET", path: "{authPrefix}/conformance-no-such-route" },
    expect: {
      status: 404,
      bodySchema: ENVELOPE,
      body: { success: false, code: "NOT_FOUND" },
      bodyRequired: ["requestId"],
    },
  },
  {
    id: "invalid-json-400",
    spec: "error envelope: INVALID_JSON",
    request: {
      method: "POST",
      path: "{jsonPath}",
      headers: { "content-type": "application/json" },
      body: "{not json",
    },
    expect: {
      status: 400,
      bodySchema: ENVELOPE,
      body: { success: false, code: "INVALID_JSON" },
    },
  },
  {
    id: "ingest-invalid-payload-400",
    spec: "analytics ingest",
    request: { method: "POST", path: "{ingestPath}", body: { events: "not-an-array" } },
    expect: {
      status: 400,
      bodySchema: ENVELOPE,
      body: { success: false, code: "INVALID_PAYLOAD" },
    },
  },
  {
    id: "ingest-accepted-202",
    spec: "analytics ingest",
    request: {
      method: "POST",
      path: "{ingestPath}",
      body: { events: [{ name: "conformance_a" }, { name: "conformance_b" }] },
    },
    expect: {
      status: 202,
      bodySchema: "analytics-ingest-response.schema.json",
      body: { success: true, written: 2 },
    },
  },
  {
    id: "token-bad-grant",
    spec: "client login: POST /token",
    request: {
      method: "POST",
      path: "{authPrefix}/token",
      headers: form,
      body: "grant_type=conformance-bad-grant&client_id=conformance-unknown-client",
    },
    expect: {
      status: [400, 401],
      headers: { "cache-control": "no-store" },
      bodySchema: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" } },
      },
    },
  },
  {
    id: "revoke-any-token-200",
    spec: "client login: POST /revoke",
    request: {
      method: "POST",
      path: "{authPrefix}/revoke",
      headers: form,
      body: "token=conformance-unknown-token",
    },
    expect: { status: 200 },
  },
  {
    id: "authorize-without-session",
    spec: "client login: GET /authorize",
    request: {
      method: "GET",
      path: "{authPrefix}/authorize?client_id=conformance-unknown-client&redirect_uri=https%3A%2F%2Fexample.test%2F&code_challenge=x&code_challenge_method=S256&state=x",
    },
    expect: { status: [401, 302], bodySchema: ENVELOPE },
  },
  {
    id: "sessions-list-without-cookie-401",
    spec: "session routes: GET /",
    request: { method: "GET", path: "{sessionsPrefix}" },
    expect: {
      status: 401,
      bodySchema: ENVELOPE,
      body: { success: false, code: "UNAUTHORIZED" },
    },
  },
  {
    id: "sessions-revoke-others-without-cookie-401",
    spec: "session routes: POST /revoke-others",
    request: { method: "POST", path: "{sessionsPrefix}/revoke-others" },
    expect: {
      status: 401,
      bodySchema: ENVELOPE,
      body: { success: false, code: "UNAUTHORIZED" },
    },
  },
]
