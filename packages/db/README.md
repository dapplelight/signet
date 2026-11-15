# @dapplelight/signet-db

Drizzle helpers for the parts every app rewrites: sortable ids, timestamps,
soft delete, money, encrypted fields, per-user scoping, an audit trail,
per-user export and erasure, seed data and a migration safety check.

The core never imports a driver. Thin entry points connect it to one:

| Import | What |
|---|---|
| `@dapplelight/signet-db` | Core: `scoped`, `audited`, `createCipher`, money, `newId`, `seed`, `exportUser`, `deleteUser`, `nextSequence`, `describeSchema`, `defineQuery`, `fromDrizzle`, `dbCache` |
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
| `@dapplelight/signet-db/webhooks` | `createWebhooks`: outbound webhooks per user or org, signed, retried through the outbox, with a delivery log |
| `@dapplelight/signet-db/privacy` | `createPrivacy`: DPDP consent records, withdrawal, export and erasure requests; `privacyTools` |
| `@dapplelight/signet-db/analytics` | `createAnalyticsStore`: events in your database, counts, uniques, series, breakdowns, funnels, retention, trends; `analyticsTools` |
| `@dapplelight/signet-db/orgs` | `createOrgs`: organisations, memberships, roles and permissions, custom roles, invites, per-org domain and theme |
| `@dapplelight/signet-db/growth` | `createGrowth`: waitlist, invites, referrals, onboarding, changelog, feedback; `growthTools` |
| `@dapplelight/signet-db/workflows` | `defineWorkflow`, `createWorkflows`: durable multi-step runs with sleeps, events, human approvals, retries, cancel |
| `@dapplelight/signet-db/offerings` | `createOfferings`: versioned offerings (store and web products mapped to plans) with a remote paywall, served per placement and audience; `plansFromProducts` |
| `@dapplelight/signet-db/customers` | `createCustomers`: the customer timeline across stores and web, anonymous-to-account identity merge, and the Customer Center (cancel, refund request, retention offer, support) |

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

## Outbound webhooks

`@dapplelight/signet-db/webhooks`: endpoints registered per user or org, each
with its own `whsec_` secret; Standard Webhooks signatures; retries with
backoff through the outbox; a delivery log; manual redelivery; endpoints
switched off after repeated failures.

```ts
import { webhookTables } from "@dapplelight/signet-db/columns/sqlite" // or /columns/pg
import { createWebhooks, WEBHOOK_TOPIC } from "@dapplelight/signet-db/webhooks"
import { drainOutbox } from "@dapplelight/signet-db"

export const { webhookEndpoints, webhookDeliveries } = webhookTables()

const webhooks = createWebhooks(db, { endpoints: webhookEndpoints, deliveries: webhookDeliveries })
const { endpoint, secret } = await webhooks.register({ owner: orgId, url, events: ["order.created"] }) // secret shown once

// Queued in the same atomic write as the change that caused it:
await db.batch([
  (tx) => tx.insert(orders).values(order),
  ...(await webhooks.statements({ owner: orgId, type: "order.created", data: order })),
])

// From a cron: webhook rows go to webhooks.send, the rest to the app's queue.
await drainOutbox(db, { send: (m) => (m.topic === WEBHOOK_TOPIC ? webhooks.send(m) : queue.send(m)) })
```

- **Signature:** `webhook-id` (the event id), `webhook-timestamp` and
  `webhook-signature: v1,<base64 HMAC-SHA256 of id.timestamp.body>`, made by
  `signWebhook` from `@dapplelight/signet-lib/webhooks`. Receivers call
  `verifyWebhook(secret, headers, rawBody)` and dedupe on `webhook-id`, which
  is the same on every retry and redelivery. The body is
  `{ type, timestamp, data }`.
- **Retries:** each delivery is one outbox row, so `drainOutbox`'s backoff and
  `maxAttempts` apply. Pass the same `maxAttempts` to `createWebhooks` so the
  last attempt logs as `failed`. A delivered row is never posted again, even
  when the at-least-once outbox hands it over twice.
- **Delivery log:** `deliveries(owner, { endpointId, status, limit, before })`,
  newest first: status (`pending`, `retrying`, `delivered`, `failed`,
  `skipped`), attempts, the response status, the first 2 KB of the response,
  the error and the duration.
- **Redeliver:** `redeliver(owner, deliveryId)` queues a new delivery with the
  same event id and body.
- **Disable:** after `disableAfter` (default 20) failed attempts in a row the
  endpoint is switched off and its queued deliveries are `skipped`.
  `update(owner, id, { enabled: true })` turns it back on.
- **Safety:** urls must be `https:` on a public host (no localhost, private
  ranges, IP literals or credentials) unless `allowPrivateUrls`. Before every
  attempt the host is resolved (`node:dns/promises` `lookup` with `all: true`
  on Bun and Node) and the delivery is refused if any address is private,
  loopback, link-local, CGNAT, unique-local IPv6 or IPv4-mapped; that logs as
  a failed attempt (`Refused: <host> resolves to a private address`) and
  counts toward `disableAfter` like any other failure. Redirects are never
  followed: a 3xx is a failed attempt. Each attempt times out after
  `timeoutMs` (10 s). With a db cipher, secrets are stored encrypted;
  `rotateSecret` replaces one.
