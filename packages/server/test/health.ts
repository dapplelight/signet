import { healthRoutes } from "../src/observability/health"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const get = async (app: ReturnType<typeof healthRoutes>, path: string) => {
  const res = await app.request(path)
  return { res, body: await res.json() }
}
const never = () => new Promise<boolean>(() => {})

{
  const app = healthRoutes({ checks: { db: async () => false } })
  const { res, body } = await get(app, "/live")
  ok("live is 200 even when a check fails", res.status === 200 && body.ok === true, body)
  ok(
    "live is no-store json",
    res.headers.get("cache-control") === "no-store" &&
      (res.headers.get("content-type") ?? "").includes("json"),
  )
  ok("other routes are 404", (await app.request("/other")).status === 404)
}

{
  const app = healthRoutes({ checks: { db: async () => true, kv: async () => true } })
  const { res, body } = await get(app, "/ready")
  ok("all pass is 200", res.status === 200 && body.ok === true, body)
  ok(
    "all pass lists booleans in order",
    JSON.stringify(body.checks) === '{"db":true,"kv":true}',
    body,
  )
  ok("ready is no-store", res.headers.get("cache-control") === "no-store")
}

{
  const { res, body } = await get(healthRoutes({ checks: {} }), "/ready")
  ok(
    "no checks is 200",
    res.status === 200 && body.ok === true && Object.keys(body.checks).length === 0,
    body,
  )
}

{
  const app = healthRoutes({ checks: { db: async () => true, kv: async () => false } })
  const { res, body } = await get(app, "/ready")
  ok("one fails is 503", res.status === 503 && body.ok === false, body)
  ok("only the failing check is false", body.checks.db === true && body.checks.kv === false, body)
}

{
  const app = healthRoutes({ timeoutMs: 30, checks: { fast: async () => true, stuck: never } })
  const t = Date.now()
  const { res, body } = await get(app, "/ready")
  ok(
    "timeout counts as false",
    res.status === 503 && body.checks.stuck === false && body.checks.fast === true,
    body,
  )
  ok("timeout is bounded", Date.now() - t < 500, Date.now() - t)
}

{
  const secret = "postgres://user:hunter2@db.internal"
  const app = healthRoutes({
    checks: {
      async: async () => {
        throw new Error(secret)
      },
      sync: (() => {
        throw new Error(secret)
      }) as () => Promise<boolean>,
      ok: async () => true,
    },
  })
  const res = await app.request("/ready")
  const text = await res.text()
  ok(
    "throw counts as false",
    res.status === 503 && text === '{"ok":false,"checks":{"async":false,"sync":false,"ok":true}}',
    text,
  )
  ok("no error text leaked", !text.includes("hunter2") && !text.includes("Error"), text)
}

{
  let calls = 0
  const slow = (ms: number) => async () => {
    calls++
    await new Promise((r) => setTimeout(r, ms))
    return true
  }
  const t = Date.now()
  await healthRoutes({ checks: { a: slow(60), b: slow(60), c: slow(60) } }).request("/ready")
  ok("checks run in parallel", calls === 3 && Date.now() - t < 150, Date.now() - t)
}

{
  const long = "x".repeat(200)
  const { body } = await get(healthRoutes({ checks: { [long]: async () => true } }), "/ready")
  ok("long names are not truncated", long in body.checks)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
