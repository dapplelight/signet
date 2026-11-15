/**
 * OpenAPI 3.1 from the app's own routes. Requires `hono` and `zod` (4.2+) as
 * optional peers. Nothing to keep in sync: the spec is read off `app.routes`
 * and the `zValidator` schemas already guarding them, converted with zod's
 * own `toJSONSchema`.
 *
 *   app.get("/notes/:id", apiDoc({ summary: "Get a note", response: Note }), zValidator("param", Id), get)
 *   serveOpenApi(app, { info: { title: "Notes API", version: "1.0.0" }, security: { session: { cookieName: "sid" }, apiKey: {} } })
 *   // GET /openapi.json  the spec      GET /docs  an HTML reference, no dependency
 *
 * What it reads, per route:
 *   parameters    `param`, `query`, `header` and `cookie` validators (a path
 *                 parameter without one is a required string)
 *   request body  `json` (application/json) and `form` (multipart/form-data)
 *   responses     `apiDoc({ response })` as the 200 body; 400 when a validator
 *                 can fail, 401 when the route needs auth, and `default`, all as
 *                 Signet's error envelope (`#/components/schemas/Error`)
 *   security      every scheme in `security`, either one accepted; a route says
 *                 otherwise with `apiDoc({ security: false })` or a list
 */

import type { Context, Hono, MiddlewareHandler } from "hono"
import { toJSONSchema, type z } from "zod"
import { VALIDATES } from "./validate.js"

type Json = Record<string, unknown>

export type SecuritySchemeName = "session" | "apiKey"

export type ApiDocOptions = {
  summary?: string
  description?: string
  tags?: string[]
  /** Default: from the method and path, `getNotesById`. */
  operationId?: string
  deprecated?: boolean
  /** The 200 response body. */
  response?: z.ZodType
  /** More responses by status, e.g. `{ 201: { description: "Created", schema: Note } }`. */
  responses?: Record<number | string, { description: string; schema?: z.ZodType }>
  /** `false`: no auth on this route. A list: only these schemes. Default: the spec's. */
  security?: false | SecuritySchemeName[]
}

const DOC = Symbol.for("signet.http.apiDoc")

/**
 * What the spec says about a route, as a no-op middleware before the handler.
 * `apiDoc(false)` leaves the route out of the spec.
 */
export function apiDoc(options: ApiDocOptions | false): MiddlewareHandler {
  const mw: MiddlewareHandler = (_c, next) => next()
  Object.defineProperty(mw, DOC, { value: options })
  return mw
}

export type OpenApiOptions = {
  info: { title: string; version: string; description?: string }
  servers?: { url: string; description?: string }[]
  /**
   * The auth schemes the API accepts. `session`: Signet's session cookie
   * (`cookieName` as in `startSession`). `apiKey`: `Authorization: Bearer
   * <prefix>_…` from `./auth/api-keys`. Each given scheme is on every route
   * unless `apiDoc({ security })` says otherwise.
   */
  security?: { session?: { cookieName: string }; apiKey?: { prefix?: string } }
  /** Leave routes out, e.g. `({ path }) => !path.startsWith("/internal")`. */
  include?: (route: { method: string; path: string }) => boolean
}

export type OpenApiDocument = {
  openapi: "3.1.0"
  info: OpenApiOptions["info"]
  servers?: OpenApiOptions["servers"]
  paths: Record<string, Record<string, Json>>
  components: Json
  security?: Record<string, string[]>[]
}

/** The error envelope `errorHandler` writes, as JSON Schema. */
export const ERROR_ENVELOPE_SCHEMA = {
  type: "object",
  description: "Signet's error envelope.",
  properties: {
    success: { const: false },
    error: { type: "string", description: "A message safe to show." },
    code: { type: "string", description: "Stable machine code, e.g. VALIDATION_FAILED." },
    details: {
      type: "object",
      properties: {
        formErrors: { type: "array", items: { type: "string" } },
        fieldErrors: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" } },
        },
      },
      required: ["formErrors", "fieldErrors"],
    },
    requestId: { type: "string" },
  },
  required: ["success", "error"],
} as const

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])
const ERR = { $ref: "#/components/responses/Error" }
const SCHEME_KEY: Record<SecuritySchemeName, string> = {
  session: "sessionCookie",
  apiKey: "apiKey",
}

