/** createSession, and the api client's bearer token provider with one refresh-and-retry on 401. */

import { createApiClient, createRpcClient } from "../src/api/client"
import { AuthError } from "../src/api/errors"
import { createSession, fromTokenResponse, tokenEndpointRefresh } from "../src/session"
import { memoryStorage } from "../src/storage"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, JSON.stringify(d)))
}

// --- a fake API: 200 for "Bearer good", else 401 ---
let calls: { auth: string | null; credentials?: RequestCredentials; body?: unknown }[] = []
globalThis.fetch = (async (_url: string, init?: RequestInit) => {
  const auth = new Headers(init?.headers).get("authorization")
  calls.push({ auth, credentials: init?.credentials, body: init?.body })
  return auth === "Bearer good"
    ? Response.json({ ok: true })
    : Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
}) as typeof fetch

// --- cookie flow unchanged: no token option, no Authorization, credentials include ---
calls = []
await createApiClient()
  .get("/x")
  .catch(() => {})
ok("no token option: no Authorization header", calls.length === 1 && calls[0]?.auth === null)
ok("no token option: credentials still include", calls[0]?.credentials === "include")

// --- token sent as bearer ---
calls = []
await createApiClient({ token: async () => "good" }).get("/x")
ok("token sent as Bearer", calls[0]?.auth === "Bearer good")

// --- 401 then refresh then retry once, body replayed ---
calls = []
let refreshes = 0
const r = await createApiClient({
  token: async () => "stale",
  refresh: async () => (refreshes++, "good"),
}).post<{ ok: boolean }>("/x", { a: 1 })
ok("401 -> refresh -> retry succeeds", r.ok === true && refreshes === 1 && calls.length === 2)
ok(
  "retry carries the new token and the same body",
  calls[1]?.auth === "Bearer good" && calls[1]?.body === '{"a":1}',
)

// --- refresh fails: the 401 stands, onAuthError fires once, no loop ---
calls = []
let authErrors = 0
let caught: unknown
try {
  await createApiClient({
    token: async () => "stale",
    refresh: async () => null,
    onAuthError: () => authErrors++,
  }).get("/x")
} catch (e) {
  caught = e
}
ok("refresh null: AuthError, one request", caught instanceof AuthError && calls.length === 1)
ok("refresh null: onAuthError once", authErrors === 1)

// --- refreshed token still rejected: exactly one retry ---
calls = []
caught = undefined
try {
  await createApiClient({ token: async () => "stale", refresh: async () => "also-bad" }).get("/x")
} catch (e) {
  caught = e
}
ok("only one retry", caught instanceof AuthError && calls.length === 2)

// --- send() and the rpc client use the provider too ---
calls = []
await createApiClient({ token: async () => "stale", refresh: async () => "good" }).send("/x")
ok("send(): refresh and retry", calls.length === 2 && calls[1]?.auth === "Bearer good")
calls = []
const hc = (_base: string, o: { fetch: typeof fetch }) => ({ get: () => o.fetch("/x") })
const rpc = createRpcClient(hc, { token: async () => "stale", refresh: async () => "good" })
const res = await rpc.get()
ok("rpc: refresh and retry", res.ok && calls.length === 2 && calls[1]?.auth === "Bearer good")

// --- createSession ---
const storage = memoryStorage()
let refreshCalls = 0
const session = createSession({
  storage,
  refresh: async (t) => {
    refreshCalls++
    return t.refreshToken === "rt1" ? { accessToken: "good", refreshToken: "rt2" } : null
  },
})
const seen: unknown[] = []
const unsubscribe = session.subscribe((t) => seen.push(t?.accessToken ?? null))
ok("empty session: token() is null", (await session.token()) === null)
await session.set({ accessToken: "stale", refreshToken: "rt1" })
ok(
  "set persists to storage",
  JSON.parse((await storage.get("signet-session")) ?? "{}").accessToken === "stale",
)
ok(
  "a new session over the same storage loads it",
  (await createSession({ storage }).get())?.accessToken === "stale",
)

calls = []
const api = createApiClient({ token: session.token, refresh: session.refresh })
await Promise.all([api.get("/a"), api.get("/b")])
ok("concurrent 401s share one refresh", refreshCalls === 1, refreshCalls)
ok("refreshed tokens stored", (await session.get())?.refreshToken === "rt2")
ok("subscribers notified", seen.join() === "stale,good", seen)

// expired access token: refreshed before the request, not after a 401
await session.set({ accessToken: "old", refreshToken: "rt1", expiresAt: Date.now() - 1 })
calls = []
await api.get("/c")
ok("expired token refreshed up front", calls.length === 1 && calls[0]?.auth === "Bearer good")

// refresh refused: session cleared
await session.set({ accessToken: "stale", refreshToken: "revoked" })
await api.get("/d").catch(() => {})
ok(
  "refused refresh clears the session",
  (await session.get()) === null && (await storage.get("signet-session")) === null,
)
unsubscribe()
await session.set({ accessToken: "x" })
ok("unsubscribe stops notifications", seen.at(-1) === null)
await session.clear()
ok("clear", (await session.token()) === null)

// --- a failed storage read is not cached, and writes do not need a read ---
{
  const inner = memoryStorage()
  let failGets = 1
  const flaky = {
    ...inner,
    get: async (k: string) => {
      if (failGets-- > 0) throw new Error("boom")
      return inner.get(k)
    },
  }
  const s = createSession({ storage: flaky })
  let rejected = false
  await s.get().catch(() => {
    rejected = true
  })
  ok("failed read rejects", rejected)
  await s.set({ accessToken: "a" })
  ok("set works after a failed read", (await s.get())?.accessToken === "a")

  failGets = 1
  const s2 = createSession({ storage: flaky })
  await s2.token().catch(() => {})
  ok("next call retries the read", (await s2.get())?.accessToken === "a")
}

