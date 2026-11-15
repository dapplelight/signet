# @dapplelight/signet-db

Drizzle helpers for the parts every app rewrites: sortable ids, timestamps,
soft delete, money, encrypted fields, per-user scoping, an audit trail,
per-user export and erasure, seed data and a migration safety check.

The core never imports a driver. Thin entry points connect it to one:

| Import | What |
|---|---|
| `@dapplelight/signet-db` | Core: `scoped`, `audited`, `createCipher`, money, `newId`, `seed`, `exportUser`, `deleteUser`, `nextSequence`, `describeSchema`, `defineQuery`, `fromDrizzle` |
| `@dapplelight/signet-db/columns/sqlite` | Column helpers for SQLite and D1 tables |
| `@dapplelight/signet-db/columns/pg` | The same helpers for Postgres tables |
| `@dapplelight/signet-db/d1` | `createDb(env.DB)`, Cloudflare D1 |
| `@dapplelight/signet-db/sqlite` | `createDb("app.db")`, bun:sqlite |
| `@dapplelight/signet-db/postgres` | `createDb(url \| postgres())`, postgres-js (optional peer) |
| `@dapplelight/signet-db/migrations` | `checkMigrationSql`; the `signet-db-check` CLI |
| `@dapplelight/signet-db/zod` | `toZod(table, { mode })` (zod is an optional peer) |
| `@dapplelight/signet-db/agent` | `agentTools(db, { tables, userId })`, tools for AI agents (needs zod) |
| `@dapplelight/signet-db/entitlements` | `definePlans`, `createEntitlements`, billing events, usage limits, `entitlementTools` |
| `@dapplelight/signet-db/flags` | `defineFlags`, `evaluateFlag`, `createFlags` |
| `@dapplelight/signet-db/admin` | `defineAdmin(schema, { authorize })`, an admin API and admin MCP tools (needs zod) |
| `@dapplelight/signet-db/privacy` | `createPrivacy`: DPDP consent records, withdrawal, export and erasure requests; `privacyTools` |
| `@dapplelight/signet-db/growth` | `createGrowth`: waitlist, invites, referrals, onboarding, changelog, feedback; `growthTools` |

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

## Admin API from the schema

```ts
import { adminTools, defineAdmin, roles } from "@dapplelight/signet-db/admin"
import * as schema from "./schema"

export const admin = defineAdmin(schema, {
  authorize: roles(), // admin: all; staff: all but delete; readonly: list, get
  tables: {
    users: { search: ["name", "email"], readonly: ["email"], hidden: ["phone"] },
    outbox: false, // leave a table out
  },
})

const ctx = { actor: { type: "user", id: me.id }, role: me.role }
await admin.list(db, ctx, "users", { filter: { plan: { eq: "pro" } }, sort: "createdAt", limit: 20 })
await admin.update(db, ctx, "users", id, { name: "New name" })
```

