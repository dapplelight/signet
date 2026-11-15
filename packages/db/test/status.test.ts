import { afterEach, describe, expect, test } from "bun:test"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { createStatus, worst } from "../src/status"
import { backends, ddl, type Instance } from "./harness"

const actor = { type: "user" as const, id: "admin-1" }
const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}

test("worst orders statuses", () => {
  expect(worst("operational", "degraded")).toBe("degraded")
  expect(worst("major_outage", "maintenance")).toBe("major_outage")
})

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })

  async function make() {
    open = await backend.make({ audit: true })
    const i = open
    const tables = (i.db.dialect === "pg" ? pgc.statusTables() : sqc.statusTables()) as ReturnType<
      typeof sqc.statusTables
    >
    for (const t of Object.values(tables)) await i.exec(ddl(t))
    let clock = Date.parse("2026-11-01T00:00:00Z")
    const status = createStatus(i.db, { tables, now: () => new Date(clock) })
    return { status, tick: (ms: number) => (clock += ms) }
  }

  test("components: create needs a name, updates keep the rest, ordered by position", async () => {
    const { status } = await make()
    expect(await code(status.setComponent("api", {}, { actor }))).toBe("BAD_VALUE")
    await status.setComponent("web", { name: "Website", position: 2 }, { actor })
    await status.setComponent("api", { name: "API", position: 1 }, { actor })
    const api = await status.setComponent("api", { status: "degraded" }, { actor })
    expect(api).toMatchObject({ name: "API", status: "degraded", position: 1 })
    expect(await code(status.setComponent("api", { status: "on_fire" as never }, { actor }))).toBe(
      "BAD_VALUE",
    )
    expect((await status.components()).map((c) => c.key)).toEqual(["api", "web"])
    expect(await status.removeComponent("web", { actor })).toBe(true)
    expect(await status.removeComponent("web", { actor })).toBe(false)
  })

  test("incidents: open, update, resolve; resolved ones are final and drop off after `days`", async () => {
    const { status, tick } = await make()
    await status.setComponent("api", { name: "API" }, { actor })
    expect(
      await code(
        status.openIncident(
          { title: "x", impact: "minor", components: ["nope"], message: "m" },
          { actor },
        ),
      ),
    ).toBe("BAD_VALUE")
    const inc = await status.openIncident(
      { title: "Slow sign-in", impact: "minor", components: ["api"], message: "Looking" },
      { actor },
    )
    expect(inc.status).toBe("investigating")
    expect((await status.summary()).status).toBe("degraded")
    tick(60_000)
    const up = await status.updateIncident(
      inc.id,
      { status: "identified", message: "Found it", impact: "critical" },
      { actor },
    )
    expect(up.updates.map((u) => u.status)).toEqual(["investigating", "identified"])
    expect((await status.summary()).status).toBe("major_outage")
    const done = await status.updateIncident(
      inc.id,
      { status: "resolved", message: "Fixed" },
      { actor },
    )
    expect(done.resolvedAt).not.toBeNull()
    expect(
      await code(status.updateIncident(inc.id, { status: "monitoring", message: "x" }, { actor })),
    ).toBe("CONFLICT")
    expect(
      await code(status.updateIncident("missing", { status: "resolved", message: "x" }, { actor })),
    ).toBe("NOT_FOUND")
    const s = await status.summary()
    expect(s.status).toBe("operational")
    expect(s.incidents.length).toBe(1)
    tick(8 * 86_400_000)
    expect((await status.summary()).incidents.length).toBe(0)
  })

  test("maintenance: off by default, toggles, shows on the summary", async () => {
    const { status } = await make()
    expect(await status.maintenance()).toEqual({ on: false, message: null, until: null })
    const until = new Date("2026-11-01T02:00:00Z")
    const m = await status.setMaintenance({ on: true, message: "Upgrading", until }, { actor })
    expect(m.on).toBe(true)
    expect(m.until?.getTime()).toBe(until.getTime())
    expect((await status.summary()).status).toBe("maintenance")
    await status.setMaintenance({ on: false }, { actor })
    expect(await status.maintenance()).toEqual({ on: false, message: null, until: null })
    expect(await code(status.setMaintenance({ on: "yes" as never }, { actor }))).toBe("BAD_VALUE")
  })
})