- **Runtimes without DNS:** on Cloudflare Workers without `nodejs_compat`
  there is nothing to resolve with, so the check is skipped and the
  platform's outbound protections apply. Pass `resolveHost: (host) =>
  Promise<string[]>` (DNS over HTTPS, say) to enforce it there too.

Admin routes: `webhookRoutes` in `@dapplelight/signet-server/http/webhooks`.
Screen: `WebhookDeliveryLog` in `@dapplelight/signet-ui/screens/api-screens`.

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

## AI answer cache

A persistent cache for signet-ai's `createExtractor`, on a table in either
dialect, so paid answers survive restarts and are shared by every process.

```ts
// schema.ts
import { aiCache } from "@dapplelight/signet-db/columns/sqlite" // or /columns/pg
export const aiAnswers = aiCache() // table "ai_cache"

// where the extractor is made
import { dbCache } from "@dapplelight/signet-db"
const ai = createExtractor({ providers, cache: dbCache(db, schema.aiAnswers) })
```

Rows are keyed by signet-ai's hash of model, schema, instructions and input,
hold the entry as JSON and expire after the extractor's `cacheTtlSeconds`. An
expired or unreadable row is a miss (an expired one is deleted on read). With a
cipher on the db the entry is encrypted, since answers often repeat the
personal data they were given. `pruneAiCache(db, table)` deletes expired rows;
run it from a cron. Held in a variable before it reaches `createExtractor`,
type it: `dbCache<CacheEntry>(db, table)`.

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

## Offerings, customers and the Customer Center

RevenueCat-style monetisation on top of plans and entitlements, in your own
database. Tables: `monetisationTables()` from `/columns/sqlite` or `/columns/pg`
(`offerings`, `placements`, `customerIdentities`, `customerEvents`,
`customerRequests`, `chartAudiences`).

### Offerings and remote paywalls

```ts
import { monetisationTables } from "@dapplelight/signet-db/columns/sqlite"
import { createOfferings, plansFromProducts } from "@dapplelight/signet-db/offerings"

export const { offerings, placements, customerIdentities, customerEvents, customerRequests } =
  monetisationTables()

const products = [
  { id: "pro.monthly", store: "appstore", plan: "pro", interval: "month" },
  { id: "pro_monthly", store: "googleplay", plan: "pro", interval: "month" },
  { id: "price_pro_m", store: "web", plan: "pro", interval: "month", price: { amount: 49900, currency: "INR" } },
] as const
const off = createOfferings(db, { tables: { offerings, placements }, plans })
const ent = createEntitlements(db, { plans, default: "free", tables, billing: { plans: plansFromProducts(products) } })

await off.publish("default", {
  products,
  paywall: { title: "Go pro", plans: ["pro"], highlight: "pro", badge: "Best value", trial: "7 days free", cta: "Start trial" },
}, { actor })                                                     // version 1; the next publish is 2
await off.setPlacement("onboarding", {
  offering: "default",                                             // latest version; `version: 1` pins (rollback)
  overrides: [{ when: { country: ["IN"], platform: ["web"] }, offering: "india" }],
}, { actor })
await off.current("onboarding", { country: "IN", platform: "web", attributes: { cohort: "beta" } })
// { key, version, products, paywall, placement, override: 0 }
```

- A product maps a store product id (App Store, Google Play) or a web
  gateway's plan or price id to a plan. `plansFromProducts` turns them into
  entitlements' `billing.plans` keys (`"appstore:<id>"`, `"googleplay:<id>"`,
  bare ids for web), so what the paywall sells is what billing grants.
- `publish` validates (every plan declared, no product twice, integer
  prices, a highlight the offering sells) and writes an immutable version;
  the row id is `key@version`, so concurrent publishes never share a number.
- A placement serves its offering's latest version unless pinned. Overrides
  match `country`, `platform` and `attributes` (a list matches any value),
  first match wins, with the same matcher as feature flags. Changing either
  needs no app release: the app asks for the placement each time.
- Admin-editable: `publish`, `setPlacement`, `versions`, `list` and
  `placements`, or signet-server's `monetisationAdminRoutes`. In
  `defineAdmin`, list `offerings` as read-only so versions stay immutable.
- The paywall config is copy, not logic: the purchase still goes through your
  checkout (`payments.checkout` on the web; StoreKit or Play Billing, then
  `verifyPurchase`, in the app). signet-ui's `RemotePaywall` renders it.

### Customer timeline

```ts
import { createCustomers } from "@dapplelight/signet-db/customers"

