# @dapplelight/signet-db

Drizzle helpers for the parts every app rewrites: sortable ids, timestamps,
soft delete, money, encrypted fields, per-user scoping, an audit trail,
per-user export and erasure, seed data and a migration safety check.

The core never imports a driver. Thin entry points connect it to one:

| Import | What |
|---|---|
| `@dapplelight/signet-db` | Core: `scoped`, `audited`, `createCipher`, money, `newId`, `seed`, `exportUser`, `deleteUser`, `describeSchema`, `defineQuery`, `fromDrizzle` |
| `@dapplelight/signet-db/columns/sqlite` | Column helpers for SQLite and D1 tables |
| `@dapplelight/signet-db/columns/pg` | The same helpers for Postgres tables |
| `@dapplelight/signet-db/d1` | `createDb(env.DB)`, Cloudflare D1 |
| `@dapplelight/signet-db/sqlite` | `createDb("app.db")`, bun:sqlite |
| `@dapplelight/signet-db/postgres` | `createDb(url \| postgres())`, postgres-js (optional peer) |
| `@dapplelight/signet-db/migrations` | `checkMigrationSql`; the `signet-db-check` CLI |
| `@dapplelight/signet-db/zod` | `toZod(table, { mode })` (zod is an optional peer) |
| `@dapplelight/signet-db/agent` | `agentTools(db, { tables, userId })`, tools for AI agents (needs zod) |

Peers: `drizzle-orm` ^0.45, `@dapplelight/signet-lib` ^0.3, `postgres` only
for `./postgres` and `zod` only for `./zod`. Types flow from your table definitions: rows, inserts
and updates are `InferSelectModel`/`InferInsertModel` of the table you pass.

Not on npm yet (`private: true`).

## Quick start

### Cloudflare D1

```ts
import { createDb } from "@dapplelight/signet-db/d1"
import { scoped } from "@dapplelight/signet-db"
import * as schema from "./schema"

export default {
  async fetch(req: Request, bindings: { DB: D1Database }) {
    const db = createDb(bindings.DB, { schema }) // per request; no env at import time
    const me = scoped(db, { userId: await userIdFrom(req) })
    return Response.json(await me.select(schema.orders))
  },
}
```

Atomic groups (`deleteUser`) run as one D1 `batch`, since D1 has no `BEGIN`.
See `examples/d1/worker.ts`.

### SQLite on Bun (Docker, VPS)

```ts
import { createDb } from "@dapplelight/signet-db/sqlite"
const db = createDb("/data/app.db", { schema })
```

Runs on Bun (`bun:sqlite`). For better-sqlite3 on Node:
`fromDrizzle(drizzle(client), { dialect: "sqlite", atomicity: "sync-transaction" })`.
See `examples/sqlite.ts`.

### Postgres (Supabase, Neon, RDS)

```ts
import postgres from "postgres"
import { createDb } from "@dapplelight/signet-db/postgres"
const db = createDb(postgres(url, { prepare: false }), { schema }) // prepare:false for Supabase's pooler
```

See `examples/postgres.ts`.

### Any other Drizzle driver

```ts
import { fromDrizzle } from "@dapplelight/signet-db"
const db = fromDrizzle(drizzle(client), { dialect: "pg", atomicity: "transaction" })
```

## Columns

```ts
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { id, timestamps, softDelete } from "@dapplelight/signet-db/columns/sqlite" // or /columns/pg

export const orders = sqliteTable("orders", {
  id: id(),                     // text primary key, newId() on insert
  userId: text("user_id").notNull(),
  item: text("item").notNull(),
  ...timestamps(),              // createdAt, updatedAt (moves on every Drizzle update)
  ...softDelete(),              // deletedAt
})
```

`newId()` ids are 26 characters, sort by creation time as plain strings and
stay ordered within a millisecond. `idTime(id)` reads the time back.
Timestamps carry a SQL default, so migrations and raw inserts get them too.

## Money

```ts
import { money } from "@dapplelight/signet-db/columns/sqlite"
import { moneyOf, addMoney, formatMoney } from "@dapplelight/signet-db"

const items = sqliteTable("items", { id: id(), ...money("price", { currency: "INR" }) })
// → price (integer minor units: paise), priceCurrency (default 'INR')

formatMoney(addMoney(moneyOf(row, "price"), { amount: 99, currency: "INR" })) // "₹1,234.56"
```

Amounts are integers; a float or a different currency throws. Formatting turns
minor units into an exact decimal string before `Intl` sees it, so 2^53 paise
format without rounding. `minorDigits("JPY")` is 0, `"BHD"` is 3. Also
`subtractMoney`, `sumMoney`, `compareMoney`. Postgres stores amounts as
`bigint`, read as numbers.

## Encrypted fields

