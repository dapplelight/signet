/**
 * OpenTelemetry tracing for Hono. One server span per request, and `withSpan`
 * for work inside it. Uses only `@opentelemetry/api`, an optional peer loaded
 * on first use: without it, or without an SDK registered, every call is a
 * no-op. No exporter here; the app (or the Workers runtime) brings one.
 * Takes configuration; never reads env.
 *
 * Spans carry method, route pattern and status, never bodies, query strings or
 * headers. Needs `hono` >= 4.8 (`hono/route`).
 */

import type { Context, MiddlewareHandler } from "hono"
import { routePath } from "hono/route"

/** The slice of the OpenTelemetry API used here, so types need no install. */
type Attrs = Record<string, string | number | boolean>
type OtelSpanContext = { traceId: string; spanId: string; traceFlags: number; isRemote?: boolean }
type OtelSpan = {
  setAttribute(key: string, value: string | number | boolean): unknown
  setStatus(status: { code: number; message?: string }): unknown
  recordException(error: Error): unknown
  updateName(name: string): unknown
  end(): void
  spanContext(): OtelSpanContext
}
type OtelContext = object
type OtelApi = {
  trace: {
    getTracer(name: string): {
      startSpan(
        name: string,
        options: { kind?: number; attributes?: Attrs },
        context: OtelContext,
      ): OtelSpan
    }
    setSpan(context: OtelContext, span: OtelSpan): OtelContext
    setSpanContext(context: OtelContext, spanContext: OtelSpanContext): OtelContext
  }
  context: {
    active(): OtelContext
    with<T>(context: OtelContext, fn: () => T): T
  }
  SpanKind: { SERVER: number; INTERNAL: number }
  SpanStatusCode: { ERROR: number }
}

/** What `withSpan` hands its callback. A no-op when tracing is off. */
export type SpanHandle = { setAttribute(key: string, value: string | number | boolean): void }

export type TraceConfig = {
  /** Tracer name. Default: `serviceName`. */
  tracerName?: string
  /** Set on each span as `service.name`. */
  serviceName: string
  /** Paths (exact match) that get no span, e.g. `["/health"]`. */
  skipPaths?: string[]
  /** Extra span attributes per request. Keep PII out: nothing here is scrubbed. */
  attributes?: (c: Context) => Attrs
}

export type TraceIds = { traceId: string | undefined; spanId: string | undefined }

const DEFAULT_TRACER = "@dapplelight/signet-server"
const KEY = "signetTrace"
const TRACEPARENT = /^(?!ff)[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const ZERO_TRACE = "0".repeat(32)
const ZERO_SPAN = "0".repeat(16)

let loading: Promise<OtelApi | null> | undefined
/** The OpenTelemetry API, or null if it is not installed. Loaded once. */
function loadApi(): Promise<OtelApi | null> {
  loading ??= import("@opentelemetry/api").then(
    (m) => m as unknown as OtelApi,
    () => null,
  )
  return loading
}

function parseTraceparent(value: string | undefined): OtelSpanContext | undefined {
  const m = value ? TRACEPARENT.exec(value.trim().toLowerCase()) : null
  if (!m || m[1] === ZERO_TRACE || m[2] === ZERO_SPAN) return undefined
  return {
    traceId: m[1] as string,
    spanId: m[2] as string,
    traceFlags: Number.parseInt(m[3] as string, 16) & 1,
    isRemote: true,
  }
}

function idsOf(sc: OtelSpanContext): TraceIds {
  const valid = sc.traceId !== ZERO_TRACE && sc.spanId !== ZERO_SPAN
  return { traceId: valid ? sc.traceId : undefined, spanId: valid ? sc.spanId : undefined }
}

/**
 * The request's trace and span id. From the span `traceMiddleware` started, or
 * else the incoming `traceparent` header; both undefined if neither exists.
 */
export function traceContext(c: Context): TraceIds {
  const own = c.get(KEY) as TraceIds | undefined
  if (own) return own
  const incoming = parseTraceparent(c.req.header("traceparent"))
  return incoming ? idsOf(incoming) : { traceId: undefined, spanId: undefined }
}

/**
 * One server span per request: `http.request.method`, `http.route` (the pattern,
 * `/orders/:id`, never the raw path) and `http.response.status_code`. Status 5xx
 * and thrown errors mark the span as an error; errors are recorded on it and
 * rethrown. An incoming W3C `traceparent` header continues the caller's trace.
 * Mount it after `requestId`.
 */
export function traceMiddleware(cfg: TraceConfig): MiddlewareHandler {
  const skip = new Set(cfg.skipPaths)
  return async (c, next) => {
    const otel = skip.has(c.req.path) ? null : await loadApi()
    if (!otel) return next()

    const method = c.req.method
    const route = routePath(c, -1)
    const parent = parseTraceparent(c.req.header("traceparent"))
    const base = otel.context.active()
    const span = otel.trace.getTracer(cfg.tracerName ?? cfg.serviceName).startSpan(
      `${method} ${route}`,
      {
        kind: otel.SpanKind.SERVER,
        attributes: {
          "service.name": cfg.serviceName,
          "http.request.method": method,
          "http.route": route,
          ...cfg.attributes?.(c),
        },
      },
      parent ? otel.trace.setSpanContext(base, parent) : base,
    )
    c.set(KEY, idsOf(span.spanContext()))

    const fail = (err: unknown) => {
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.setStatus({ code: otel.SpanStatusCode.ERROR })
    }
    try {
      await otel.context.with(otel.trace.setSpan(base, span), next)
      // Hono hands a handler's throw to `onError` and keeps going, so it shows
      // up as `c.error` rather than as an exception here.
      if (c.error) fail(c.error)
      else if (c.res.status >= 500) span.setStatus({ code: otel.SpanStatusCode.ERROR })
      span.setAttribute("http.response.status_code", c.res.status)
    } catch (err) {
      fail(err)
      throw err
    } finally {
      span.end()
    }
  }
}

/**
 * Runs `fn` in a child span of the current one. Without an SDK registered `fn`
 * still runs, with a no-op handle. A throw is recorded on the span and
 * rethrown. Attributes are yours to keep free of PII.
 */
export async function withSpan<T>(
  name: string,
  attrs: Attrs,
  fn: (span: SpanHandle) => T | Promise<T>,
): Promise<T> {
  const otel = await loadApi()
  if (!otel) return fn({ setAttribute: () => {} })
  const base = otel.context.active()
  const span = otel.trace
    .getTracer(DEFAULT_TRACER)
    .startSpan(name, { kind: otel.SpanKind.INTERNAL, attributes: attrs }, base)
  try {
    return await otel.context.with(otel.trace.setSpan(base, span), () => fn(span))
  } catch (err) {
    span.recordException(err instanceof Error ? err : new Error(String(err)))
    span.setStatus({ code: otel.SpanStatusCode.ERROR })
    throw err
  } finally {
    span.end()
  }
}