const customers = createCustomers(db, {
  tables: { ...entitlementTables, customerIdentities, customerEvents, customerRequests },
  entitlements: ent,
  payments: store,                          // signet-payments store: payments, ledger, merge
})
createPayments({
  ...,
  onEvent: async (e) => {
    const subject = await customers.resolve(ownerOf(e)) // the app's user id or anonymous id
    await ent.applyBillingEvent(e, { subject })
    await customers.record(e, { subject })
  },
})
await customers.timeline(userId) // { entries: [{ kind, gateway, amount, ... }], totals: [{ currency, paid, refunded, approximate }] }
```

`record` puts each event on its customer's timeline once (keyed by gateway
and event id), as `purchase`, `renewal`, `refund`, `cancellation`,
`uncancellation`, `billing_issue`, `grace_period` (App Store status 4, Play
`IN_GRACE_PERIOD`), `expiration`, `paused` or `dispute`. Without a subject it
uses the owner of the event's subscription or payment. `timeline` adds the
events of the customer's payments from the payments store and totals per
currency from the ledger (App Store prices are marked `approximate`).

### Identity merge

```ts
const anon = await customers.anonymousId({ orgId })   // "anon_<uuid>", before sign-in
// Buy as anon: App Store appAccountToken = anon.slice(5); verifyPurchase({ userId: anon })
const r = await customers.merge({ anonymousId: anon, userId, orgId })
// { merged: true, already: false, moved: { subscriptions, overrides, events, requests, payments } }
```

Moves the anonymous id's subscriptions (not a `manual` plan), grants,
timeline, requests and, with `payments`, its payments (`reassignUser`) to the
account. Rows move, never copy, so nothing is granted twice. The claim is one
conditional UPDATE: of concurrent merges into different accounts exactly one
wins (`already_merged` for the rest); repeating a merge into the same account
returns `already: true` and finishes anything a crash left half done.
Refused: an id `anonymousId` did not issue (`not_anonymous`, so two real
accounts never merge), the same id, a target that is itself anonymous, another
org (`other_org`), or, with `isMember`, a user outside the org. Anonymous ids
carry 122 random bits: whoever holds one can claim its purchases, so keep it
on the device. After a merge, `resolve(anon)` is the account, so pass events
tagged with the old id through it.

### Customer Center

```ts
const customers = createCustomers(db, {
  ...,
  notify: (n) => notifier.notify(teamId, "customer.request", { kind: n.kind, text: n.text }),
  cancel: (s) => payments.gateway(s.gateway).cancelSubscription(s.subscriptionId, { atPeriodEnd: true }),
  retention: { offer: { kind: "discount", percent: 50, months: 3 }, apply: ({ source }) => applyCoupon(source) },
  googlePlayPackage: "com.example.app",
})
await customers.overview(userId)        // plan, status, currentPeriodEnd, renews, source, manageUrl, canCancel, retention
await customers.cancel(userId)          // web: cancelled at the gateway; store: { cancelled: false, reason: "store", manageUrl }
await customers.acceptRetention(userId) // once per customer; applied through `retention.apply`
await customers.requestRefund(userId, { gateway, paymentId, reason }) // once per payment; the team is notified
await customers.contactSupport(userId, { message, email, topic })
await customers.requests({ status: "open" }); await customers.setRequestStatus(id, "done", { actor })
```

- Stores cannot be cancelled by a server: `manageUrl` is the App Store's
  subscriptions page, or Google Play's for the product and package. App Store
  refund requests also return `storeUrl` (Apple decides those).
- A refund request is only for the customer's own payment (payments store,
  else their timeline); anything else is `NOT_FOUND`. It is recorded before
  `notify` runs, and a request whose notice failed is sent again on retry.
- The retention offer is shown to a live web subscription that never took
  one; pass `eligible` to change that (store offers belong to the store).
- A web cancel is recorded, so `renews` and `canCancel` turn false while the
  gateway still reports the subscription active until its period end.
- signet-ui's `CustomerCenter` renders it; signet-server's
  `monetisationRoutes` serves it.

### Offers

Free trials, intro offers and win-back offers ride on offering products, so
they change with a `publish` like the rest of the paywall:

```ts
await off.publish("default", {
  products: [{
    id: "pro.monthly", store: "appstore", plan: "pro", interval: "month",
    offers: [
      { id: "trial7", type: "free_trial", days: 7 },                       // never subscribed, once
      { id: "winback50", type: "win_back", price: { amount: 249, currency: "USD" }, days: 30,
        eligibility: { lapsedDays: 30 } },                                 // lapsed 30+ days, once
    ],
  }],
}, { actor })

