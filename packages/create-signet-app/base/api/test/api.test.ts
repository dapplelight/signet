import { expect, spyOn, test } from "bun:test"
import { app, createApp, openDb, sqlKv } from "./helpers.ts"

test("observability is off unless configured: no /health, no log lines", async () => {
  const lines: string[] = []
  const spy = spyOn(console, "log").mockImplementation((l: string) => void lines.push(l))
  try {
    expect((await app.request("/health/live")).status).toBe(404)
    expect((await app.request("/api/health")).status).toBe(200)
  } finally {
    spy.mockRestore()
  }
  expect(lines).toEqual([])
})

test("observability on: request logs, probes left out, /health/ready checks the database", async () => {
  const lines: string[] = []
  const spy = spyOn(console, "log").mockImplementation((l: string) => void lines.push(l))
  try {
    const { db, query } = openDb(":memory:")
    const on = createApp({
      db,
      query,
      kv: sqlKv(db.orm),
      observability: { serviceName: "demo", mixin: () => ({ region: "test" }) },
    })
    const live = await on.request("/health/live")
    expect(live.status).toBe(200)
    expect(await live.json()).toEqual({ ok: true })
    const ready = await on.request("/health/ready")
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ ok: true, checks: { db: true } })
    expect(lines).toEqual([]) // probes are not logged
    const headers = { cookie: "session=s" }
    const res = await on.request("/api/health?token=abc", { headers })
    expect([res.status, await res.text()]).toEqual([200, '{"ok":true}'])
  } finally {
    spy.mockRestore()
  }
  const logged = lines.map((l) => JSON.parse(l) as Record<string, unknown>)
  expect(logged.map((l) => l.msg)).toEqual(["request.started", "request.completed"])
  expect(logged[1]).toMatchObject({
    service: "demo",
    region: "test",
    method: "GET",
    route: "/api/health",
    status: 200,
  })
  expect(typeof logged[1]?.reqId).toBe("string")
  expect(lines.join("\n")).not.toMatch(/token=abc|session=s/)
})