Every table in the schema is included unless set to `false`; config is by SQL
table name. Operations: `meta`, `list`, `get`, `create`, `update`, `delete`,
`bulkDelete`, `action`, and `handle(db, ctx, request)` for HTTP (mount it with
signet-server's `adminRoutes`). Defaults that hold without config:

- **Deny by default.** Each op calls `authorize(ctx, { table, op })`, then again
  with the `row` (each listed row, the stored row, or the new one on create).
  Anything but `true`, or a throw, is `403 FORBIDDEN`. `roles(map)` reads
  `ctx.role`; write your own for anything finer.
- **Secrets hidden.** `encrypted()` columns and names matching password,
  hash, token, secret, salt, api key or private key are never returned,
  sorted, filtered or written. `hidden` adds more; `reveal` opts one back in.
  Audit log snapshots are cut to the audited table's visible columns.
- **Soft delete.** Rows with `deletedAt` set are left out unless a list or get
  passes `withDeleted`; delete sets `deletedAt` (`soft: true` in the result).
- **Allow-listed queries.** `sort`, `filter` and `search` columns are fixed at
  `defineAdmin` time (defaults: visible NOT NULL scalars, visible scalars,
  visible text). A request naming anything else is `400 VALIDATION_FAILED`,
  and SQL is built from Drizzle columns only. Filter operators: `eq`, `ne`,
  `in`, `isNull`, `lt`/`lte`/`gt`/`gte` (numbers, dates, text), `contains` and
  `startsWith` (text, case-insensitive).
- **Stable cursors.** Pages sort by the column plus the primary key, and the
  cursor compares against the anchor row in SQL, so ties and inserts never
  repeat or skip a row. A cursor for another sort is rejected.
- **Audited writes.** Writes go through `audited(db, { actor: ctx.actor })`;
  the db needs an audit table. The `auditLog()` table itself is list and get
  only. Inputs are strict `toZod` schemas: unknown, hidden and read-only
  fields are rejected with field-level `details`.

`meta(ctx)` returns, per table this caller may use, the columns (type, enum,
money currency, read-only, sortable, filterable, operators), relations, the
allowed ops and actions: what an admin UI or an agent renders from.

Actions add per-row operations: `actions: { refund: { description, input?,
destructive?, run: ({ row, input, ctx, db, ops }) => ... } }`, where `ops`
is the audited writer.

### Admin tools for agents

```ts
import { requireApproval } from "@dapplelight/signet-server/mcp"

tools: async ({ c }) =>
  adminTools(admin, { db: dbFor(c), ctx: await adminCtx(c), approve: requireApproval })
```

`admin_schema`, and per table `admin_<table>_list`, `_search`, `_get`; with
`approve`, also `_create`, `_update`, `_delete` and one tool per action. Only
ops `authorize` allows the caller are listed, and each call is authorized
again. A write validates and authorizes first, then calls `approve` (which
asks the person), and writes only when it returns undefined. Writes are
audited as `{ type: "agent", id: ctx.actor.id }` unless `actor` is given.

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
With a cipher on the db the stored result is encrypted, so `encrypted()` fields
the function returns are not left as plaintext in the table.
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

## Plans and entitlements

```ts
import { entitlementTables } from "@dapplelight/signet-db/columns/sqlite" // or /columns/pg
import { createEntitlements, definePlans } from "@dapplelight/signet-db/entitlements"

export const { subjectPlans, entitlementOverrides, usageCounters } = entitlementTables()

const plans = definePlans({
  free: { features: ["export"], limits: { seats: 1, aiCredits: 20 } },
  pro: { features: ["export", "sso"], limits: { seats: 10, aiCredits: 1000 } },
  team: { features: ["export", "sso", "audit"], limits: { seats: Infinity, aiCredits: 5000 } },
})

const ent = createEntitlements(db, {
  plans,
  default: "free",
  tables: { subjectPlans, entitlementOverrides, usageCounters },
  periods: { seats: "total" },                    // aiCredits: "month" by default
  billing: { plans: { plan_Nx1: "pro", price_9f: "team" }, graceMs: 3 * 86_400_000 },
})

await ent.can(orgId, "sso")              // an undeclared feature is a type error, and throws at runtime
await ent.limit(orgId, "seats")          // a limit a plan leaves out is 0; Infinity is unlimited
await ent.get(orgId)                     // { plan, storedPlan, status, graceUntil, features, limits, overrides }
await ent.consume(orgId, "aiCredits", 5) // { ok, used, limit, remaining, period }
await ent.usage(orgId)                   // this period, every limit

const actor = { type: "user", id: adminId }
await ent.setPlan(orgId, "pro", { actor })
await ent.grant(orgId, "audit", { actor, expiresAt: trialEnd }) // also revoke, setLimit (null = unlimited)
await ent.removeOverride(orgId, overrideId, { actor })
```

A subject is any id: a user or an org. It has one stored row per source:
each subscription (App Store, Google Play, Stripe, Razorpay, ...) and
`manual` for `setPlan`. Sources roll up into one entitlement per plan, active
while any of its sources is. A source is active while it is `active` or
`trialing` (until `currentPeriodEnd`, plus `graceMs` if the period ends with
no event), `cancelled` with a future `currentPeriodEnd`, or `past_due` before
`graceUntil`. Declare plans lowest first: the plan in effect is the last
declared plan with an active entitlement, else `default`. So `setPlan` sets
the manual source, and a live subscription on a later plan still wins.
`ent.get(subject)` returns `plan`, `currentPeriodEnd` (the latest among that
plan's active sources), `source` (the one behind it) and `entitlements`
(every plan with its sources). Overrides apply on
top, newest unexpired per key. Every write goes through `audited`, so the db
needs an audit table; usage counters are not audited.

`consume` adds to the counter only if the result stays within the limit, in
one `UPDATE … WHERE used + n <= limit`, so concurrent requests cannot
overspend. Periods are UTC calendar months (`"2026-11"`), days, or `"total"`.

### Billing events

```ts
const payments = createPayments({
  gateways,
  db: store,
  onEvent: (event) => ent.applyBillingEvent(event),
})
// At checkout, link the subscription to the subject on its first event:
await ent.applyBillingEvent(event, { subject: orgId }) // or billing.subjectOf(event), e.g. from notes
```

Applies `subscription.created`, `activated`, `charged`, `updated`, `paused`,
`resumed`, `past_due`, `cancelled` and `expired` (and App Store refunds) to
the source row of the event's gateway and subscription id. The subject is
`opts.subject`, `billing.subjectOf(event)`, the subject already stored for
the subscription, or for Google Play the subject of the `linkedPurchaseToken`.
A subscription belongs to one subject: an event or restore that names another
returns `{ applied: false, reason: "other_subject" }`.
The gateway plan id is read by `billing.planIdOf` (default: Razorpay's
`payload.subscription.entity.plan_id`, Stripe's item price or plan id, then
the event's store `productId`) and mapped through `billing.plans`, trying
`"<gateway>:<id>"` before `<id>`. `currentPeriodEnd` comes from
`billing.periodEndOf` (default: Stripe `current_period_end`, Razorpay
`current_end`, Paddle `current_billing_period.ends_at`, Lemon Squeezy
`ends_at` else `renews_at`; a web gateway's `subscription.cancelled` ends
access now, except Lemon Squeezy's, which lasts until `ends_at`). For `created` and `updated`, whose type does
not say whether the subscription is live, the status comes from the payload
via `billing.statusOf` (default: Stripe's `data.object.status`, Paddle's
`data.status`, Razorpay's entity status), falling back to the stored one.
Each subscription is its own source, so the old one lapsing after a
cancel-and-recreate upgrade does not touch the new one. Each
event applies once (`withIdempotency`,
so the db needs an idempotency table), and an event older than the stored
state returns `{ applied: false, reason: "stale" }`: a late `cancelled` cannot
undo a newer upgrade. `no_subject` and `unknown_plan` are not stored as done,
so a retry after linking the subject or fixing the map applies.

### App Store, Google Play and restore

```ts
const ent = createEntitlements(db, {
  plans, default: "free", tables,
  billing: {
    plans: {
      price_9f: "pro",                       // Stripe
      "appstore:pro.monthly": "pro",         // App Store product id
      "googleplay:pro": "pro",               // Google Play subscription product id
    },
    // First event before the app claimed the purchase: look the owner up in signet-payments.
    subjectOf: async (e) =>
      (await store.findLinked(e.gateway, { orderId: (e as { orderId?: string }).orderId }))?.userId,
  },
})

// Restore purchases: re-verify on the store, claim, re-attach.
const { restored, refused } = await payments.restorePurchases({ userId, purchases })
for (const r of restored)
  if (r.subscription) await ent.applySubscription(r.subscription, { subject: userId })
```

App Store and Google Play events are read with `storeStateOf`, from the
store's own state, not the event type:

| Store state | Source | Access |
|---|---|---|
| App Store status 1 (auto-renew on or off) / Play `ACTIVE`, `CANCELED` | `active` | until `currentPeriodEnd` (expiresDate / expiryTime) |
| App Store status 4 (Billing Grace Period) / Play `IN_GRACE_PERIOD` | `past_due` | until `gracePeriodExpiresDate` / `expiryTime` |
| App Store status 3 (billing retry) / Play `ON_HOLD` | `past_due` | none |
| App Store status 2, 5 (expired, refunded or revoked) / Play `EXPIRED`, revoked | `expired` | none |
| Play `PAUSED` | `paused` | none |

`applySubscription(sub, { subject })` applies a subscription read live (a
signet-payments `Subscription`), so a restore also fixes a missed webhook. A
`cancelled` web subscription ends access now, except Lemon Squeezy's, which keeps
access until its `currentPeriodEnd` (`ends_at`).

## Feature flags

```ts
import { flagOverrides } from "@dapplelight/signet-db/columns/sqlite"
import { createFlags, defineFlags } from "@dapplelight/signet-db/flags"

const flags = defineFlags({
  newEditor: {
    default: false,
    rules: [
      { when: { plan: ["team"] }, value: true },
      { when: { attributes: { country: ["IN", "LK"] } }, value: true },
    ],
    rollout: { percent: 10, value: true },
  },
})
const ff = createFlags(db, flags, { table: schema.flagOverrides, entitlements: ent })

await ff.get("newEditor", { id: userId, attributes: { country } }) // { value, reason: "rule", rule: 1 }
await ff.all({ id: userId })
await ff.set("newEditor", true, { subject: "*", actor })           // everyone; or one subject id
await ff.clear("newEditor", { subject: "*", actor })
```

First match wins: the subject's override, the everyone (`"*"`) override,
rules in order, the rollout, the default. The rollout bucket is FNV-1a of
`salt:subjectId` (salt defaults to the flag key) in 0–9999, so a subject keeps
its answer, raising the percent only adds subjects, and changing `salt`
reshuffles. `evaluateFlag(key, def, subject, override?)` is the same order as
a pure function. With `entitlements`, a subject without `plan` gets its plan
looked up. Overrides can expire and are audited. Every result says why.

### Tools for agents

```ts
import { entitlementTools } from "@dapplelight/signet-db/entitlements"
import { requireApproval } from "@dapplelight/signet-server/mcp"

const tools = entitlementTools({
  entitlements: ent,
  flags: ff,
  subject: orgId,       // or allSubjects: true for an operator agent; tools then take `subject`
  allowWrites: true,    // default false: read tools only
  actor: { type: "agent", id: "support-agent" },
  approve: (ctx, r) => requireApproval(ctx as never, r),
})
```

Read: `get_plan`, `check_entitlement`, `usage`, `list_flags`. Write (with
`allowWrites`): `grant_feature`, `set_plan`, `set_flag`. Writes always call
`approve`; without one they change nothing and return `APPROVAL_REQUIRED`.
They are audited as `actor`. Give writes only to agents run by staff: on a
per-user agent the person approving is the user who benefits.

## Growth: waitlist, invites, referrals, onboarding, changelog, feedback

```ts
import { growthTables } from "@dapplelight/signet-db/columns/sqlite" // or /columns/pg
import { createGrowth } from "@dapplelight/signet-db/growth"

export const { waitlist, invites, referralCodes, referrals, marks, feedback } = growthTables()

const growth = createGrowth(db, {
  tables: { waitlist, invites, referralCodes, referrals, marks, feedback },
  inviteTtlMs: 7 * 86_400_000,          // the default
})

// Waitlist: idempotent, position among people still waiting
await growth.joinWaitlist(email, { source: "launch", referralCode }) // { email, position, joined }
await growth.waitlistStats()            // { total, pending, invited }
await growth.markInvited([email])       // then send them an invite

// Invites: the token is returned once; only its SHA-256 is stored
const { invite, token } = await growth.createInvite({ invitedBy: userId, scope: orgId, role: "member", email })
await growth.acceptInvite(token, { userId, email }) // { ok: true, invite, already } | { ok: false, reason }
await growth.revokeInvite(invite.id)

// Referrals: one referrer per person, no self-referral, reward once
const code = await growth.referralCode(userId)   // 8 Crockford base32 characters, stable
await growth.refer(code, newUserId)               // at sign-up
const c = await growth.convertReferral(newUserId) // at first payment
if (c?.first) { /* reward c.referral.referrer */ await growth.markRewarded(newUserId) }

// Onboarding and "what's new"
await growth.completeStep(userId, "profile")
await growth.onboarding(userId, ["profile", "invite", "first-project"]) // { done, next, complete, percent }
await growth.unseenChangelog(userId, entries) // entries newer than the last markChangelogSeen
await growth.markChangelogSeen(userId)

// Feedback
await growth.sendFeedback({ subject: userId, kind: "bug", message, rating: 4, page: "/settings" })
await growth.listFeedback({ status: "new" })
```

`acceptInvite` fails with `not_found`, `expired`, `used` (by someone else),
`revoked` or `email_mismatch` (the invite names an email and the caller's
does not match). The claim is one conditional `UPDATE`, so two people
cannot accept the same invite. What accepting grants (org membership, a role)
is the app's: read `invite.scope` and `invite.role`. `marks` is one timestamp
per subject and key; onboarding uses `onboarding:<step>` keys and the
changelog `changelog:seen`, and `mark`/`marksOf` are there for your own
(tours dismissed, tips seen). Feedback kinds default to
`DEFAULT_FEEDBACK_KINDS` (bug, idea, praise, other); pass `feedbackKinds` to
change them. These writes are the user's own actions and are not audited.

### Tools for agents

```ts
import { growthTools } from "@dapplelight/signet-db/growth"

const tools = growthTools({ growth, allowWrites: true, invitedBy: staffId, approve })
```

For an operator agent. Read: `waitlist_stats`, `list_waitlist`,
`list_feedback`, `referral_stats`, `list_invites`. Write (with
`allowWrites`): `create_invite`, `revoke_invite`, `set_feedback_status`, each
gated on `approve` like the entitlement tools.

## DPDP: consent and data requests

```ts
import { privacyTables } from "@dapplelight/signet-db/columns/sqlite" // or /columns/pg
import { createPrivacy } from "@dapplelight/signet-db/privacy"

export const { consents, dataRequests } = privacyTables()

const privacy = createPrivacy(db, {
  tables: { consents, dataRequests },
  userTables: [notes, tags, [users, users.id]], // what export and erasure cover, children first
  respondWithinMs: 30 * 86_400_000,             // optional: sets dueAt; no default
})

await privacy.give(userId, "marketing-email", { noticeVersion: "2026-11-01", source: "signup" })
await privacy.has(userId, "marketing-email", { noticeVersion: "2026-11-01" })
await privacy.withdraw(userId, "marketing-email") // or withdraw(userId) for every purpose
await privacy.history(userId)                      // every record, withdrawn ones included

const req = await privacy.requestErasure(userId)   // or requestExport; one open request per kind
await privacy.overdue()                            // pending past dueAt
await privacy.fulfil(req.id, { actor: { type: "user", id: staffId } })
await privacy.reject(req.id, { actor, reason: "Could not verify identity" })
```

Consent records are append-only: each says which purpose, under which
notice version, how, and when it was given and withdrawn. Giving again under
the same notice returns the record in force; under a new notice it adds one.
`fulfil` on an export returns the data from `exportUser` (send it to the
person; it is not stored). On an erasure it runs `deleteUser` over
`userTables` (audited when the db has an audit table), withdraws every
consent, and stores the row counts. Consent and request records are kept as
the proof of what happened; whether and when to purge them, the response
deadline and the notice text are the app's decisions, not this module's.
This is record-keeping for the DPDP Act, not legal advice.

### Tools for agents

```ts
import { privacyTools } from "@dapplelight/signet-db/privacy"

const tools = privacyTools({ privacy, subject: userId, approve })
```

For an agent acting for one person. Read: `list_consents`,
`list_data_requests`. Write: `withdraw_consent`, `request_data_export`,
`request_erasure`, always gated on `approve`. Agents only open requests;
`fulfil` is a staff action in code.

## Sequences

```ts
import { sequences } from "@dapplelight/signet-db/columns/sqlite"
import { nextSequence } from "@dapplelight/signet-db"

await nextSequence(db, schema.sequences, "invoice:INV:2026-27") // 1, 2, 3, ...
```

One upsert per call, so concurrent callers never get the same value. A value
taken by a request that then fails is skipped, not reused.

## Errors

Everything thrown is a `SignetDbError` with a stable `code` (`NO_CIPHER`,
`CROSS_USER_WRITE`, `UNSCOPED_WRITE`, `CURRENCY_MISMATCH`, …) and a message
that says how to fix it. `isSignetDbError(e, "CROSS_USER_WRITE")` narrows.

## Test

```sh
bun run test       # bun:sqlite, D1 (stand-in), Postgres (PGlite) always
SIGNET_TEST_PG_URL=postgres://… bun run test   # also a real Postgres server
```
