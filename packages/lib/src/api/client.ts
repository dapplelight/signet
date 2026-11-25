/**
 * Fetch wrapper. Six products hand-rolled one of these; this is the union of
 * what they each got right, minus what they got wrong.
 *
 * Fixes carried from the audit:
 *   - app-d skipped `res.ok` on 5 of 9 endpoints, so a 500 HTML page
 *     reached `res.json()`. Every response is checked here.
 *   - app-a spread caller options AFTER computed headers, so passing any custom
 *     header silently dropped Content-Type. Headers are merged last here.
 *   - app-c handled non-JSON responses (204, PDFs); app-a did not.
 */

import { isErrorEnvelope } from "./contract.js"
import { ApiError, AuthError, TimeoutError } from "./errors.js"
import { isRetryable } from "./query-client.js"

export type ApiClientOptions = {
  /** Prefix for every path, e.g. "/api" or "https://api.example.com". */
  baseUrl?: string
  /** Send cookies. Required for cross-origin session auth. Default true. */
  credentials?: RequestCredentials
  /** Headers added to every request — a bearer token, a locale. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  /**
   * Called once on any 401, before AuthError is thrown. Gets the error, whose
   * message and code come from the server's envelope, so a wrong passcode on a
   * login form can be told apart from an expired session.
   */
  onAuthError?: (error: AuthError) => void
  /**
   * Bearer token for clients without cookies (extension, desktop, CLI): sent as
   * `Authorization: Bearer <token>` on every request; null sends none. Pair
   * with `credentials: "omit"`. `createSession().token` fits.
   */
  token?: () => Promise<string | null>
  /**
   * Called once on a 401 when set: return a new access token and the request
   * is retried once with it, or null and the 401 stands. `createSession().refresh` fits.
   */
  refresh?: () => Promise<string | null>
  /**
   * Milliseconds to wait for each attempt's response headers before aborting
   * it with `TimeoutError`. Default none. The body is not timed, so a stream
   * may run as long as it needs. A caller's own `signal` that aborts stays an
   * abort, never a `TimeoutError`.
   */
  timeoutMs?: number
}

const bearer = (token: string | null | undefined): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {}

/**
 * Run `attempt` with the token provider's Authorization header; on a 401, when
 * `refresh` is set, once more with the refreshed token. Without `token` and
 * `refresh` this is exactly one `attempt({})`, so cookie auth is unchanged.
 */
async function withToken(
  opts: Pick<ApiClientOptions, "token" | "refresh">,
  attempt: (auth: Record<string, string>) => Promise<Response>,
): Promise<Response> {
  const res = await attempt(bearer(await opts.token?.()))
  if (res.status !== 401 || !opts.refresh) return res
  const next = await opts.refresh()
  if (!next) return res
  await res.body?.cancel()
  return attempt(bearer(next))
}

/** Merge header sources (plain objects, Headers, or [name, value] pairs); later wins. */
function mergeHeaders(...sources: (HeadersInit | undefined)[]): Headers {
  const out = new Headers()
  for (const src of sources) for (const [k, v] of new Headers(src ?? {})) out.set(k, v)
  return out
}

const isJson = (contentType: string | null) => !!contentType && /[/+]json\b/i.test(contentType)

/** AuthError from a 401, keeping the envelope's message and code when there is one. */
async function toAuthError(res: Response): Promise<AuthError> {
  const err = await toApiError(res)
  return new AuthError(err.code || err.body ? err.message : undefined, err.code, err.body)
}

export type QueryValue = string | number | boolean | null | undefined

/**
 * Build a query string, dropping empty values. From app-c. An array appends one
 * `k=v` per item (`tag=a&tag=b`); empty items are skipped by the same rule as
 * scalars. A URL cannot tell a one-item array from a scalar: `tag=a` is the same
 * either way, so the server's `parseQuery` reads 2+ items as an array but one
 * item as a string. Array-typed query fields must accept a lone string there,
 * e.g. `z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string()))`.
 */
export function qs(params: Record<string, QueryValue | readonly QueryValue[]>): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    for (const item of Array.isArray(v) ? v : [v]) {
      if (item === undefined || item === null || item === "") continue
      search.append(k, String(item))
    }
  }
  const s = search.toString()
  return s ? `?${s}` : ""
}

