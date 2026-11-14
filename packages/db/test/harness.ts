/**
 * The backends every cross-database test runs against, and one schema
 * written twice (SQLite and Postgres) with the same JS shape.
 *
 * - bun:sqlite in memory: always.
 * - D1: drizzle's real D1 driver over a small D1Database stand-in on
 *   bun:sqlite (prepare/bind/all/run/raw/batch). Always.
 * - Postgres via PGlite (Postgres compiled to WASM, in process): always.
 * - A real Postgres server: only when SIGNET_TEST_PG_URL is set.
 */
import { Database } from "bun:sqlite"
import { PGlite } from "@electric-sql/pglite"
import { type Column, getTableColumns, getTableName, is, SQL, type Table } from "drizzle-orm"
import { drizzle as drizzleD1 } from "drizzle-orm/d1"
import { PgDialect, PgTable, pgTable, text as pgText } from "drizzle-orm/pg-core"
import { drizzle as drizzlePglite } from "drizzle-orm/pglite"
import { SQLiteSyncDialect, sqliteTable, text } from "drizzle-orm/sqlite-core"
import postgres from "postgres"
import type { Cipher } from "../src/cipher"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { type DbConfig, fromDrizzle, type SignetDb } from "../src/db"
import { createDb as createPg } from "../src/postgres"
import { createDb as createSqlite } from "../src/sqlite"

export function sqliteSchema() {
  const notes = sqliteTable("notes", {
    id: sqc.id(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    secret: sqc.encrypted("secret"),
    ...sqc.money("price", { currency: "INR" }),
    ...sqc.timestamps(),
    ...sqc.softDelete(),
  })
  const tags = sqliteTable("tags", {
    id: sqc.id(),
    userId: text("user_id").notNull(),
    label: text("label").notNull(),
  })
  const users = sqliteTable("users", {
    id: sqc.id(),
    name: text("name").notNull(),
    phone: text("phone"),
    pinCode: text("pin_code"),
  })
  return { notes, tags, users, audit: sqc.auditLog() }
}

export function pgSchema() {
  const notes = pgTable("notes", {
    id: pgc.id(),
    userId: pgText("user_id").notNull(),
    title: pgText("title").notNull(),
    secret: pgc.encrypted("secret"),
    ...pgc.money("price", { currency: "INR" }),
    ...pgc.timestamps(),
    ...pgc.softDelete(),
  })
  const tags = pgTable("tags", {
    id: pgc.id(),
    userId: pgText("user_id").notNull(),
    label: pgText("label").notNull(),
  })
  const users = pgTable("users", {
    id: pgc.id(),
    name: pgText("name").notNull(),
    phone: pgText("phone"),
    pinCode: pgText("pin_code"),
  })
  return { notes, tags, users, audit: pgc.auditLog() }
}

export type Schema = ReturnType<typeof sqliteSchema>

/** CREATE TABLE from a Drizzle table, standing in for drizzle-kit. */
export function ddl(table: Table): string {
  const dialect = is(table, PgTable) ? new PgDialect() : new SQLiteSyncDialect()
  const def = (c: Column) =>
    c.default === undefined
      ? ""
      : is(c.default, SQL)
        ? ` default ${dialect.sqlToQuery(c.default).sql}`
        : ` default '${String(c.default)}'`
  const cols = Object.values(getTableColumns(table) as Record<string, Column>).map(
    (c) =>
      `"${c.name}" ${c.getSQLType()}${c.primary ? " primary key" : ""}${c.notNull && !c.primary ? " not null" : ""}${def(c)}`,
  )
  return `create table "${getTableName(table)}" (${cols.join(", ")})`
}

/** A Cloudflare D1Database stand-in on bun:sqlite, enough for drizzle-orm/d1. */
export function fakeD1(sqlite: Database) {
  const statement = (sql: string, params: unknown[] = []) => {
    const q = () => sqlite.query(sql)
    const p = params as never[]
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      all: async () => ({ results: q().all(...p), success: true, meta: {} }),
      run: async () => {
        const r = q().run(...p)
        return { results: [], success: true, meta: { changes: r.changes } }
      },
      raw: async () => q().values(...p),
      first: async () => q().get(...p),
      exec: () => ({ results: q().all(...p), success: true, meta: {} }),
    }
  }
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: ReturnType<typeof statement>[]) =>
      sqlite.transaction(() => stmts.map((s) => s.exec()))(),
    exec: async (sql: string) => sqlite.run(sql),
  }
}

export type Instance = {
  db: SignetDb<any>
  S: Schema
  exec(sql: string): Promise<unknown>
  close(): Promise<void>
}

export type Backend = { name: string; make(options: Options): Promise<Instance> }

async function setup(i: Instance): Promise<Instance> {
  for (const t of Object.values(i.S)) await i.exec(ddl(t))
  return i
}

export type Options = { cipher?: Cipher; audit?: boolean }

const withAudit = (o: Options, S: Schema): DbConfig => ({
  cipher: o.cipher,
  audit: o.audit ? S.audit : undefined,
})

export const backends: Backend[] = [
  {
    name: "bun:sqlite",
    async make(options) {
      const S = sqliteSchema()
      const sqlite = new Database(":memory:")
      const db = createSqlite(sqlite, withAudit(options, S))
      return setup({ db, S, exec: async (s) => sqlite.run(s), close: async () => sqlite.close() })
    },
  },
  {
    name: "d1 (stand-in)",
    async make(options) {
      const S = sqliteSchema()
      const sqlite = new Database(":memory:")
      const orm = drizzleD1(fakeD1(sqlite) as never)
      const db = fromDrizzle(orm, {
        dialect: "sqlite",
        atomicity: "batch",
        ...withAudit(options, S),
      })
      return setup({ db, S, exec: async (s) => sqlite.run(s), close: async () => sqlite.close() })
    },
  },
  {
    name: "postgres (pglite)",
    async make(options) {
      const S = pgSchema() as unknown as Schema
      const pg = new PGlite()
      const db = fromDrizzle(drizzlePglite(pg), {
        dialect: "pg",
        atomicity: "transaction",
        ...withAudit(options, S),
      })
      return setup({ db, S, exec: (s) => pg.exec(s), close: () => pg.close() })
    },
  },
]

const PG_URL = process.env.SIGNET_TEST_PG_URL
if (PG_URL) {
  backends.push({
    name: "postgres (SIGNET_TEST_PG_URL)",
    async make(options) {
      const S = pgSchema() as unknown as Schema
      const client = postgres(PG_URL, { onnotice: () => {} })
      const db = createPg(client, withAudit(options, S))
      const exec = (s: string) => client.unsafe(s)
      for (const t of Object.values(S)) await exec(`drop table if exists "${getTableName(t)}"`)
      return setup({ db, S, exec, close: () => client.end() })
    },
  })
} else {
  console.log(
    "signet-db: SIGNET_TEST_PG_URL not set; real Postgres server tests skipped (PGlite still runs)",
  )
}
