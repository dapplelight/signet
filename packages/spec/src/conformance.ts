/**
 * Runs the conformance cases against a live backend with `fetch` alone.
 * Reads no environment; every input is an option.
 */
import { z } from "zod"
import { analyticsIngestResponseSchema } from "./analytics.js"
import { CASES, type ConformanceCase } from "./cases.js"
import { errorEnvelopeSchema } from "./error.js"

export type ConformanceOptions = {
  /** Origin of the backend, e.g. `http://localhost:3000`. */
  baseUrl: string
  /** Where the client-login routes are mounted, e.g. `/api/auth`. */
  authPrefix: string
  /** The analytics ingest route, e.g. `/api/e`. */
  ingestPath: string
  /** Where the session routes are mounted. Default `/api/sessions`. */
  sessionsPrefix?: string
  /** A route that parses a JSON body, for the INVALID_JSON case. Without it that case is skipped. */
  jsonPath?: string
  /** Default: the global `fetch`. */
  fetch?: (req: Request) => Response | Promise<Response>
}

export type ConformanceResult = { id: string; ok: boolean; reason: string }

export type ConformanceReport = {
  passed: number
  failed: number
  results: ConformanceResult[]
}

// The Zod schemas the JSON files are generated from (a test keeps them equal).
const FILES: Record<string, z.ZodType> = {
  "error-envelope.schema.json": errorEnvelopeSchema,
  "analytics-ingest-response.schema.json": analyticsIngestResponseSchema,
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim()
const show = (v: unknown) => JSON.stringify(v) ?? String(v)

/** The first way `res` differs from the case's expectation, or null. */
async function mismatch(c: ConformanceCase, res: Response): Promise<string | null> {
  const want = c.expect
  const statuses = Array.isArray(want.status) ? want.status : [want.status]
  if (!statuses.includes(res.status))
    return `expected status ${statuses.join(" or ")}, got ${res.status}`

  for (const [name, value] of Object.entries(want.headers ?? {})) {
    const got = res.headers.get(name)
    if (got !== value) return `header ${name}: expected ${show(value)}, got ${show(got)}`
  }

  if (!want.bodySchema && !want.body && !want.bodyRequired) return null
  const text = await res.text()
  if (!text && want.bodySchema && !want.body && !want.bodyRequired) return null
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return `body: expected JSON, got ${show(text.slice(0, 60))}`
  }

  if (want.bodySchema) {
    const schema =
      typeof want.bodySchema === "string"
        ? FILES[want.bodySchema]
        : z.fromJSONSchema(want.bodySchema)
    if (!schema) return `body: unknown schema ${want.bodySchema}`
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const path = ["body", ...(issue?.path ?? [])].join(".")
      return `${path}: ${oneLine(issue?.message ?? "invalid")}`
    }
  }
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  for (const key of want.bodyRequired ?? []) if (!(key in obj)) return `body.${key}: required`
  for (const [key, value] of Object.entries(want.body ?? {}))
    if (show(obj[key]) !== show(value))
      return `body.${key}: expected ${show(value)}, got ${show(obj[key])}`
  return null
}

export async function runConformance(opts: ConformanceOptions): Promise<ConformanceReport> {
  const send = opts.fetch ?? ((req: Request) => fetch(req))
  const values: Record<string, string | undefined> = {
    authPrefix: opts.authPrefix,
    ingestPath: opts.ingestPath,
    sessionsPrefix: opts.sessionsPrefix ?? "/api/sessions",
    jsonPath: opts.jsonPath,
  }

  const results: ConformanceResult[] = []
  for (const c of CASES) {
    const missing = Object.keys(values).find((k) => c.request.path.includes(`{${k}}`) && !values[k])
    if (missing) {
      results.push({ id: c.id, ok: true, reason: `skipped: set the ${missing} option to run it` })
      continue
    }
    try {
      const path = c.request.path.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "")
      const raw = c.request.body
      const headers = new Headers(c.request.headers)
      if (raw !== undefined && typeof raw !== "string" && !headers.has("content-type"))
        headers.set("content-type", "application/json")
      const res = await send(
        new Request(new URL(path, opts.baseUrl), {
          method: c.request.method,
          headers,
          body: raw === undefined ? undefined : typeof raw === "string" ? raw : JSON.stringify(raw),
          redirect: "manual",
        }),
      )
      const reason = await mismatch(c, res)
      results.push({ id: c.id, ok: reason === null, reason: reason ?? "ok" })
    } catch (e) {
      results.push({
        id: c.id,
        ok: false,
        reason: oneLine(e instanceof Error ? e.message : String(e)),
      })
    }
  }
  const failed = results.filter((r) => !r.ok).length
  return { passed: results.length - failed, failed, results }
}
