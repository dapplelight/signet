/**
 * The schema the SQLite examples share. In an app, drizzle-kit generates the
 * CREATE TABLE statements from this file; `migrate` below stands in for it.
 */
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { auditLog, encrypted, id, money, softDelete, timestamps } from "../src/columns/sqlite"

export const orders = sqliteTable("orders", {
  id: id(),
  userId: text("user_id").notNull(),
  item: text("item").notNull(),
  ...money("total", { currency: "INR" }),
  ...timestamps(),
  ...softDelete(),
})

export const profiles = sqliteTable("profiles", {
  id: id(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  pan: encrypted("pan"),
  ...timestamps(),
})

export const audit = auditLog()

const now = "default (cast((julianday('now') - 2440587.5) * 86400000 as integer))"

export const migrate = (run: (sql: string) => unknown) => {
  run(`create table orders (id text primary key, user_id text not null, item text not null,
    total integer not null, total_currency text not null default 'INR',
    created_at integer not null ${now}, updated_at integer not null ${now}, deleted_at integer)`)
  run(`create table profiles (id text primary key, user_id text not null, name text not null,
    pan text, created_at integer not null ${now}, updated_at integer not null ${now})`)
  run(`create table audit_log (id text primary key, at integer not null ${now}, actor_type text not null,
    actor_id text not null, action text not null, table_name text not null, row_id text,
    before text, after text)`)
}