const offering = await customers.withOffers(userId, await off.current("onboarding", audience))
// each product's `offers` cut to what this customer may see now, best first
await customers.redeemOffer(userId, offering, "winback50")
// { redeemed: true, offer, product } | { redeemed: false, reason: "not_eligible" | "already_used" | "no_such_offer" }
```

- Eligibility (`offerEligible(offer, history)`, a pure function): never while
  a subscription is live; `neverSubscribed` (the default for free trials and
  intro offers) means no subscription or trial before on any plan;
  `lapsedDays: n` (required for win-back) means the last subscription ended
  at least `n` days ago; every offer is once per customer unless
  `once: false`, and a free trial is also spent by any earlier trial on the
  timeline.
- `redeemOffer` claims the offer before you apply it (a web coupon, a trial
  at checkout): one row per customer and offer, so of concurrent claims one
  wins. Store offers are still the store's to grant (App Store intro
  eligibility, Play offer tags); the filter decides what the paywall shows.
- signet-server's `GET /offerings/:placement` returns the filtered offering;
  signet-ui's `RemotePaywall` shows the first offer and passes it to
  `onPurchase`.

### Promotional entitlements

```ts
await customers.grantPromotional(userId, { plan: "pro", days: 30, note: "Beta tester" }, { actor })
// or { expiresAt }; also ent.grantPromotional(subject, plan, { actor, expiresAt })
await customers.endPromotional(userId, grantId, { actor })   // early; once
```

A promotional grant is its own entitlement source (gateway `promotional`): it
rolls up with subscriptions, a paid plan declared later still wins, and it
lapses exactly at its expiry with no job to run and no grace period. The
timeline shows `promotional` when granted and `expiration` when it lapses or
is ended. It is not a paid source: the Customer Center does not offer to
cancel it, and charts leave it out.

### Apple refund requests (CONSUMPTION_REQUEST)

When a customer asks Apple for a refund, Apple sends `CONSUMPTION_REQUEST`
and wants your consumption information within 12 hours, only for a customer
who consented to share it.

```ts
const customers = createCustomers(db, {
  ...,
  consumption: {
    consented: (subject) => privacy.has(subject, "apple_refund_info"), // required; no consent = no answer
    refundPreference: (ctx) => undefined,                             // optional: DECLINE | GRANT_FULL | GRANT_PRORATED
  },
})
onEvent: async (e) => {
  await customers.record(e)                                   // on the timeline as refund_request
  const r = await customers.consumptionInfo(e)
  if (r.respond) await appstoreGateway.sendConsumptionInfo(r.transactionId, r.body)
}
```

The body is Apple's v2 ConsumptionRequest, built from the customer's data:
`customerConsented: true`, `deliveryStatus` `DELIVERED` when the purchase is
on their timeline (else `UNDELIVERED_OTHER`), `consumptionPercentage` as the
share of the paid period used (0 unless delivered, left out with
`GRANT_PRORATED`), and `sampleContentProvided` when they had a free trial.
Every field has a hook to override. `respond: false` says why
(`no_consent`, `no_subject`, `not_configured`, `not_consumption_request`).

### Subscription charts

```ts
import { chartsCsv, createCharts } from "@dapplelight/signet-db/charts"

const charts = createCharts(db, {
  tables: { customerEvents, chartAudiences, offerings },        // products from every offering version
  fx: { base: "USD", rates: { INR: 0.012, EUR: 1.08 } },        // optional: totals in one currency
})
const r = await charts.metrics({ from: "2026-10-01", to: "2026-10-31", store: "appstore", country: "IN" })
// r.days[i]: activeSubscribers, activeTrials, mrr, mrrTotal, newRevenue, renewalRevenue, refunds,
//            refundCount, newSubscriptions, trialsStarted, trialConversions, churned, impressions, conversions
// r.summary: the same on the last day or summed, plus trialConversion, churnRate, paywallConversion
const a = await charts.saveAudience("India App Store", { store: "appstore", country: "IN" }, { actor })
await charts.metrics({ from, to, audience: a.id })
await charts.csv({ from, to })                                  // one row per day; or chartsCsv(r)
await customers.logImpression(userId, { offering: "default", version: 3, country: "IN" }) // paywall views
```

One GROUP BY on SQLite, D1 or Postgres buckets the timeline per subscription,
kind and UTC day; the rows are then replayed per subscription. Money stays per
currency in minor units; `mrrTotal` is set only when `fx` has a rate for
every currency in it. App Store amounts are list prices, so such results say
`approximate`. How the timeline reads: the first paid charge is new revenue
and later ones renewals; each charge covers one interval of its product
(unknown products a month) and MRR is that charge per month (a year / 12;
events without an amount use the product's display price); a refund or
expiration ends coverage that day, and coverage that ends without a renewal is
churn; a `trial` (a zero-amount or App Store FREE_TRIAL purchase) lasts the
product's free-trial `days` (else `trialDays`, 7) and converts when paid
within it; a start is a paywall conversion when the customer saw an offering
within `attributionDays` (7) before, and that offering is what the offering
filter matches. A customer's country is the latest one recorded
(`record(e, { country })` or the impression's). Ranges are at most 731 days.
signet-server's `monetisationAdminRoutes({ charts })` serves it and signet-ui's
`SubscriptionCharts` draws it.

## Web-to-app funnels

`@dapplelight/signet-db/funnels`: a hosted web checkout that sells an
offering's web products, then unlocks the purchase in the app. Tables:
`funnelTables()` (in `./columns/sqlite` and `./columns/pg`) plus
`customerEvents` from `monetisationTables()`.

### Funnels and checkout

```ts
import { createFunnels, funnelSteps } from "@dapplelight/signet-db/funnels"

