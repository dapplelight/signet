/**
 * `signet conformance` against a small reference app on a local Bun.serve:
 * exit 0 when every case passes, exit 1 when one fails, and the usage errors.
 */

import { join } from "node:path"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const CLI = join(new URL("..", import.meta.url).pathname, "src/index.ts")

const envelope = (status: number, code: string, headers?: HeadersInit) =>
  Response.json({ success: false, error: code, code, requestId: "req-1" }, { status, headers })

/** The routes the cases exercise, answered the way the Signet spec says. */
async function reference(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url)
  const post = req.method === "POST"
  if (post && pathname === "/api/json") {
    try {
      await req.json()
      return Response.json({ success: true })
    } catch {
      return envelope(400, "INVALID_JSON")
    }
  }
  if (post && pathname === "/api/analytics") {
    const body = (await req.json()) as { events?: unknown }
    if (!Array.isArray(body.events)) return envelope(400, "INVALID_PAYLOAD")
    return Response.json({ success: true, written: body.events.length }, { status: 202 })
  }
  if (post && pathname === "/api/auth/token")
    return Response.json(
      { error: "unsupported_grant_type" },
      { status: 400, headers: { "cache-control": "no-store" } },
    )
  if (post && pathname === "/api/auth/revoke") return new Response(null, { status: 200 })
  if (pathname === "/api/auth/authorize" || pathname.startsWith("/api/sessions"))
    return envelope(401, "UNAUTHORIZED")
  return envelope(404, "NOT_FOUND")
}

const run = async (...args: string[]) => {
  const p = Bun.spawn(["bun", CLI, "conformance", ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ])
  return { code, out: out + err }
}

const server = Bun.serve({ port: 0, fetch: reference })
const url = `http://localhost:${server.port}`
try {
  const good = await run(url, "--json-path", "/api/json")
  ok(
    "a conformant server: exit 0, every case on its own line",
    good.code === 0 &&
      good.out.includes("pass  unknown-route-404") &&
      good.out.includes(`All 9 passed against ${url}.`) &&
      !good.out.includes("fail"),
    good.out,
  )

  const noJson = await run(url)
  ok(
    "without --json-path invalid-json-400 fails as not run, exit 1",
    noJson.code === 1 &&
      /fail {2}invalid-json-400 +not run: set the jsonPath option/.test(noJson.out) &&
      noJson.out.includes(`8 passed, 1 failed against ${url}.`),
    noJson.out,
  )

  const wrongIngest = await run(url, "--json-path", "/api/json", "--ingest", "/api/missing")
  ok(
    "a wrong --ingest path fails the ingest cases, exit 1",
    wrongIngest.code === 1 && wrongIngest.out.includes("fail  ingest-accepted-202"),
    wrongIngest.out,
  )

  const json = await run(url, "--json-path", "/api/json", "--json")
  const report = JSON.parse(json.out) as { passed: number; failed: number; results: unknown[] }
  ok(
    "--json prints the report only",
    json.code === 0 && report.passed === 9 && report.failed === 0 && report.results.length === 9,
    json.out,
  )

  const none = await run()
  ok(
    "no URL: usage, exit 1",
    none.code === 1 && none.out.includes("Usage: signet conformance"),
    none.out,
  )

  const bad = await run("not-a-url")
  ok(
    "bad URL: named, exit 1",
    bad.code === 1 && bad.out.includes('"not-a-url" is not a URL. Example: http://localhost:3000'),
    bad.out,
  )

  const noValue = await run(url, "--ingest")
  ok(
    "flag without a value",
    noValue.code === 1 && noValue.out.includes("--ingest needs a value."),
    noValue.out,
  )
} finally {
  server.stop(true)
}

// A server that is not there: every case fails with the fetch message, no crash.
const down = await run("http://localhost:1")
ok(
  "server down: exit 1, no crash",
  down.code === 1 && down.out.includes("fail  unknown-route-404"),
  down.out,
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