type Validates = { target: string; schema: z.ZodType }
type RoutableApp = { routes: ReadonlyArray<{ method: string; path: string; handler: unknown }> }

function jsonSchema(schema: z.ZodType, io: "input" | "output"): Json {
  const { $schema: _, ...rest } = toJSONSchema(schema, { io, unrepresentable: "any" }) as Json
  return rest
}

/** `/notes/:id{[0-9]+}` → `/notes/{id}`. */
const openApiPath = (path: string) => path.replace(/:(\w+)(\{[^}]*\})?\??/g, "{$1}")

/** `GET /notes/:id` → `getNotesById`. */
function operationId(method: string, path: string) {
  const words = path
    .split("/")
    .filter(Boolean)
    .map((p) => (p.startsWith(":") ? `by_${p.slice(1).replace(/\{.*$|\?$/g, "")}` : p))
    .flatMap((p) => p.split(/[^A-Za-z0-9]+/).filter(Boolean))
  return [method.toLowerCase(), ...words.map((w) => w[0]?.toUpperCase() + w.slice(1))].join("")
}

const marked = <T>(handlers: unknown[], sym: symbol): T[] =>
  handlers.flatMap((h) =>
    h && typeof h === "function" && sym in h ? [(h as unknown as Record<symbol, T>)[sym] as T] : [],
  )