```ts
import { encrypted } from "@dapplelight/signet-db/columns/sqlite"
import { createCipher } from "@dapplelight/signet-db"

const profiles = sqliteTable("profiles", { id: id(), userId: text("user_id").notNull(), pan: encrypted("pan") })
const db = createDb(bindings.DB, { cipher: createCipher({ keys: { k1: bindings.FIELD_KEY }, current: "k1" }) })
await scoped(db, { userId }).insert(profiles, { pan: "ABCDE1234F" }) // stored as enc:v1:k1:…
```

AES-GCM through Web Crypto. Reads through `scoped`/`audited`/`exportUser`
decrypt; writes encrypt. A raw Drizzle write of plaintext to an `encrypted()`
column throws instead of storing it. Reads fail closed (via
`@dapplelight/signet-lib/crypto`): a value that does not decrypt comes back as
`null`, never as ciphertext, and `onUndecrypted` is called.

Rotation: the key id is stored with each value. Add a new key, make it
`current`, keep the old one in `keys`; `onStaleKey` fires when an old key was
used and `cipher.rotate(value)` re-encrypts. `generateKey()` makes a key.
Encrypted columns cannot be filtered on (random IVs). See `examples/encrypted.ts`.

## Per-user scope and soft delete

```ts
const me = scoped(db, { userId: session.userId })
await me.insert(orders, { item: "Dosa" })            // userId set for you; passing another throws
await me.select(orders, eq(orders.item, "Dosa"), { orderBy: desc(orders.createdAt), limit: 20 })
await me.update(orders, { item: "Idli" }, eq(orders.id, id))
await me.delete(orders, eq(orders.id, id))           // sets deletedAt
await me.select(orders, undefined, { withDeleted: true })
await me.delete(orders, eq(orders.id, id), { hard: true })
db.orm.select().from(orders).where(me.where(orders, extra)) // the same filter, hand-built query
```

Tables with a `userId` column get `where user_id = ?` on every read, update
and delete; tables with `deletedAt` hide deleted rows unless a call passes
`withDeleted`. A scoped update cannot change `userId`.

## Audit trail

```ts
import { auditLog } from "@dapplelight/signet-db/columns/sqlite"
export const audit = auditLog() // audit_log table; add it to your migrations

const db = createDb(bindings.DB, { schema, audit })
const me = audited(scoped(db, { userId }))                      // actor: { type: "user", id: userId }
const bot = audited(db, { actor: { type: "system", id: "nightly-cleanup" } }) // unscoped; where required
```

Each changed row gets an entry: `actorType` (`user`, `agent` or `system`),
`actorId`, `action`
(insert/update/delete/delete_user), `tableName`, `rowId`, `before`, `after`,
`at`. Encrypted fields are recorded as ciphertext. The change and its entry
are separate statements; on D1 they are not one transaction.

## Migration safety check

```sh
signet-db-check drizzle/                      # exit 1 on findings
signet-db-check $(git diff --name-only --diff-filter=A origin/main -- 'drizzle/*.sql')  # new files only, in CI
```

Flags `DROP TABLE`, `DROP COLUMN`, renames, and `NOT NULL` added without a
`DEFAULT` (including `SET NOT NULL`). drizzle-kit's SQLite table rebuilds are
not flagged. Accept a finding with `-- signet-allow: drop-column` (or `all`)
in the statement. `checkMigrationSql(sql, file)` is the same check as a function.

## Seed data

```ts
const rows = seed(users, 50, { city: "Pune" }, { seed: 7 }) // or (i) => ({ … })
await db.orm.insert(users).values(rows)
```

Values follow column types and names: Indian names, `+91` mobile numbers,
6-digit PIN codes, cities, states, emails at example.com, amounts in minor
units. Same seed, same rows. Columns with defaults are left out.

## Per-user export and delete

```ts
const tables = [orders, profiles, [users, users.id]] as const // [table, ownerColumn] when it is not userId
const data = await exportUser(db, userId, tables)  // { orders: [...], profiles: [...], users: [...] }, decrypted
const counts = await deleteUser(db, userId, tables) // { orders: 3, profiles: 1, users: 1 }
```

`deleteUser` hard-deletes in one atomic batch, in the order given (children
first if foreign keys do not cascade). With auditing on, the same batch writes
a `delete_user` entry holding the counts, not the deleted data.

## Describe the schema

```ts
describeSchema(schema)                     // text, below
describeSchema(schema, { format: "json" }) // { tables: [{ name, columns, primaryKey, scoped, softDelete, relations }] }
// table orders
//   id text primary key has default
//   user_id text not null  -- js: userId; owner; rows are per user
//   total integer not null
//   total_currency text not null has default  -- js: totalCurrency; currency of total, which is in minor units
```