const funnels = createFunnels(db, {
  tables: { ...funnelTables(), customerEvents },
  funnels: [{
    key: "spring", placement: "web", title: "Sleep better",
    questions: [{ id: "goal", title: "Your goal?", options: [{ value: "sleep", label: "Sleep" }] }],
  }],
  discounts: [{ code: "SPRING25", percentOff: 25, expiresAt: "2027-04-01", maxRedemptions: 500, plans: ["pro"] }],
  offerings, customers, entitlements,          // entitlements' billing.plans from plansFromProducts
  checkout: (input) => payments.checkout(input), // signet-payments
  track: (e) => sink.write([e]),               // any signet-server AnalyticsSink
  onPaid: async (s) => s.email && sendMail(s.email, (await redemptionLink(opts, s.id)).link),
})
createPayments({ ..., onEvent: async (e) => {
  await entitlements.applyBillingEvent(e); await customers.record(e); await funnels.applyEvent(e)
} })
```

- `page(key, { code })` is what the hosted page shows: the funnel, the
  placement's priced web products, and the URL's code priced per product.
- `start(key, { productId, answers, code, email, visitor })` checks the
  product is a priced web product of the offering and the answers fit the
  questions, prices the discount and takes one use, creates a new anonymous
  customer (`customers.anonymousId`), and asks the gateway for exactly that
  amount under the session id (`fs_<uuid>`) as idempotency key and reference.
  The client never sends a price.
- `applyEvent(e)`: a verified `payment.captured` for a funnel checkout, for
  the amount and currency priced, grants the plan to the anonymous customer
  (one interval from the capture; lifetime for `once`) through
  `entitlements.applySubscription`, puts the discount on the customer
  timeline (kind `discount`) and marks the session `paid`, once. A different
  amount is `amount_mismatch` and grants nothing. `refund.processed` ends the
  access, on whichever account it was merged into. Pass `grant` to start a
  renewing gateway subscription instead.

### URL discounts

A code arrives in the funnel URL (`/f/spring?code=SPRING25`) and is priced on
the server only: it must exist (case-insensitive), be unexpired, cover the
plan (`plans`) and the currency (`amountOff`), have uses left, and leave
something to charge. It is charged as a price override, so it works on every
gateway. `maxRedemptions` is held by one conditional UPDATE, so concurrent
checkouts never pass it; a checkout the gateway refused gives its use back.
An abandoned checkout holds its use for `discountHoldMs` (default 1 hour):
when a code looks used up, open sessions older than that are marked
`expired` and their uses freed. A payment captured after that still grants
the plan and takes a use again, so a limited code can go over by those late
payers only.

### Redemption

```ts
const r = await funnels.redeem(sessionId, userId, { orgId })
// { redeemed: true, already: false, session } | { redeemed: false, reason }
```

The session is claimed for one account with a conditional UPDATE, then
`customers.merge` moves the anonymous buyer's plan, payments and timeline to
it. Repeating it for the same account returns `already: true` and finishes a
merge a crash left half done; another account gets `already_redeemed`; of
two accounts racing, exactly one wins. A refused merge (`other_org`,
`not_member`) frees the claim. Before payment it is `not_paid`; after a
refund, `refunded`. The redemption token (signed, expiring) is
signet-server's: `funnelRoutes` checks it before calling this.

### Funnel analytics

Every step is an event named `funnel:<key>:<step>`: one per question, then
`plans`, `checkout`, `purchased`, `redeemed`, with the browser's analytics
id so the purchase joins the visit. Drop-off:
`analytics.funnel({ steps: funnelSteps(def) })`. Analytics never fails a
purchase.

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
import { approvalGate } from "@dapplelight/signet-server/mcp"

const tools = entitlementTools({
  entitlements: ent,
  flags: ff,
  subject: orgId,       // or allSubjects: true for an operator agent; tools then take `subject`
  allowWrites: true,    // default false: read tools only
  actor: { type: "agent", id: "support-agent" },
  approve: approvalGate,
})
```

Read: `get_plan`, `check_entitlement`, `usage`, `list_flags`. Write (with
`allowWrites`): `grant_feature`, `set_plan`, `set_flag`. Writes always call
`approve`; without one they change nothing and return `APPROVAL_REQUIRED`.
`approvalGate` is signet-server's one approval step: it asks in the client,
or, with `createMcpServer({ approvals })`, opens a pending approval the
person decides in the app (see signet-server's "Approvals").
They are audited as `actor`. Give writes only to agents run by staff: on a
per-user agent the person approving is the user who benefits.

## Experiments

A/B/n tests on top of feature flags. Tables: `experimentTables()` from
`/columns/sqlite` or `/columns/pg` (`experiments`, `experimentExposures`);
conversions are read from `analyticsEvents()`.

```ts
import { analyticsEvents, experimentTables } from "@dapplelight/signet-db/columns/sqlite"
import { createExperiments } from "@dapplelight/signet-db/experiments"

export const { experiments, experimentExposures } = experimentTables()
const ex = createExperiments(db, { tables: { experiments, experimentExposures }, events: analyticsEvents() })

await ex.create("onboarding-copy", {
  variants: [{ key: "control", weight: 50 }, { key: "short", weight: 50, value: { steps: 3 } }],
  goal: "signup_completed",                       // an analytics event name
  audience: { plan: ["free"] },                   // optional: a flag rule's `when`
}, { actor })
await ex.start("onboarding-copy", { actor })
await ex.expose("onboarding-copy", { id: userId }) // { variant: "short", value: { steps: 3 }, reason: "assigned", first: true }
await ex.results("onboarding-copy")
// { control: "control", variants: [{ key, exposed, converted, rate, lift, pValue, significant }] }
await ex.rollout("onboarding-copy", "short", { actor }) // everyone gets "short" from now on
```

- Assignment is sticky with no storage: the flags' `bucket` (FNV-1a of
  `salt:subjectId`) laid over the cumulative weights. Variants, weights and
  salt can change only while a draft, so a subject never switches variant.
- `assign` reads the variant; `expose` also records the first exposure
  (once per subject, only while running). Call `expose` where the person
  actually sees the variant, so the readout counts only them.