export function createApiClient(opts: ApiClientOptions = {}) {
  const baseUrl = (opts.baseUrl ?? "").replace(/\/$/, "")
  const ms = opts.timeoutMs ?? 0

  /** `fetch`, with `timeoutMs` applied to the response headers. Unset: plain `fetch`. */
  async function fetchTimed(url: string, init: RequestInit): Promise<Response> {
    if (!(ms > 0)) return fetch(url, init)
    const clock = new AbortController()
    const timer = setTimeout(() => clock.abort(), ms)
    const signal = init.signal ? AbortSignal.any([init.signal, clock.signal]) : clock.signal
    // Raced as well as signalled: a fetch that ignores the signal must still reject.
    const expired = new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason)
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    })
    const requestId = new Headers(init.headers).get("x-request-id") ?? undefined
    try {
      return await Promise.race([fetch(url, { ...init, signal }), expired])
    } catch (cause) {
      // Only our clock makes a TimeoutError; the caller's own abort stays an abort.
      throw clock.signal.aborted && !init.signal?.aborted ? new TimeoutError(ms, requestId) : cause
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * The request as sent, the Response untouched: configured headers and
   * credentials, and a 401 still becomes AuthError — but any other status is
   * returned, not thrown, and `redirected`, `url` and `type` are intact. For a
   * flow that follows a redirect and inspects where it landed, or reads a JSON
   * body from a 4xx itself.
   */
  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const extra = (await opts.headers?.()) ?? {}
    const res = await withToken(opts, (auth) =>
      fetchTimed(`${baseUrl}${path}`, {
        credentials: opts.credentials ?? "include",
        ...init,
        headers: mergeHeaders(auth, extra, init.headers),
      }),
    )
    if (res.status === 401) {
      const err = await toAuthError(res)
      opts.onAuthError?.(err)
      throw err
    }
    return res
  }

  async function request<T>(path: string, init: RequestInit = {}, isForm = false): Promise<T> {
    const extra = (await opts.headers?.()) ?? {}
    const res = await withToken(opts, (auth) =>
      fetchTimed(`${baseUrl}${path}`, {
        credentials: opts.credentials ?? "include",
        ...init,
        // Merged last so caller headers extend the defaults instead of replacing
        // them. FormData deliberately sends no Content-Type — the browser must
        // set it with the multipart boundary. No body, no Content-Type: it would
        // make a cross-origin GET or body-less DELETE trigger a preflight.
        headers: mergeHeaders(
          isForm || init.body == null ? {} : { "Content-Type": "application/json" },
          auth,
          extra,
          init.headers,
        ),
      }),
    )

    if (res.status === 401) {
      const err = await toAuthError(res)
      opts.onAuthError?.(err)
      throw err
    }

    if (!res.ok) throw await toApiError(res)

    // 204 or an empty body: callers type these as void. A non-empty body that
    // is not JSON (a proxy's HTML page served with 200) is an error, not
    // `undefined` dressed up as T. Use raw() for PDFs and other binaries.
    if (res.status === 204) return undefined as T
    const text = await res.text()
    if (!text) return undefined as T
    if (!isJson(res.headers.get("content-type"))) {
      throw new ApiError(
        `Expected JSON, got ${res.headers.get("content-type") ?? "no content type"}`,
        res.status,
      )
    }
    try {
      return JSON.parse(text) as T
    } catch {
      // Never the text as the message: it can be a whole HTML page.
      throw new ApiError("Response was not valid JSON", res.status)
    }
  }

  return {
    request,
    get: <T>(path: string, init?: RequestInit) => request<T>(path, { ...init, method: "GET" }),
    post: <T>(path: string, body?: unknown, init?: RequestInit) =>
      request<T>(path, { ...init, method: "POST", body: JSON.stringify(body ?? {}) }),
    put: <T>(path: string, body?: unknown, init?: RequestInit) =>
      request<T>(path, { ...init, method: "PUT", body: JSON.stringify(body ?? {}) }),
    patch: <T>(path: string, body?: unknown, init?: RequestInit) =>
      request<T>(path, { ...init, method: "PATCH", body: JSON.stringify(body ?? {}) }),
    delete: <T>(path: string, body?: unknown, init?: RequestInit) =>
      request<T>(path, {
        ...init,
        method: "DELETE",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    postForm: <T>(path: string, body: FormData, init?: RequestInit) =>
      request<T>(path, { ...init, method: "POST", body }, true),
    send,
    /** Fetch a binary body — a PDF, an export. Returns the Response; throws on non-2xx. */
    raw: async (path: string, init?: RequestInit): Promise<Response> => {
      const res = await send(path, init)
      if (!res.ok) throw await toApiError(res)
      return res
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>

export type RpcClientOptions = ApiClientOptions & {
  /**
   * Retries for a GET or HEAD that fails transiently (network error, 5xx, 408,
   * 429), waiting the server's Retry-After, else 0.5s, 1s, 2s. Default 0:
   * TanStack Query's `queryDefaults` already retries, and the two multiply.
   */
  retries?: number
  /** The fetch underneath. Default `globalThis.fetch`; a Worker can pass a service binding's. */
  fetch?: typeof fetch
  /**
   * Milliseconds to wait for each attempt's response headers before aborting
   * it with `TimeoutError`. Default none. Override per call with `timeout(ms)`.
   * The body is not timed, so a stream may run as long as it needs; a timed-out
   * GET or HEAD counts as transient for `retries`.
   */
  timeoutMs?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const TIMEOUT = Symbol.for("signet.timeoutMs")
type TimedInit = RequestInit & { [TIMEOUT]?: number }

/**
 * Per-call timeout for a `createRpcClient` call, replacing the client's
 * `timeoutMs` (0 turns it off). Pass it as hc's `init`; other `RequestInit`
 * fields, such as a caller's own `signal`, go in the second argument.
 *
 *   await api.reports.$get({}, { init: timeout(60_000) })
 *   await api.reports.$get({}, { init: timeout(5_000, { signal: ctl.signal }) })
 */
export function timeout(ms: number, init: RequestInit = {}): RequestInit {
  return { ...init, [TIMEOUT]: ms } as TimedInit
}

/**
 * A typed client for a Hono app: pass `hc<AppType>` from `hono/client` and get
 * its client back, with this module's fetch underneath. Request and response
 * types come from the server's routes (`zValidator` for inputs); the fetch
 * adds `headers()` and credentials, an `x-request-id` (kept across retries),
 * optional retries and timeouts, and throws instead of returning a failed
 * response: a 401 is `AuthError`, a timeout `TimeoutError`, any other non-2xx
 * an `ApiError` read from the envelope. Read a streamed body with `readSse`,
 * `readNdjson` or `readText` from `./stream`.
 * So `await (await api.notes.$get()).json()` is the success type.
 *
 *   import { hc } from "hono/client"
 *   import type { AppType } from "../../api/src/app"
 *   export const api = createRpcClient(hc<AppType>, { baseUrl: "/" })
 *
 * `hc` is passed in so this package does not depend on hono.
 */
export function createRpcClient<C>(
  hc: (baseUrl: string, options: { fetch: typeof fetch }) => C,
  opts: RpcClientOptions = {},
): C {
  const base = opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a))
  const retries = opts.retries ?? 0

  const rpcFetch = async (input: RequestInfo | URL, timed: TimedInit = {}) => {
    const { [TIMEOUT]: callTimeout, ...init } = timed
    const ms = callTimeout ?? opts.timeoutMs ?? 0
    const headers = mergeHeaders((await opts.headers?.()) ?? {}, init.headers)
    if (!headers.has("x-request-id")) headers.set("x-request-id", crypto.randomUUID())
    const requestId = headers.get("x-request-id") ?? undefined
    const method = (init.method ?? "GET").toUpperCase()
    const idempotent = method === "GET" || method === "HEAD"
    for (let attempt = 0; ; attempt++) {
      let res: Response
      const clock = new AbortController()
      const timer = ms > 0 ? setTimeout(() => clock.abort(), ms) : undefined
      const signal = init.signal ? AbortSignal.any([init.signal, clock.signal]) : clock.signal
      // Raced as well as signalled: a custom fetch (a service binding, a test's
      // app.request) may ignore the signal.
      const expired = new Promise<never>((_, reject) => {
        if (signal.aborted) reject(signal.reason)
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
      try {
        res = await Promise.race([
          withToken(opts, (auth) =>
            base(input, {
              credentials: opts.credentials ?? "include",
              ...init,
              headers: mergeHeaders(auth, headers),
              signal,
            }),
          ),
          expired,
        ])
      } catch (cause) {
        // Only our clock makes a TimeoutError; the caller's own abort stays an abort.
        const err =
          clock.signal.aborted && !init.signal?.aborted ? new TimeoutError(ms, requestId) : cause
        if (!idempotent || attempt >= retries || init.signal?.aborted) throw err
        await sleep(500 * 2 ** attempt)
        continue
      } finally {
        clearTimeout(timer)
      }
      if (res.status === 401) {
        const err = await toAuthError(res)
        opts.onAuthError?.(err)
        throw err
      }
      if (res.ok) return res
      const err = await toApiError(res)
      if (!idempotent || attempt >= retries || !isRetryable(err)) throw err
      await sleep(
        err.retryAfter !== undefined ? Math.min(err.retryAfter * 1000, 30_000) : 500 * 2 ** attempt,
      )
    }
  }

  return hc((opts.baseUrl ?? "").replace(/\/$/, "") || "/", { fetch: rpcFetch as typeof fetch })
}

/**
 * Seconds until a retry can succeed, or undefined when the server did not say.
 *
 *   Retry-After        seconds, or an HTTP date (RFC 9110)
 *   RateLimit-Reset    seconds from now (IETF ratelimit-headers draft)
 *   X-RateLimit-Reset  epoch seconds (what Signet's rateLimit sends, and GitHub)
 */
export function retryAfterSeconds(headers: Headers, now = Date.now()): number | undefined {
  const ra = headers.get("retry-after")
  if (ra) {
    if (/^\d+$/.test(ra.trim())) return Number(ra)
    const at = Date.parse(ra)
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - now) / 1000))
  }
  const reset = headers.get("ratelimit-reset")
  if (reset && /^\d+$/.test(reset.trim())) return Number(reset)
  const epoch = headers.get("x-ratelimit-reset")
  if (epoch && /^\d+$/.test(epoch.trim()))
    return Math.max(0, Number(epoch) - Math.floor(now / 1000))
  return undefined
}

/**
 * An ApiError from a failed Response. Reads the body once, as text — calling
 * res.json() first consumes the stream, so a later res.text() fallback came back
 * empty and the real error message was lost.
 *
 * The message is, in order: the envelope's `error`; a bare string `error`
 * (`{ error: "Not allowed" }`); a bare string `message`; else a generic
 * "Request failed (502 Bad Gateway)", or "(HTTP 502)" when there is no status
 * text. The raw text is never the message: a proxy's 502 is a whole HTML page,
 * and that ended up in a toast.
 *
 * Any JSON body is kept on `ApiError.body`. A non-JSON body (HTML, plain text)
 * leaves `body` undefined; read it with `client.send()`, which returns the
 * Response untouched.
 */
export async function toApiError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "")
  let body: unknown
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    // Not JSON — an HTML error page or a plain string. Never the message.
  }
  const headerId = res.headers.get("x-request-id") ?? undefined
  const retry = retryAfterSeconds(res.headers)
  if (isErrorEnvelope(body)) {
    return new ApiError(
      body.error,
      res.status,
      body.code,
      body.details,
      body.requestId ?? headerId,
      retry,
      body,
    )
  }
  // Not an envelope, but a readable JSON error: `{ error: "…" }`, else
  // `{ message: "…" }` (e.g. a 409 warning body). Else a generic message.
  const field = (k: "error" | "message") =>
    body && typeof body === "object" && typeof (body as Record<string, unknown>)[k] === "string"
      ? ((body as Record<string, string>)[k] as string)
      : undefined
  const bareError = field("error") ?? field("message")
  return new ApiError(
    bareError ||
      `Request failed (${res.statusText ? `${res.status} ${res.statusText}` : `HTTP ${res.status}`})`,
    res.status,
    undefined,
    undefined,
    headerId,
    retry,
    body,
  )
}