Text for an agent's or a reviewer's context; JSON for tools. Each column says
whether it is the owner, the soft-delete marker, money or encrypted.

## Tools for AI agents

```ts
import { agentTools } from "@dapplelight/signet-db/agent"
import { createMcpServer } from "@dapplelight/signet-server/mcp"

const tools = agentTools(db, { tables: [orders, notes], userId: session.userId, maxRows: 50 })
createMcpServer({ name: "app", version: "1.0.0", tools }) // or call tool.run(input) yourself
```

Per table: `<table>_list`, `<table>_get`, `<table>_search` (equals or
contains), and with `allowWrites: true` also `<table>_insert` and
`<table>_update`, which take `dryRun: true` to return the would-be change.
Guards that hold for every tool:

- Scoped to `userId`; a table without a `userId` column is refused.
- Soft-deleted rows hidden; `userId` and encrypted fields never returned
  (`includeEncrypted: true` opts encrypted fields in).
- At most `maxRows` (100) rows per call; inputs are strict Zod objects, so
  unknown fields (such as `userId`) are rejected with `BAD_INPUT`.
- Writes audited as `{ type: "agent", id }` (`actor` to name the agent).

Each tool is `{ name, description, annotations, input, inputSchema, run,
handler }`: `input` and `handler` are what signet-server's MCP server
registers; `inputSchema` is JSON Schema for other runners. `AGENTS.md` is the
short guide for agents.

## Zod schemas from tables

```ts
import { toZod } from "@dapplelight/signet-db/zod"
import { parseBody } from "@dapplelight/signet-server/http/validate"

const body = await parseBody(c, toZod(orders, { mode: "insert" }))
await scoped(db, { userId }).insert(orders, body)
```

`insert` leaves out the defaulted primary key, `createdAt`, `updatedAt`,
`deletedAt` and `userId` (stripped if a client sends them; `keep: ["userId"]`
keeps one), and makes defaulted or nullable columns optional. `update` is the
same with every field optional; `select` is a full row. Dates accept ISO
strings, money amounts must be integer minor units, currency codes three
capital letters, encrypted columns plaintext strings. Generated from the
columns, no drizzle-zod.

## Transactional outbox

```ts
import { outbox } from "@dapplelight/signet-db/columns/sqlite"
const db = createDb(bindings.DB, { schema, outbox: schema.outbox })

await db.batch([
  (tx) => tx.insert(orders).values(order),
  enqueue(db, "order.created", { orderId: order.id }),   // same atomic write
])
await drainOutbox(db, queue, { batch: 50 })              // cron or waitUntil
```

`queue` is anything with `send(message)`, such as signet-server's `Queue`
adapters; messages are `{ id, topic, payload }`. Each row is leased before it
is sent, so concurrent drainers do not double-send; a failed send retries with
backoff (`2^attempt` s, capped at 1 h, or your `backoff`) until `maxAttempts`
(10), then the row is `dead`. A crash between send and mark resends: at least
once, so dedupe on `id`. In an interactive transaction:
`await enqueue(db, topic, payload)(tx)`. `pruneOutbox(db)` deletes old sent rows.

## Idempotency keys

```ts
import { idempotencyKeys } from "@dapplelight/signet-db/columns/sqlite"
const db = createDb(bindings.DB, { schema, idempotency: schema.idempotency })

const order = await withIdempotency(db, c.req.header("idempotency-key") ?? "", userId, () =>
  scoped(db, { userId }).insert(orders, body),
)
```

Runs the function once per (scope, key) and replays its stored JSON result on
retries for `ttlMs` (24 h). A duplicate that arrives while the first is still
running gets `IDEMPOTENCY_IN_FLIGHT` (answer 409); a claim left by a crash
expires after `leaseMs` (60 s). If the function throws, the key is released.
`pruneIdempotency(db)` deletes expired keys.

## Named queries

```ts
const openOrders = (userId: string) =>
  defineQuery({
    key: ["orders", "open", userId],
    run: (db: SignetDb) => scoped(db, { userId }).select(orders, isNull(orders.shippedAt)),
  })

await openOrders(userId).run(db)
```

Plain `{ key, run(db) }` objects with inferred result and key types, usable
from handlers, jobs and tests; the key names the query for caching, logs or
devtools.

## Errors

Everything thrown is a `SignetDbError` with a stable `code` (`NO_CIPHER`,
`CROSS_USER_WRITE`, `UNSCOPED_WRITE`, `CURRENCY_MISMATCH`, …) and a message
that says how to fix it. `isSignetDbError(e, "CROSS_USER_WRITE")` narrows.

## Test

```sh
bun run test       # bun:sqlite, D1 (stand-in), Postgres (PGlite) always
SIGNET_TEST_PG_URL=postgres://… bun run test   # also a real Postgres server
```