- A conversion is the subject's goal event (`userId` or `anonymousId` equal
  to the subject id) at or after their exposure. `results(key, { goal })`
  reads another event; `alpha` defaults to 0.05.
- Each variant is compared with the control (the first variant) by a
  two-sided two-proportion z-test. With many variants, lower `alpha`.
- Lifecycle: `draft` → `start` → `running` ⇄ `stop` → `rollout` →
  `rolled_out`. Draft and stopped give the control (`not_running`); outside
  the audience is the control (`not_eligible`); rolled out gives the winner.
  A wrong move is `CONFLICT`, as one conditional UPDATE.
- A variant's `value` is JSON the app reads. Pricing experiments put an
  offering key there (`{ offering: "annual-first" }`) for a placement to serve.
- signet-server's `experimentRoutes` / `experimentAdminRoutes` serve it;
  signet-ui's `ExperimentResults` is the admin readout.

## Status page and maintenance

Tables: `statusTables()` (`statusComponents`, `statusIncidents`, `maintenance`).

```ts
import { statusTables } from "@dapplelight/signet-db/columns/sqlite"
import { createStatus } from "@dapplelight/signet-db/status"

export const { statusComponents, statusIncidents, maintenance } = statusTables()
const status = createStatus(db, { tables: { statusComponents, statusIncidents, maintenance } })

await status.setComponent("api", { name: "API", position: 1 }, { actor })
const inc = await status.openIncident(
  { title: "Slow sign-in", impact: "minor", components: ["api"], message: "Looking into it" },
  { actor },
)
await status.updateIncident(inc.id, { status: "resolved", message: "Fixed" }, { actor })
await status.setMaintenance({ on: true, message: "Upgrading the database", until }, { actor })
await status.summary() // { status, components, incidents, maintenance }
```

- Component statuses (`operational`, `maintenance`, `degraded`,
  `partial_outage`, `major_outage`) are set by hand. The overall status is
  the worst of them and of open incidents' impact (`minor` degraded, `major`
  partial outage, `critical` major outage); maintenance mode shows unless
  something is worse.
- Incident updates are appended, never edited; `resolved` closes the
  incident, after which it cannot change. `summary` lists open incidents and
  those resolved in the last 7 days (`days` changes it).
- Every write is audited. `maintenance()` is what signet-server's
  `maintenanceMode` middleware reads.

## Organisations and tenant scope

```ts
import { orgTables } from "@dapplelight/signet-db/columns/sqlite" // or /columns/pg
export const { organizations, memberships, invitations, orgRoles } = orgTables()
export const projects = sqliteTable("projects", { id: id(), orgId: text("org_id").notNull(), name: text("name").notNull() })

import { createOrgs } from "@dapplelight/signet-db/orgs"
const orgs = createOrgs(db, { tables: { organizations, memberships, invitations, orgRoles } })
const org = await orgs.create({ name: "Acme", ownerId: userId })      // creator is the owner
await orgs.update(org.id, { domain: "app.acme.example", brandColor: "#12833c" }, { by: userId })
const { token } = await orgs.invite({ orgId: org.id, role: "member", invitedBy: userId, email })
await orgs.acceptInvite(token, { userId: other, email })               // { ok, membership, org } | { ok: false, reason }
await orgs.can(org.id, other, "members:invite")                        // false
await orgs.saveRole(org.id, "billing", ["billing:read"], { by: userId }) // a custom role in this org

const data = scoped(db, { orgId: org.id })            // org_id on every where and insert
const mine = scoped(db, { userId, orgId: org.id })    // both
```

- Roles map to permission sets (`DEFAULT_ORG_ROLES`: owner `*`, admin,
  member; `defineRoles` for your own). `members:*` matches every `members:`
  permission. Custom roles live per org in `orgRoles`.
- With `{ by }`, a change is checked against the actor: they need the
  permission (`ORG_PERMISSIONS`) and cannot hand out a role with
  permissions they lack. An org always keeps one owner.
- Invite tokens are 256 random bits shown once; only the SHA-256 is stored.
  They expire (`inviteTtlMs`, default 7 days), work once and can be revoked.
- `byDomain(host)` and `bySlug(slug)` resolve a tenant; signet-server's
  `tenant()` middleware uses them.
- An org scope is deny-by-default: a table without `orgId` (and without a
  `userId` the scope also fixes) throws `NOT_TENANT_TABLE`; writes that name
  another org throw `CROSS_ORG_WRITE`.
- `defineAdmin` with `ctx.orgId` shows only tables with `orgId`, limits every
  op to that org and puts creates in it; `tenant: true` requires an org.
- With an audit table, every write is logged: `org.create`, `org.update`,
  `member.add`, `member.role`, `member.remove`, `member.leave`,
  `role.create`, `role.update`, `role.delete`, `invite.create`,
  `invite.accept`, `invite.revoke`. Each entry has the actor (`by`, else the
  system), and before/after snapshots carrying `orgId`. Invite tokens and
  hashes are never logged. Without an audit table nothing is written.
- Failures are `OrgError` (a `SignetDbError` with an HTTP `status`).

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

## Analytics events

