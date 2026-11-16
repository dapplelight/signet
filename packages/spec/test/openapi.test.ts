import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { memoryKv } from "../../server/src/adapters"
import { pkceChallenge } from "../../server/src/auth/client-login"
import { clientLoginRoutes, sessionRoutes } from "../../server/src/auth/hono"
import { kvSessionStore, startSession } from "../../server/src/auth/sessions"
import { errorHandler } from "../../server/src/http/errors"
import { memoryStore } from "../../server/src/middleware/rate-limit"
import { generateOpenApi, OPENAPI_DIR, PUBLIC_DIR } from "../scripts/gen"

type Json = Record<string, any>

const FILE = "auth.openapi.json"
const [, text] = Object.entries(generateOpenApi())[0] as [string, string]
const doc = JSON.parse(text) as Json
const read = (dir: string) => readFileSync(join(dir, FILE), "utf8")

/** Follows a local `$ref`; sibling keys (a description) win over the target's. */
function resolve<T>(node: T): T {
  if (Array.isArray(node)) return node.map(resolve) as T
  if (!node || typeof node !== "object") return node
  const { $ref, ...rest } = node as Json
  const base: Json = {}
  if (typeof $ref === "string") {
    expect($ref.startsWith("#/")).toBe(true)
    let target: any = doc
    for (const part of $ref.slice(2).split("/")) target = target?.[part]
    expect(target).toBeDefined()
    Object.assign(base, resolve(target))
  }
  for (const [k, v] of Object.entries(rest)) base[k] = resolve(v)
  return base as T
}

describe("auth.openapi.json file", () => {
  test("openapi/ equals the generated document (run `bun run gen`)", () =>
    expect(read(OPENAPI_DIR)).toBe(text))
  test("apps/docs/public/spec/v1/ is a byte-identical copy", () =>
    expect(read(PUBLIC_DIR)).toBe(text))
})

describe("auth.openapi.json structure", () => {
  const ops = Object.entries(doc.paths as Json).flatMap(([path, item]) =>
    Object.entries(item as Json)
      .filter(([k]) => ["get", "post", "put", "patch", "delete"].includes(k))
      .map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, op: op as Json })),
  )

  test("is OpenAPI 3.1.0 with the authPrefix server variable", () => {
    expect(doc.openapi).toBe("3.1.0")
    expect(doc.info.title).toBeString()
    expect(doc.servers[0].variables.authPrefix.default).toBe("/api/auth")
  })

  test("documents exactly the eight routes", () =>
    expect(ops.map((o) => o.key)).toEqual([
      "GET /",
      "POST /revoke-others",
      "DELETE /{id}",
      "GET /authorize",
      "POST /token",
      "POST /device/code",
      "POST /device/approve",
      "POST /revoke",
    ]))

  test("every $ref resolves", () => {
    const refs: string[] = []
    JSON.stringify(doc, (k, v) => {
      if (k === "$ref") refs.push(v)
      return v
    })
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) {
      expect(r.startsWith("#/")).toBe(true)
      let target: any = doc
      for (const part of r.slice(2).split("/")) target = target?.[part]
      expect(target, r).toBeDefined()
    }
  })

  test("the schema validator used below rejects a wrong body", () => {
    const oauth = resolve(doc.paths["/token"].post.responses["401"]).content["application/json"]
      .schema
    expect(z.fromJSONSchema(oauth).safeParse({ error: "invalid_client" }).success).toBe(true)
    expect(z.fromJSONSchema(oauth).safeParse({ error: "invalid_grant" }).success).toBe(false)
    expect(z.fromJSONSchema(oauth).safeParse({ success: false, error: "x" }).success).toBe(false)
  })

  test("every operation has an id and at least one response", () => {
    const ids = new Set<string>()
    for (const { key, op } of ops) {
      expect(op.operationId, key).toBeString()
      ids.add(op.operationId)
      expect(Object.keys(op.responses).length, key).toBeGreaterThan(0)
    }
    expect(ids.size).toBe(ops.length)
  })

  test("every security requirement names a declared scheme", () => {
    for (const { op } of ops)
      for (const req of (op.security ?? []) as Json[])
        for (const name of Object.keys(req))
          expect(doc.components.securitySchemes[name]).toBeDefined()
  })
})

