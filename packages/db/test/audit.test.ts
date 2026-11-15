import { afterEach, describe, expect, test } from "bun:test"
import { defineAdmin } from "../src/admin"
import { audit, purgeAudit, queryAudit, redact } from "../src/audit"
import { isSignetDbError } from "../src/errors"
import { backends, type Instance } from "./harness"

type Row = Record<string, any>
const request = { ip: "203.0.113.9", userAgent: "test-agent/1", requestId: "req-1" }

test("redact hides secret-looking fields at any depth and leaves the rest", () => {
  const out = redact(
    {
      name: "Ravi",
      passwordHash: "x",
      nested: { API_KEY: "k", list: [{ authToken: "t", n: 1 }] },
      at: new Date(0),
    },
    ["pin"],
  ) as Row
  expect(out.name).toBe("Ravi")
  expect(out.passwordHash).toBe("[redacted]")
  expect(out.nested.API_KEY).toBe("[redacted]")
  expect(out.nested.list[0]).toEqual({ authToken: "[redacted]", n: 1 })
  expect(out.at).toEqual(new Date(0))
  expect((redact({ userPin: "1234" }, ["pin"]) as Row).userPin).toBe("[redacted]")
  expect((redact({ userPin: "1234" }) as Row).userPin).toBe("1234")
})

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  const make = async (auditConfig?: Parameters<typeof backend.make>[0]["auditConfig"]) =>
    (open = await backend.make({ audit: true, auditConfig }))
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  test("an admin update writes one audit row with actor, diff, request and redacted secrets", async () => {
    const { db, S } = await make({ redact: ["phone"] })
    const [u] = await db.orm
      .insert(S.users)
      .values({ name: "Ravi", phone: "555", passwordHash: "argon2$abc" })
      .returning()
    const admin = defineAdmin(S, {
      authorize: () => true,
      tables: { outbox: false, idempotency_keys: false },
    })
    await admin.handle(
      db,
      { actor: { type: "user", id: "admin-1" }, request },
      { method: "PATCH", table: "users", id: u.id, body: { name: "Ravi K" } },
    )
    const { rows, total } = await queryAudit(db)
    expect(total).toBe(1)
    const r = rows[0] as Row
    expect([r.actorType, r.actorId, r.action, r.tableName, r.rowId]).toEqual([
      "user",
      "admin-1",
      "update",
      "users",
      u.id,
    ])
    expect([r.ip, r.userAgent, r.requestId]).toEqual([
      request.ip,
      request.userAgent,
      request.requestId,
    ])
    expect(r.before.name).toBe("Ravi")
    expect(r.after.name).toBe("Ravi K")
    expect(r.before.phone).toBe("[redacted]") // configured field
    expect(JSON.stringify(rows)).not.toContain("argon2")
    expect(JSON.stringify(rows)).not.toContain("555")
  })

  test("audit() records an event with request and redacted meta; needs an audit table", async () => {
    const { db } = await make()
    await audit(
      { db, actor: { type: "agent", id: "bot" }, request },
      "export",
      { type: "invoices", id: "i1" },
      { rows: 3, apiKey: "sk-live" },
    )
    const [r] = (await queryAudit(db)).rows as Row[]
    expect([r.action, r.tableName, r.rowId, r.requestId]).toEqual([
      "export",
      "invoices",
      "i1",
      "req-1",
    ])
    expect(r.meta).toEqual({ rows: 3, apiKey: "[redacted]" })

    const bare = await backend.make({})
    try {
      const e = await audit({ db: bare.db, actor: { type: "system", id: "j" } }, "x", {
        type: "t",
      }).catch((x) => x)
      expect(isSignetDbError(e, "NO_AUDIT_TABLE")).toBe(true)
    } finally {
      await bare.close()
    }
  })

  test("queryAudit filters by actor, target, action and date, and pages newest first", async () => {
    const { db, S } = await make()
    const at = (iso: string) => new Date(iso)
    const ins = (actorId: string, action: string, type: string, id: string, when: string) =>
      db.orm
        .insert(S.audit)
        .values({ actorType: "user", actorId, action, tableName: type, rowId: id, at: at(when) })
    await ins("a", "update", "notes", "n1", "2026-01-01T00:00:00Z")
    await ins("a", "delete", "notes", "n2", "2026-01-02T00:00:00Z")
    await ins("b", "update", "tags", "t1", "2026-01-03T00:00:00Z")
    await ins("a", "update", "notes", "n1", "2026-01-04T00:00:00Z")

    const ids = async (q: Parameters<typeof queryAudit>[1]) =>
      (await queryAudit(db, q)).rows.map((r: Row) => `${r.actorId}:${r.action}:${r.rowId}`)
    expect(await ids({ actorId: "b" })).toEqual(["b:update:t1"])
    expect(await ids({ action: "delete" })).toEqual(["a:delete:n2"])
    expect(await ids({ target: { type: "notes", id: "n1" } })).toEqual([
      "a:update:n1",
      "a:update:n1",
    ])
    expect((await queryAudit(db, { target: { type: "notes" } })).total).toBe(3)
    expect(await ids({ from: at("2026-01-02T00:00:00Z"), to: at("2026-01-04T00:00:00Z") })).toEqual(
      ["b:update:t1", "a:delete:n2"],
    )
    const page = await queryAudit(db, { limit: 2, offset: 2 })
    expect(page.total).toBe(4)
    expect(page.rows.map((r: Row) => r.rowId)).toEqual(["n2", "n1"])
  })

  test("purgeAudit deletes entries older than the retention and keeps the rest", async () => {
    const { db, S } = await make({ retentionDays: 30 })
    const day = 86_400_000
    const now = new Date("2026-06-01T00:00:00Z")
    for (const ago of [60, 31, 29, 1])
      await db.orm.insert(S.audit).values({
        actorType: "system",
        actorId: "j",
        action: "x",
        tableName: "t",
        at: new Date(now.getTime() - ago * day),
      })
    expect(await purgeAudit(db, { now })).toBe(2)
    expect((await queryAudit(db)).total).toBe(2)
    expect(await purgeAudit(db, { now, olderThanDays: 0 })).toBe(2)

    const none = await backend.make({ audit: true })
    try {
      const e = await purgeAudit(none.db).catch((x) => x)
      expect(isSignetDbError(e, "BAD_CONFIG")).toBe(true)
    } finally {
      await none.close()
    }
  })
})
