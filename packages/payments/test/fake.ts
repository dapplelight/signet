// A fetch that answers from recorded, docs-shaped fixtures and logs every call.
// Keys are "METHOD /pathname"; a value may be a function of the parsed request.

export type Call = {
  method: string
  url: string
  path: string
  headers: Record<string, string>
  body?: string
}
export type Route =
  | unknown
  | ((req: {
      body?: string
      json?: any
      form?: URLSearchParams
      url: URL
      headers: Record<string, string>
    }) => unknown)

export function fakeFetch(
  routes: Record<string, Route>,
  opts: { status?: Record<string, number> } = {},
) {
  const calls: Call[] = []
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = (init.method ?? "GET").toUpperCase()
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    const body = typeof init.body === "string" ? init.body : undefined
    calls.push({ method, url: url.toString(), path: url.pathname, headers, body })
    const key = `${method} ${url.pathname}`
    if (!(key in routes))
      return new Response(JSON.stringify({ error: `no fixture for ${key}` }), { status: 404 })
    const r = routes[key]
    let json: any
    let form: URLSearchParams | undefined
    if (body) {
      try {
        json = JSON.parse(body)
      } catch {
        form = new URLSearchParams(body)
      }
    }
    const out = typeof r === "function" ? (r as any)({ body, json, form, url, headers }) : r
    return new Response(out === undefined ? "" : JSON.stringify(out), {
      status: opts.status?.[key] ?? 200,
    })
  }) as typeof fetch
  return { fetch: f, calls }
}
