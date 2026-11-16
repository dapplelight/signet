import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { memoryKv } from "../../server/src/adapters"
import { registerIngest } from "../../server/src/analytics/ingest"
import { memorySink } from "../../server/src/analytics/sinks"
import { clientLoginRoutes, sessionRoutes } from "../../server/src/auth/hono"
import { kvSessionStore } from "../../server/src/auth/sessions"
import { ApiException, errorHandler } from "../../server/src/http/errors"
import { parseBody } from "../../server/src/http/validate"
import { memoryStore } from "../../server/src/middleware/rate-limit"
import { requestId } from "../../server/src/middleware/request-id"
import { CONFORMANCE_DIR, generateConformance, PUBLIC_DIR, SCHEMAS_DIR } from "../scripts/gen"
import { CASES } from "../src/cases"
import { type ConformanceOptions, runConformance } from "../src/conformance"

const OPTIONS = { baseUrl: "http://localhost", authPrefix: "/api/auth", ingestPath: "/api/e" }
const AUTH = OPTIONS.authPrefix

/**
 * The real error handler, ingest route, client login and session routes, with
 * in-memory stores. The spec package has no hono of its own, so the root app
 * is built from the route object's own class.
 */
function referenceApp(handler = errorHandler({ isProduction: () => true })) {
  const store = kvSessionStore(memoryKv())
  const sessions = {
    cookieName: "sid",
    secret: "test-secret-that-is-at-least-32-characters",
    store,
  }
  const login = clientLoginRoutes({
    sessions,
    kv: memoryKv(),
    rateLimit: memoryStore(),
    clients: { "example-cli": {} },
    verificationUri: "https://app.example.test/device",
    trust: "cloudflare",
  })
  const app = new (login.constructor as new () => typeof login)()
  app.use("*", requestId())
  app.route(AUTH, login)
  app.route("/api/sessions", sessionRoutes(sessions))
  registerIngest(app as never, OPTIONS.ingestPath, { engine: memorySink() })
  app.post("/api/json", async (c) => {
    await parseBody(c, z.object({}))
    return c.json({ success: true })
  })
  app.notFound(() => {
    throw new ApiException(404, "Not found", "NOT_FOUND")
  })
  app.onError(handler)
  return app
}

const run = (app: ReturnType<typeof referenceApp>, extra: Partial<ConformanceOptions> = {}) =>
  runConformance({
    ...OPTIONS,
    jsonPath: "/api/json",
    fetch: (req) => app.fetch(req),
    ...extra,
  })

describe("the reference app", () => {
  test("passes every case", async () => {
    const report = await run(referenceApp())
    expect(report.results.filter((r) => !r.ok)).toEqual([])
    expect(report.passed).toBe(CASES.length)
    expect(report.failed).toBe(0)
  })

  test("fails the INVALID_JSON case without a jsonPath, not passes it", async () => {
    const report = await run(referenceApp(), { jsonPath: undefined })
    const notRun = report.results.find((r) => r.id === "invalid-json-400")
    expect(notRun).toEqual({
      id: "invalid-json-400",
      ok: false,
      reason: "not run: set the jsonPath option",
    })
    expect(report.failed).toBe(1)
    expect(report.passed).toBe(CASES.length - 1)
  })
})

describe("a deliberately broken app", () => {
  // An envelope without `success`.
  const broken = referenceApp((err, c) => {
    const status = (err as { status?: number }).status ?? 500
    return c.json(
      { error: err.message, code: "NOT_FOUND", requestId: c.get("reqId") },
      status as 404,
    )
  })

  test("fails the cases that read an error body, and says why", async () => {
    const report = await run(broken)
    const byId = Object.fromEntries(report.results.map((r) => [r.id, r]))
    expect(report.failed).toBeGreaterThan(0)
    expect(byId["unknown-route-404"]?.ok).toBe(false)
    expect(byId["unknown-route-404"]?.reason).toStartWith("body.success: ")
    expect(byId["ingest-invalid-payload-400"]?.ok).toBe(true) // ingest writes its own body
    expect(byId["ingest-accepted-202"]?.ok).toBe(true)
  })

  test("a wrong status reads as expected and got", async () => {
    const report = await run(referenceApp(), { ingestPath: "/api/missing" })
    const r = report.results.find((x) => x.id === "ingest-accepted-202")
    expect(r).toEqual({
      id: "ingest-accepted-202",
      ok: false,
      reason: "expected status 202, got 404",
    })
  })

  test("a network error is a failed result, not a throw", async () => {
    const report = await runConformance({
      ...OPTIONS,
      jsonPath: "/api/json",
      fetch: () => {
        throw new Error("connect ECONNREFUSED")
      },
    })
    expect(report.passed).toBe(0)
    expect(report.results[0]).toEqual({
      id: "unknown-route-404",
      ok: false,
      reason: "connect ECONNREFUSED",
    })
  })
})

describe("cases.json", () => {
  const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8")

  test("conformance/ equals the generated file (run `bun run gen`)", () =>
    expect(read(CONFORMANCE_DIR, "cases.json")).toBe(generateConformance()))
  test("apps/docs/public/spec/v1/ is a byte-identical copy", () =>
    expect(read(PUBLIC_DIR, "conformance-cases.json")).toBe(read(CONFORMANCE_DIR, "cases.json")))
  test("carries specVersion v1 and unique ids", () => {
    const file = JSON.parse(read(CONFORMANCE_DIR, "cases.json"))
    expect(file.specVersion).toBe("v1")
    const ids = file.cases.map((c: { id: string }) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  test("every schema it names is a committed file", () => {
    for (const c of CASES)
      if (typeof c.expect.bodySchema === "string")
        expect(() => read(SCHEMAS_DIR, c.expect.bodySchema as string)).not.toThrow()
  })
  test("the JSON Schema file accepts the reference app's 404 and rejects one without success", async () => {
    const schema = z.fromJSONSchema(JSON.parse(read(SCHEMAS_DIR, "error-envelope.schema.json")))
    const res = await referenceApp().fetch(new Request(`http://localhost${AUTH}/nope`))
    expect(schema.safeParse(await res.json()).success).toBe(true)
    expect(schema.safeParse({ error: "x", requestId: "r" }).success).toBe(false)
  })
})