describe("the real routes answer what the document says", () => {
  const SECRET = "test-secret-that-is-at-least-32-characters"
  const REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/"
  const store = kvSessionStore(memoryKv())
  const sessions = { cookieName: "sid", secret: SECRET, store }
  const clientOptions = {
    sessions,
    kv: memoryKv(),
    rateLimit: memoryStore(),
    clients: { "example-extension": { redirectUris: [REDIRECT] }, "example-cli": {} },
    verificationUri: "https://app.example.test/device",
    deviceStartsPerIp: { max: 3, windowSeconds: 600 },
    approvalsPerUser: { max: 4, windowSeconds: 600 },
    trust: "cloudflare" as const,
  }
  // The spec package has no hono of its own, so the apps are the route
  // objects themselves: client login at the root, sessions under /sessions.
  const app = clientLoginRoutes(clientOptions)
  app.route("/sessions", sessionRoutes(sessions))
  app.onError(errorHandler({ isProduction: () => true }))
  const withLogin = clientLoginRoutes({
    ...clientOptions,
    loginUrl: (r) => `/login?next=${encodeURIComponent(r)}`,
  })
  withLogin.onError(errorHandler({ isProduction: () => true }))

  /** Operation keys and statuses seen, to prove the document claims nothing unreachable. */
  const seen = new Set<string>()

  /** A response must be one the operation documents: status, headers, body. */
  async function check(method: string, path: string, res: Response): Promise<any> {
    const key = `${method} ${path} ${res.status}`
    const op = doc.paths[path][method.toLowerCase()] as Json
    const documented = op.responses[String(res.status)]
    expect(documented, `${key} is not documented`).toBeDefined()
    seen.add(key)
    const spec = resolve(documented) as Json

    for (const [name, header] of Object.entries((spec.headers ?? {}) as Json)) {
      const value = res.headers.get(name)
      if (!header.required) continue
      expect(value, `${key}: header ${name}`).not.toBeNull()
      const raw = header.schema.type === "integer" ? Number(value) : value
      expect(
        z.fromJSONSchema(header.schema).safeParse(raw).success,
        `${key}: ${name}=${value}`,
      ).toBe(true)
    }

    const schema = spec.content?.["application/json"]?.schema
    const raw = await res.text()
    if (!schema) {
      expect(raw, `${key}: documented without a body`).toBe("")
      return null
    }
    const body = JSON.parse(raw)
    const parsed = z.fromJSONSchema(schema).safeParse(body)
    expect(parsed.success, `${key}: ${raw}`).toBe(true)
    return body
  }

  const form = (body: Record<string, string>) => ({
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "example-cli/1.0",
    },
    body: new URLSearchParams(body).toString(),
  })

  test("session routes", async () => {
    const { token } = await startSession(sessions, { sub: "user-1", userAgent: "web" })
    const { token: other } = await startSession(sessions, { sub: "user-1", userAgent: "phone" })
    const cookie = { cookie: `sid=${token}` }

    await check("GET", "/", await app.request("/sessions"))
    await check(
      "POST",
      "/revoke-others",
      await app.request("/sessions/revoke-others", { method: "POST" }),
    )
    await check("DELETE", "/{id}", await app.request("/sessions/x", { method: "DELETE" }))

    const list = await check("GET", "/", await app.request("/sessions", { headers: cookie }))
    expect(list.sessions).toHaveLength(2)
    expect(list.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1)

    const revoked = await check(
      "POST",
      "/revoke-others",
      await app.request("/sessions/revoke-others", { method: "POST", headers: cookie }),
    )
    expect(revoked).toEqual({ revoked: 1 })
    expect((await store.listByUser("user-1")).length).toBe(1)
    expect(other).toBeString()

    await check(
      "DELETE",
      "/{id}",
      await app.request("/sessions/nope", { method: "DELETE", headers: cookie }),
    )

    const mine = list.sessions.find((s: { current: boolean }) => s.current).id
    const own = await app.request(`/sessions/${mine}`, { method: "DELETE", headers: cookie })
    expect(own.headers.get("set-cookie")).toContain("sid=")
    expect(await check("DELETE", "/{id}", own)).toEqual({ revoked: 1 })
  })

  test("client login routes", async () => {
    const { token: webToken } = await startSession(sessions, { sub: "user-2", userAgent: "web" })
    const cookie = { cookie: `sid=${webToken}` }
    const verifier = `${"v".repeat(20)}-._~${"A1".repeat(12)}`
    const query = {
      client_id: "example-extension",
      redirect_uri: REDIRECT,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: "S256",
      state: "xyz",
    }
    const authorize = (
      q: Record<string, string>,
      headers: Record<string, string> = cookie,
      to = app,
    ) => to.request(`/authorize?${new URLSearchParams(q)}`, { headers })

    // /authorize
    const ok = await authorize(query)
    await check("GET", "/authorize", ok)
    const location = new URL(ok.headers.get("location") as string)
    expect(location.searchParams.get("state")).toBe("xyz")
    await check("GET", "/authorize", await authorize({ ...query, code_challenge_method: "plain" }))
    await check(
      "GET",
      "/authorize",
      await authorize({ ...query, redirect_uri: "https://evil.example/" }),
    )
    await check("GET", "/authorize", await authorize({ ...query, client_id: "nope" }))
    await check("GET", "/authorize", await authorize(query, {}))
    const login = await authorize(query, {}, withLogin)
    await check("GET", "/authorize", login)
    expect(login.headers.get("location")).toStartWith("/login?next=")

    // /token: authorization_code, then refresh_token (JSON body), then errors
    const code = location.searchParams.get("code") as string
    const grant = await check(
      "POST",
      "/token",
      await app.request(
        "/token",
        form({
          grant_type: "authorization_code",
          client_id: "example-extension",
          redirect_uri: REDIRECT,
          code,
          code_verifier: verifier,
        }),
      ),
    )
    expect(grant.token_type).toBe("Bearer")
    const refreshed = await check(
      "POST",
      "/token",
      await app.request("/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: "example-extension",
          refresh_token: grant.refresh_token,
        }),
      }),
    )
    expect(refreshed.refresh_token).not.toBe(grant.refresh_token)
    const token = (b: Record<string, string>) => app.request("/token", form(b))
    const codes = new Set<string>()
    const failing: Record<string, string>[] = [
      {
        grant_type: "authorization_code",
        client_id: "example-extension",
        code,
        code_verifier: "short",
      },
      {
        grant_type: "authorization_code",
        client_id: "example-extension",
        redirect_uri: REDIRECT,
        code,
        code_verifier: verifier,
      },
      {
        grant_type: "refresh_token",
        client_id: "example-extension",
        refresh_token: grant.refresh_token,
      },
      { grant_type: "password", client_id: "example-extension" },
      { grant_type: "authorization_code", client_id: "nope" },
    ]
    for (const body of failing) codes.add((await check("POST", "/token", await token(body))).error)
    expect([...codes].sort()).toEqual([
      "invalid_client",
      "invalid_grant",
      "invalid_request",
      "unsupported_grant_type",
    ])

    // device flow: /device/code, polling, /device/approve, device grant
    const start = (client_id: string) => app.request("/device/code", form({ client_id }))
    const device = await check("POST", "/device/code", await start("example-cli"))
    const poll = () =>
      token({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: "example-cli",
        device_code: device.device_code,
      })
    expect((await check("POST", "/token", await poll())).error).toBe("authorization_pending")
    const slow = await check("POST", "/token", await poll())
    expect(slow.error).toBe("slow_down")
    expect(slow.interval).toBeNumber()

    const approve = (user_code: string, headers: Record<string, string> = cookie) =>
      app.request("/device/approve", {
        ...form({ user_code }),
        headers: { ...form({ user_code }).headers, ...headers },
      })
    await check("POST", "/device/approve", await approve(device.user_code, {}))
    expect(await check("POST", "/device/approve", await approve(device.user_code))).toEqual({
      ok: true,
      client_id: "example-cli",
    })
    expect((await check("POST", "/device/approve", await approve("BCDF-GHJK"))).error).toBe(
      "invalid_code",
    )
    expect((await check("POST", "/token", await poll())).access_token).toBeString()
    for (let i = 0; i < 3; i++) await approve("BCDF-GHJK")
    const limited = await approve("BCDF-GHJK")
    await check("POST", "/device/approve", limited)
    expect(limited.headers.get("retry-after")).not.toBeNull()

    await check("POST", "/device/code", await start("nope"))
    for (let i = 0; i < 2; i++) await start("example-cli")
    const tooMany = await start("example-cli")
    expect(await check("POST", "/device/code", tooMany)).toEqual({ error: "rate_limited" })

    // /revoke: 200 with no body, whatever the token
    await check(
      "POST",
      "/revoke",
      await app.request("/revoke", form({ token: refreshed.refresh_token })),
    )
    await check("POST", "/revoke", await app.request("/revoke", form({ token: "unknown" })))
    await check("POST", "/revoke", await app.request("/revoke", { method: "POST" }))
    expect(
      (
        await token({
          grant_type: "refresh_token",
          client_id: "example-extension",
          refresh_token: refreshed.refresh_token,
        })
      ).status,
    ).toBe(400)
  })

  test("every documented response was produced by a real route", () => {
    const documented = Object.entries(doc.paths as Json).flatMap(([path, item]) =>
      Object.entries(item as Json)
        .filter(([k]) => ["get", "post", "delete"].includes(k))
        .flatMap(([method, op]) =>
          Object.keys((op as Json).responses).map(
            (status) => `${method.toUpperCase()} ${path} ${status}`,
          ),
        ),
    )
    expect(documented.filter((k) => !seen.has(k))).toEqual([])
  })
})