/** The OpenAPI 3.1 document for every GET/POST/PUT/PATCH/DELETE route on `app`. Call it after the routes are registered. */
export function openApiSpec(app: RoutableApp, options: OpenApiOptions): OpenApiDocument {
  const groups = new Map<string, { method: string; path: string; handlers: unknown[] }>()
  for (const r of app.routes) {
    if (!METHODS.has(r.method) || r.path.includes("*")) continue // `app.use` is ALL
    const key = `${r.method} ${r.path}`
    const g = groups.get(key) ?? { method: r.method, path: r.path, handlers: [] }
    let h = r.handler as { __COMPOSED_HANDLER?: unknown } | undefined
    while (h?.__COMPOSED_HANDLER) h = h.__COMPOSED_HANDLER as typeof h
    g.handlers.push(h)
    groups.set(key, g)
  }

  const schemes: Record<string, Json> = {}
  const sec = options.security ?? {}
  if (sec.session)
    schemes.sessionCookie = { type: "apiKey", in: "cookie", name: sec.session.cookieName }
  if (sec.apiKey)
    schemes.apiKey = {
      type: "http",
      scheme: "bearer",
      description: `An API key${sec.apiKey.prefix ? ` (\`${sec.apiKey.prefix}_…\`)` : ""} in \`Authorization: Bearer\`.`,
    }
  const defaultSecurity = Object.keys(schemes).map((k) => ({ [k]: [] as string[] }))

  const paths: OpenApiDocument["paths"] = {}
  for (const { method, path, handlers } of groups.values()) {
    if (options.include && !options.include({ method, path })) continue
    const docs = marked<ApiDocOptions | false>(handlers, DOC)
    if (docs.includes(false)) continue
    const doc: ApiDocOptions = Object.assign({}, ...docs)
    const checks = marked<Validates>(handlers, VALIDATES)

    const parameters: Json[] = []
    const seen = new Set<string>()
    for (const v of checks) {
      const where = v.target === "param" ? "path" : v.target
      if (!["path", "query", "header", "cookie"].includes(where)) continue
      const s = jsonSchema(v.schema, "input")
      const props = (s.properties ?? {}) as Record<string, Json>
      const required = new Set((s.required ?? []) as string[])
      for (const [name, schema] of Object.entries(props)) {
        seen.add(`${where}:${name}`)
        const { description, ...rest } = schema
        parameters.push({
          name,
          in: where,
          required: where === "path" || required.has(name),
          ...(description ? { description } : {}),
          schema: rest,
        })
      }
    }
    for (const m of path.matchAll(/:(\w+)/g))
      if (!seen.has(`path:${m[1]}`))
        parameters.push({ name: m[1], in: "path", required: true, schema: { type: "string" } })

    const body = checks.find((v) => v.target === "json" || v.target === "form")
    const security =
      doc.security === false ? [] : doc.security?.map((n) => ({ [SCHEME_KEY[n]]: [] }))
    const secured = (security ?? defaultSecurity).length > 0

    const responses: Record<string, Json> = {
      "200": {
        description: "OK",
        ...(doc.response
          ? { content: { "application/json": { schema: jsonSchema(doc.response, "output") } } }
          : {}),
      },
    }
    for (const [status, r] of Object.entries(doc.responses ?? {}))
      responses[status] = {
        description: r.description,
        ...(r.schema
          ? { content: { "application/json": { schema: jsonSchema(r.schema, "output") } } }
          : {}),
      }
    if (doc.responses && !doc.response && Object.keys(doc.responses).some((s) => s.startsWith("2")))
      delete responses["200"]
    if (checks.length) responses["400"] ??= ERR
    if (secured) responses["401"] ??= ERR
    responses.default = ERR

    const described = checks.map((v) => v.schema.description).find(Boolean)
    const summary = doc.summary ?? described
    paths[openApiPath(path)] ??= {}
    ;(paths[openApiPath(path)] as Record<string, Json>)[method.toLowerCase()] = {
      operationId: doc.operationId ?? operationId(method, path),
      ...(summary ? { summary } : {}),
      ...(doc.description ? { description: doc.description } : {}),
      ...(doc.tags ? { tags: doc.tags } : {}),
      ...(doc.deprecated ? { deprecated: true } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(body
        ? {
            requestBody: {
              required: true,
              content: {
                [body.target === "json" ? "application/json" : "multipart/form-data"]: {
                  schema: jsonSchema(body.schema, "input"),
                },
              },
            },
          }
        : {}),
      responses,
      ...(security ? { security } : {}),
    }
  }

  return {
    openapi: "3.1.0",
    info: options.info,
    ...(options.servers ? { servers: options.servers } : {}),
    paths,
    components: {
      schemas: { Error: ERROR_ENVELOPE_SCHEMA },
      responses: {
        Error: {
          description: "Error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
      ...(Object.keys(schemes).length ? { securitySchemes: schemes } : {}),
    },
    ...(defaultSecurity.length ? { security: defaultSecurity } : {}),
  }
}

export type ServeOpenApiOptions = OpenApiOptions & {
  /** Default "/openapi.json". */
  specPath?: string
  /** Default "/docs"; `false` for no HTML page. */
  docsPath?: string | false
  /** Passed to `apiDocsHtml`. */
  docs?: ApiDocsHtmlOptions
}

/**
 * Add `GET /openapi.json` and `GET /docs` to `app`. The spec is built on the
 * first request, so routes registered after this call are in it. Both routes
 * are left out of the spec themselves. Put them behind auth with `app.use`
 * first if the API is private.
 */
export function serveOpenApi(app: Hono, options: ServeOpenApiOptions): void {
  let spec: OpenApiDocument | undefined
  const get = () => {
    spec ??= openApiSpec(app, options)
    return spec
  }
  const specPath = options.specPath ?? "/openapi.json"
  app.get(specPath, apiDoc(false), (c: Context) => c.json(get()))
  if (options.docsPath !== false)
    app.get(options.docsPath ?? "/docs", apiDoc(false), (c: Context) =>
      c.html(apiDocsHtml(get(), { specUrl: specPath, ...options.docs })),
    )
}

// ---------------------------------------------------------------- HTML docs

export type ApiDocsHtmlOptions = {
  /** Linked from the page for download. */
  specUrl?: string
  /** A stylesheet that defines Signet's tokens (the app's theme CSS); the page falls back to neutral colours. */
  stylesheet?: string
}

const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
  )

const CSS = `
:root{color-scheme:light dark;--bg:var(--color-bg-base,#fff);--fg:var(--color-text-primary,#111);--muted:var(--color-text-muted,#666);--line:var(--color-border,#e5e5e5);--card:var(--color-card,#fafafa);--accent:var(--color-primary,#2563eb)}
@media (prefers-color-scheme:dark){:root{--bg:var(--color-bg-base,#111);--fg:var(--color-text-primary,#eee);--muted:var(--color-text-muted,#999);--line:var(--color-border,#333);--card:var(--color-card,#1a1a1a)}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:2rem 1rem}
nav ul{list-style:none;padding:0;columns:2}nav a{color:var(--accent);text-decoration:none}
section{border:1px solid var(--line);border-radius:8px;background:var(--card);padding:1rem;margin:1rem 0}
h3{margin:0;font-size:1rem;display:flex;gap:.5rem;align-items:center}
.m{font:600 12px ui-monospace,monospace;padding:2px 6px;border-radius:4px;background:var(--accent);color:var(--color-primary-foreground,#fff)}
.muted{color:var(--muted)}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-top:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
pre{overflow:auto;font-size:12px;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:.5rem}code{font-family:ui-monospace,monospace}
`

/** An HTML page for `spec`: every operation with its parameters, body and responses. Plain HTML, escaped, no script. */
export function apiDocsHtml(spec: OpenApiDocument, options: ApiDocsHtmlOptions = {}): string {
  const ops = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({ path, method, op: op as Json })),
  )
  const schema = (s: unknown) => `<pre>${esc(JSON.stringify(s, null, 2))}</pre>`
  const section = ({ path, method, op }: (typeof ops)[number]) => {
    const params = (op.parameters ?? []) as Json[]
    const body = (op.requestBody as Json | undefined)?.content as Record<string, Json> | undefined
    const responses = op.responses as Record<string, Json>
    return `<section id="${esc(op.operationId)}">
<h3><span class="m">${esc(method.toUpperCase())}</span><code>${esc(path)}</code>${op.deprecated ? ' <span class="muted">deprecated</span>' : ""}</h3>
${op.summary ? `<p>${esc(op.summary)}</p>` : ""}${op.description ? `<p class="muted">${esc(op.description)}</p>` : ""}
${Array.isArray(op.security) && op.security.length === 0 ? '<p class="muted">No authentication.</p>' : ""}
${
  params.length
    ? `<h4>Parameters</h4><table><tr><th>Name</th><th>In</th><th>Type</th><th>Required</th></tr>${params
        .map(
          (p) =>
            `<tr><td><code>${esc(p.name)}</code>${p.description ? `<div class="muted">${esc(p.description)}</div>` : ""}</td><td>${esc(p.in)}</td><td><code>${esc((p.schema as Json)?.type ?? "")}</code></td><td>${p.required ? "yes" : ""}</td></tr>`,
        )
        .join("")}</table>`
    : ""
}
${
  body
    ? Object.entries(body)
        .map(
          ([type, c]) => `<h4>Body <span class="muted">${esc(type)}</span></h4>${schema(c.schema)}`,
        )
        .join("")
    : ""
}
<h4>Responses</h4><table>${Object.entries(responses)
      .map(([status, r]) => {
        const ref = typeof r.$ref === "string"
        const content = (r.content as Record<string, Json> | undefined)?.["application/json"]
        return `<tr><td><code>${esc(status)}</code></td><td>${ref ? "Error envelope" : esc(r.description)}${content ? schema(content.schema) : ""}</td></tr>`
      })
      .join("")}</table>
</section>`
  }
  const schemes = (spec.components.securitySchemes ?? {}) as Record<string, Json>
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(spec.info.title)}</title>${options.stylesheet ? `<link rel="stylesheet" href="${esc(options.stylesheet)}">` : ""}<style>${CSS}</style></head>
<body><main><h1>${esc(spec.info.title)} <span class="muted">${esc(spec.info.version)}</span></h1>
${spec.info.description ? `<p>${esc(spec.info.description)}</p>` : ""}
${options.specUrl ? `<p><a href="${esc(options.specUrl)}">OpenAPI JSON</a></p>` : ""}
${
  Object.keys(schemes).length
    ? `<h2>Authentication</h2><ul>${Object.entries(schemes)
        .map(
          ([k, s]) =>
            `<li><code>${esc(k)}</code>: ${s.in === "cookie" ? `cookie <code>${esc(s.name)}</code>` : esc(s.description ?? `${s.type} ${s.scheme ?? ""}`)}</li>`,
        )
        .join("")}</ul>`
    : ""
}
<h2>Errors</h2><p>Every error is the envelope below, with a stable <code>code</code>.</p>${schema(ERROR_ENVELOPE_SCHEMA)}
<h2>Endpoints</h2><nav><ul>${ops.map(({ path, method, op }) => `<li><a href="#${esc(op.operationId)}">${esc(method.toUpperCase())} ${esc(path)}</a></li>`).join("")}</ul></nav>
${ops.map(section).join("\n")}
</main></body></html>`
}