// --- clear() or set() during an in-flight refresh wins ---
{
  const run = async (during: "clear" | "set") => {
    const st = memoryStorage()
    let release: (t: { accessToken: string; refreshToken: string } | null) => void = () => {}
    const s = createSession({
      storage: st,
      refresh: () => new Promise((res) => (release = res)),
    })
    await s.set({ accessToken: "old", refreshToken: "r1" })
    const p = s.refresh()
    await new Promise((r) => setTimeout(r, 5))
    if (during === "clear") await s.clear()
    else await s.set({ accessToken: "fresh", refreshToken: "r9" })
    release(during === "clear" ? { accessToken: "new", refreshToken: "r2" } : null)
    return { result: await p, stored: await s.get() }
  }
  const c = await run("clear")
  ok("clear during refresh is not undone", c.stored === null && c.result === null, c)
  const n = await run("set")
  ok(
    "set during refresh is not wiped",
    n.stored?.accessToken === "fresh" && n.result === "fresh",
    n,
  )
}

// --- another context rotated the refresh token: use the stored tokens, do not refresh ---
{
  const st = memoryStorage()
  let calls2 = 0
  const refresh = async () => (calls2++, null)
  const worker = createSession({ storage: st, refresh })
  const popup = createSession({ storage: st })
  await worker.set({ accessToken: "a1", refreshToken: "r1" })
  await popup.get()
  await st.set("signet-session", JSON.stringify({ accessToken: "a2", refreshToken: "r2" }))
  ok("refresh picks up tokens another context stored", (await worker.refresh()) === "a2")
  ok("no refresh call when storage already moved on", calls2 === 0)
  ok("shared session survives", (await worker.get())?.refreshToken === "r2")
}

// --- after one pickup, the next refresh still calls opts.refresh when storage has not moved ---
{
  const st = memoryStorage()
  const seen: string[] = []
  const worker = createSession({
    storage: st,
    refresh: async (t) => (
      seen.push(t.refreshToken ?? ""), { accessToken: "a3", refreshToken: "r3" }
    ),
  })
  await worker.set({ accessToken: "a1", refreshToken: "r1" })
  await st.set("signet-session", JSON.stringify({ accessToken: "a2", refreshToken: "r2" }))
  ok("first refresh picks up a2", (await worker.refresh()) === "a2" && seen.length === 0)
  ok(
    "second refresh calls opts.refresh with r2",
    (await worker.refresh()) === "a3" && seen[0] === "r2",
    seen,
  )
}

// --- tokenEndpointRefresh ---
let posted = ""
const fakeEndpoint = (status: number) =>
  (async (_u: string, init?: RequestInit) => {
    posted = String(init?.body)
    return Response.json(
      status === 200
        ? { access_token: "a2", refresh_token: "r2", expires_in: 900, token_type: "Bearer" }
        : { error: "invalid_grant" },
      { status },
    )
  }) as typeof fetch
const t2 = await tokenEndpointRefresh(
  "https://api.test/token",
  "cli",
  fakeEndpoint(200),
)({ accessToken: "a", refreshToken: "r1" })
ok(
  "tokenEndpointRefresh posts a refresh grant",
  posted === "grant_type=refresh_token&refresh_token=r1&client_id=cli",
  posted,
)
ok(
  "tokenEndpointRefresh maps the response",
  t2?.accessToken === "a2" && t2.refreshToken === "r2" && (t2.expiresAt ?? 0) > Date.now(),
)
ok(
  "invalid_grant -> null",
  (await tokenEndpointRefresh(
    "u",
    "cli",
    fakeEndpoint(400),
  )({ accessToken: "a", refreshToken: "r" })) === null,
)
let threw = false
try {
  await tokenEndpointRefresh("u", "cli", fakeEndpoint(503))({ accessToken: "a", refreshToken: "r" })
} catch {
  threw = true
}
ok("5xx throws (keeps the session)", threw)
ok(
  "fromTokenResponse",
  fromTokenResponse({ access_token: "a", expires_in: 60 }, 1000).expiresAt === 61_000,
)

// --- a watching adapter: another context's sign-in, refresh and sign-out arrive ---
{
  const mem = memoryStorage()
  const cbs: ((v: string | null) => void)[] = []
  const watching = {
    ...mem,
    watch: (_k: string, cb: (v: string | null) => void) => (cbs.push(cb), () => {}),
  }
  const s1 = createSession({ storage: watching })
  const seen: (string | null)[] = []
  s1.subscribe((t) => seen.push(t?.accessToken ?? null))
  await s1.get()
  ok("watch: subscribing starts watching", cbs.length === 1, cbs.length)
  cbs[0]?.(JSON.stringify({ accessToken: "from-worker" }))
  ok(
    "watch: another context's sign-in reaches get and subscribers",
    (await s1.get())?.accessToken === "from-worker" && seen.join() === "from-worker",
    seen,
  )
  await s1.set({ accessToken: "mine" })
  cbs[0]?.(JSON.stringify({ accessToken: "mine" }))
  ok("watch: the echo of our own write is ignored", seen.join() === "from-worker,mine", seen)
  cbs[0]?.(null)
  ok("watch: another context's sign-out", (await s1.get()) === null && seen.at(-1) === null)
  cbs[0]?.("not json")
  ok("watch: garbage reads as signed out", (await s1.token()) === null)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
