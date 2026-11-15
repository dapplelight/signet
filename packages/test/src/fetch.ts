/**
 * A `fetch` that answers from a route table and logs every call. Keys are
 * "METHOD /pathname" (host ignored); a value is the JSON body to return, or a
 * function of the parsed request. Anything unrouted answers 404, so a test
 * never reaches the network.
 *
 *   const f = fakeFetch({ "GET /v1/payments/pay_1": { id: "pay_1", status: "captured" } })
 *   const gw = razorpay({ keyId, keySecret, fetch: f.fetch })
 *   expect(f.calls[0].path).toBe("/v1/payments/pay_1")
 */

export type FetchCall = {
  method: string
  url: string
  path: string
  headers: Record<string, string>
  body?: string
}

export type RouteRequest = {
  url: URL
  headers: Record<string, string>
  body?: string
  /** The body parsed as JSON, when it is JSON. */
  json?: any
  /** The body parsed as a form, when it is not JSON. */
  form?: URLSearchParams
}

export type Route = unknown | ((req: RouteRequest) => unknown)

export type FakeFetch = {
  fetch: typeof fetch
  calls: FetchCall[]
  /** Routes are a live table: add or replace one mid-test. */
  routes: Record<string, Route>
}

export function fakeFetch(
  routes: Record<string, Route> = {},
  options: { status?: Record<string, number> } = {},
): FakeFetch {
  const calls: FetchCall[] = []
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const req = input instanceof Request ? input : undefined
    const url = new URL(req ? req.url : String(input))
    const method = (init.method ?? req?.method ?? "GET").toUpperCase()
    const headers: Record<string, string> = {}
    new Headers(init.headers ?? req?.headers).forEach((v, k) => {
      headers[k] = v
    })
    const body =
      typeof init.body === "string"
        ? init.body
        : init.body instanceof URLSearchParams
          ? init.body.toString()
          : req && method !== "GET"
            ? await req.text()
            : undefined
    calls.push({ method, url: url.toString(), path: url.pathname, headers, body })
    const key = `${method} ${url.pathname}`
    if (!(key in routes))
      return Response.json({ error: `signet-test: no route for ${key}` }, { status: 404 })
    let json: any
    let form: URLSearchParams | undefined
    if (body) {
      try {
        json = JSON.parse(body)
      } catch {
        form = new URLSearchParams(body)
      }
    }
    const r = routes[key]
    const out = typeof r === "function" ? await r({ url, headers, body, json, form }) : r
    return new Response(out === undefined ? "" : JSON.stringify(out), {
      status: options.status?.[key] ?? 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return { fetch: f, calls, routes }
}