`createAnalyticsStore(db, { table: analyticsEvents(), retentionDays?, privacy? })`
stores events (it is a signet-server `AnalyticsSink`), links anonymous events
on `$identify`, keeps userIds only with consent when given `privacy`, and
answers typed questions: `count`, `uniques`, `series`, `breakdown`, `funnel`,
`retention`, `trend`, `events`. `prune()` applies the retention. Read-only
agent tools: `analyticsTools({ store })`. The full guide is in
[signet-lib's ANALYTICS.md](../lib/ANALYTICS.md#store-events-in-your-database).

## Workflows: durable runs with approval steps

**Jobs or workflows?** Use signet-server `jobs` for quick fire-and-forget
background tasks; use signet-db workflows for long-running, multi-step,
crash-safe work or work that needs a person's approval.

- Job: `await sendReceipt.enqueue({ orderId })`
- Workflow: `await wf.start(refund, { orderId })`, where `refund` calls `step.approval({ approvers: [managerId] })`

```ts
import { workflowTables } from "@dapplelight/signet-db/columns/sqlite"   // or columns/pg
import { createWorkflows, defineWorkflow } from "@dapplelight/signet-db/workflows"

export const { workflowRuns, workflowSteps, workflowEvents } = workflowTables()

const payout = defineWorkflow("payout", async (step, input: { requestId: string }) => {
  const req = await step.run("load", () => loadRequest(input.requestId))
  const ok = await step.approval({ approvers: req.approverIds, summary: `Pay ${req.amount}?`, timeout: 2 * DAY })
  if (!ok.approved) return { paid: false, by: ok.by, timedOut: ok.timedOut }
  await step.run("pay", () => psp.pay(req), { attempts: 5, backoff: (n) => n * 30_000 })
  await step.sleep("settle", HOUR)                                     // or step.sleepUntil("x", date)
  const receipt = await step.waitForEvent(`settled:${req.id}`, { timeout: DAY })
  return { paid: true, receipt }
})

const wf = createWorkflows(db, {
  tables: { workflowRuns, workflowSteps, workflowEvents },
  workflows: [payout],
  approvals,                                              // optional: signet-server's kvApprovals
  notify: (to, r) => notifier.notify(to, "workflow.approval", r), // optional
})
const run = await wf.start(payout, { requestId }, { createdBy: userId })
await wf.sendEvent(`settled:${id}`, receipt)              // wakes the waiting run
await wf.approve(run.id, "approval", userId)              // or reject(...); null once decided
await wf.cancel(run.id)
await wf.get(run.id)                                      // { run, steps } for a timeline
await wf.list({ status: "waiting" })                      // admin view
await wf.pendingApprovals(userId)                         // an approval inbox
```

Every tick calls the workflow function from the top. A finished step returns
its stored JSON result and never runs again; the first unfinished one runs, or
suspends the run until its sleep, event, approval or timeout. So step ids must
be unique and stable, and anything non-deterministic goes inside `step.run`.
A step whose process died half way runs again once the lease passes (it counts
as an attempt), so make side effects idempotent. A changed step kind under the
same id fails the run with `NONDETERMINISTIC`; a step out of attempts throws
`STEP_FAILED` into the workflow, which can catch it and compensate.

Events go to every run waiting on that name, or one run with
`{ runId }`. An event sent after the run started but before it reached the
wait is still delivered; a second wait on the same name takes the next event.

Approval steps: only a listed approver can decide (`FORBIDDEN` otherwise).
With `approvals`, each approver also gets a pending record in signet-server's
approval inbox (`approvalRoutes`), and a decision made there is picked up
within `approvalPollMs` (default 60 s). `notify` is called once per approver
when the step opens. signet-server's `workflowRoutes` mounts start, status,
events, approve/reject, cancel and the admin list over HTTP.

**Runners.** Nothing runs until something calls `tick()`. Each call claims up
to `limit` due runs with a lease (a conditional UPDATE, so concurrent runners
never hold the same run; `leaseMs`, default 5 min, must outlast your longest
step) and returns `nextWakeAt`.

| Where | How |
|---|---|
| Bun / Node | `wf.poll({ intervalMs: 1000, signal })` in the server process, or `setInterval(() => wf.tick(), 1000)` |
| Cloudflare Workers (the default path) | a cron trigger: `scheduled(_, env, ctx) { ctx.waitUntil(makeWf(env).tick({ limit: 25 })) }`. Cron fires once a minute, so sleeps and timeouts resolve to the minute; after `start` or `sendEvent` call `ctx.waitUntil(wf.tick())` to run right away |
| Durable Object alarm (optional) | call `tick()` in `alarm()` and `setAlarm(nextWakeAt)` from its result. No extra dependency; worth it only for sub-minute timing on Workers |
| Queue consumer (optional) | a message per start or event whose handler calls `tick()`. Same engine, no extra dependency |

Run as many runners as you like; they share the database and the lease.
`prune(olderThanMs)` deletes finished runs and old events (default 30 days).

## Comments, mentions, activity and version history

Record collaboration for org apps: comment threads on any record, @mentions
that notify, an activity timeline per record, and version history with diff,
restore and undo.

```ts
import { collabTables } from "@dapplelight/signet-db/columns/sqlite"   // or columns/pg
import { createCollab } from "@dapplelight/signet-db/collab"

export const { comments, recordVersions } = collabTables()
// Version history is opt-in per table: writes through scoped()/audited() snapshot tracked rows.
const db = createDb(env.DB, { audit, versions: { table: recordVersions, track: [tasks] } })

const collab = createCollab(db, {
  tables: { comments },
  records: { tasks },                         // what can be commented on, by name; each needs orgId
  orgs,                                       // createOrgs(...)
  people: (ids) => namesById(ids),            // { [id]: { name, email?, image? } }
  notify: notifyMentions(notifier),           // signet-server; or (to, m) => ...
})
const who = { orgId, userId }
const ref = { table: "tasks", id: taskId }
await collab.addComment(who, ref, { body: "Ready? @[Asha](user:u_1)" })   // mentions by id
await collab.addComment(who, ref, { body: "Yes", parentId: commentId })  // a reply
await collab.editComment(who, commentId, { body: "…" })                  // author only; edited marker
await collab.deleteComment(who, commentId)                               // soft: text cleared
await collab.comments(who, ref)                    // threads with replies
await collab.mentionable(who, "as")                // the mention picker: org members only
await collab.timeline(who, ref, { limit: 20 })     // { items: [{ summary: "Asha changed status to Done" }], nextCursor }
await collab.versions(who, ref)                    // newest first, each with its field changes
await collab.diff(who, ref, 2, 5)                  // { changes: [{ field, from, to }] }
await collab.restore(who, ref, 2)                  // writes version N+1 and a "restore" audit entry
await collab.undo(who, ref, { expected: 5 })       // 409 if the record moved on
```

- **Deny by default.** Only tables in `records` exist. A record of another
  org, or any record for someone who is not a member, is 404 (`OrgError`).
  Reading and commenting need membership; `restore` and `undo` need
  `<record>:write` (`tasks:write`; owners hold `*`). `access` replaces that
  rule. Editing is the author's; deleting is the author's or needs
  `comments:moderate`. Someone who leaves the org loses access to their own
  comments too.
- **Mentions** are written into the text as `@[Name](user:<id>)`
  (`mentionToken`, `parseMentions`), so a rename never breaks one. Only org
  members are kept and nobody is told about their own comment. `notify`
  gets `{ to, by, byName, table, rowId, commentId, excerpt, key }` once per
  person per comment: the comment remembers who was notified, so editing,
  or removing and re-adding a mention, never notifies twice.
- **Timeline** merges the audit log's entries for the record with its
  comments, newest first. Each item has structured `changes` and a
  `summary` from `describeItem` (override with `describe`). Changes come
  from writes made with `audited(...)`; encrypted fields show as changed with
  no values.
- **Versions** store the whole row after each write as stored (encrypted
  fields stay ciphertext) in `recordVersions`, numbered per record. Only
  writes through `scoped`/`audited` and `collab` itself are recorded.
  `undo` puts the version before the latest back, and refuses with 409 when
  `expected` is not the latest version or the record changed since its last
  version. Restoring a soft-deleted record's earlier version brings it back.
- Comment writes, restores and undos are audited (`comment.create`,
  `comment.edit`, `comment.delete`, `restore`, `undo`) when the db has an
  audit table.
- signet-server's `collabRoutes` mounts all of this over HTTP; signet-ui's
  `screens/collab-screens` renders it.

## AI spend caps

Per-user, per-org and global caps on AI spend, per UTC day and month, in
cost units (1 unit = one millionth of a US dollar, so spend stays an
integer). It plugs into signet-ai's extractor as its `ledger`.

```ts
import { aiSpendCaps, entitlementTables } from "@dapplelight/signet-db/columns/sqlite"
import { createAiSpend, spendKey } from "@dapplelight/signet-db/ai-spend"

export const { usageCounters } = entitlementTables()
export const spendCaps = aiSpendCaps()

const spend = createAiSpend(db, {
  tables: { usageCounters, aiSpendCaps: spendCaps },
  caps: { user: { day: 200_000 }, org: { month: 20_000_000 }, global: { month: 100_000_000 } },
})
const extractor = createExtractor({ providers, ledger: spend.ledger })
await extractor.extract({ ...args, budget: { key: spendKey({ userId, orgId }) } })
```

- The ledger checks every cap that applies before a call (refused as
  signet-ai's `AI_BUDGET_EXCEEDED`) and records the call's cost after, on
  the user's, org's and global counters. A plain string `key` is a user id.
- `streamChat`, `chat` and `ground` have no ledger: check first (signet-server's
  `requireAiSpend`, or `spend.check(subject)`) and pass `onUsage: spend.onUsage`.
  Do not give an extractor both, or spend counts twice.
- Caps an admin sets (`setCap`, or signet-server's `aiSpendAdminRoutes`) win
  over `caps`: a user's or org's own row, then the `*` row for its scope, then
  the option. `units: null` stores unlimited; `removeCap` goes back.
- `check(subject, estimateUnits?)` refuses once a cap is reached, and says
  which (`scope`, `period`, `capUnits`, `usedUnits`, `resetsAt`).
  `usage(scope, id)` and `top("user" | "org", period)` feed an admin screen.
- Fails closed: a database error refuses the call. Calls in flight are not
  reserved, so concurrent calls can overshoot by their own cost.

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
