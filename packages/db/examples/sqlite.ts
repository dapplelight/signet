/**
 * Self-hosted SQLite on Bun (a VPS, a Docker container with a volume):
 *
 *   bun examples/sqlite.ts                  # in memory
 *   bun examples/sqlite.ts /data/app.db     # a file
 *
 * Docker: `FROM oven/bun:1`, copy the app, mount a volume at /data and pass
 * the file path. SQLite wants a single writer, so run one container.
 */
import { eq } from "drizzle-orm"
import { audited, describeSchema, scoped } from "../src"
import { createDb } from "../src/sqlite"
import * as schema from "./schema"

const db = createDb(process.argv[2] ?? ":memory:", { schema, audit: schema.audit })
schema.migrate((sql) => db.orm.run(sql))

// Per request: bind the signed-in user once; every query below is filtered.
const me = audited(scoped(db, { userId: "user-1" }))
const [order] = await me.insert(schema.orders, { item: "Filter coffee", total: 12000 })
const thisOrder = eq(schema.orders.id, order?.id ?? "")
await me.update(schema.orders, { item: "Filter coffee, large" }, thisOrder)
await me.delete(schema.orders, thisOrder) // soft delete

console.log("visible:", await me.select(schema.orders))
console.log("with deleted:", await me.select(schema.orders, undefined, { withDeleted: true }))
console.log(
  "audit:",
  (await db.orm.select().from(schema.audit)).map((a) => a.action),
)
console.log(describeSchema(schema))
