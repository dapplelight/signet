/**
 * Postgres on Supabase (or any Postgres). Pass the connection string:
 *
 *   bun examples/postgres.ts "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres"
 *
 * Supabase's transaction pooler (port 6543) does not support prepared
 * statements, hence `prepare: false`. Tables come from drizzle-kit migrations;
 * this example creates its one table if missing.
 */
import { pgTable, text } from "drizzle-orm/pg-core"
import postgres from "postgres"
import { scoped } from "../src"
import { id, money, softDelete, timestamps } from "../src/columns/pg"
import { createDb } from "../src/postgres"

const invoices = pgTable("signet_example_invoices", {
  id: id(),
  userId: text("user_id").notNull(),
  customer: text("customer").notNull(),
  ...money("amount", { currency: "INR" }),
  ...timestamps(),
  ...softDelete(),
})

const url = process.argv[2]
if (!url) throw new Error("pass a Postgres connection string as the first argument")
const client = postgres(url, { prepare: false })
await client`create table if not exists signet_example_invoices (
  id text primary key, user_id text not null, customer text not null,
  amount bigint not null, amount_currency text not null default 'INR',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz)`

const db = createDb(client)
const me = scoped(db, { userId: "user-1" })
await me.insert(invoices, { customer: "Example Traders", amount: 250000 })
console.log(await me.select(invoices, undefined, { limit: 5 }))
await client.end()
