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
import { ApiError, AuthError } from "./errors.js"

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

/** Build a query string, dropping empty values. From app-c. */
export function qs(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue
    search.set(k, String(v))
  }
  const s = search.toString()
  return s ? `?${s}` : ""
}

export function createApiClient(opts: ApiClientOptions = {}) {
  const baseUrl = (opts.baseUrl ?? "").replace(/\/$/, "")

  /**
   * The request as sent, the Response untouched: configured headers and
   * credentials, and a 401 still becomes AuthError — but any other status is
   * returned, not thrown, and `redirected`, `url` and `type` are intact. For a
   * flow that follows a redirect and inspects where it landed, or reads a JSON
   * body from a 4xx itself.
   */
  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const extra = (await opts.headers?.()) ?? {}
    const res = await fetch(`${baseUrl}${path}`, {
      credentials: opts.credentials ?? "include",
      ...init,
      headers: mergeHeaders(extra, init.headers),
    })
    if (res.status === 401) {
      const err = await toAuthError(res)
      opts.onAuthError?.(err)
      throw err
    }
    return res
  }

  async function request<T>(path: string, init: RequestInit = {}, isForm = false): Promise<T> {
    const extra = (await opts.headers?.()) ?? {}
    const res = await fetch(`${baseUrl}${path}`, {
      credentials: opts.credentials ?? "include",
      ...init,
      // Merged last so caller headers extend the defaults instead of replacing
      // them. FormData deliberately sends no Content-Type — the browser must
      // set it with the multipart boundary.
      headers: mergeHeaders(
        isForm ? {} : { "Content-Type": "application/json" },
        extra,
        init.headers,
      ),
    })

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
    return JSON.parse(text) as T
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
