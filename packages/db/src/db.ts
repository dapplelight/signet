/**
 * The database handle every signet-db helper takes: a Drizzle instance plus
 * its dialect, how it runs statements atomically, and optional cipher and
 * audit table.
 *
 * The driver entry points (`./d1`, `./sqlite`, `./postgres`) build one with
 * `createDb`. Any other Drizzle driver works through `fromDrizzle`.
 */

import { type Column, getTableColumns, type Table } from "drizzle-orm"
import { assertCiphertext, type Cipher } from "./cipher.js"

export type Dialect = "sqlite" | "pg"

/**
 * How the driver makes a group of statements atomic:
 * - `transaction`: async interactive transactions (postgres-js, node-postgres, PGlite, libsql).
 * - `sync-transaction`: synchronous transactions (bun:sqlite, better-sqlite3).
 * - `batch`: a single batch call (Cloudflare D1, which has no BEGIN).
 */
export type Atomicity = "transaction" | "sync-transaction" | "batch"

export type DbConfig = {
  /** Encrypts and decrypts `encrypted()` columns in signet-db reads and writes. */
  cipher?: Cipher
  /** The `auditLog()` table. Turns on `audited()` and the `deleteUser` audit entry. */
  audit?: Table
}

export type SignetDb<TOrm = unknown> = {
  /** The Drizzle instance, for any query signet-db does not wrap. */
  readonly orm: TOrm
  readonly dialect: Dialect
  readonly cipher?: Cipher
  readonly audit?: Table
  /** Run statements atomically. Each is built on the handle it is given. */
  batch(statements: ReadonlyArray<(tx: TOrm) => unknown>): Promise<unknown[]>
}

// Drizzle's per-dialect database classes share these method names but no
// common type, so the batch runners call them structurally.
// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any

export function fromDrizzle<TOrm>(
  orm: TOrm,
  options: { dialect: Dialect; atomicity: Atomicity } & DbConfig,
): SignetDb<TOrm> {
  const { dialect, atomicity, cipher, audit } = options
  const o = orm as AnyOrm
  const batch = async (statements: ReadonlyArray<(tx: TOrm) => unknown>): Promise<unknown[]> => {
    if (statements.length === 0) return []
    if (atomicity === "batch") return o.batch(statements.map((s) => s(orm)))
    if (atomicity === "sync-transaction") {
      return o.transaction((tx: AnyOrm) => statements.map((s) => (s(tx) as AnyOrm).all()))
    }
    return o.transaction(async (tx: TOrm) => {
      const out: unknown[] = []
      for (const s of statements) out.push(await s(tx))
      return out
    })
  }
  return { orm, dialect, cipher, audit, batch }
}

/** @internal Columns keyed by their JS property name. */
export const columnsOf = (table: Table): Record<string, Column> =>
  getTableColumns(table) as Record<string, Column>

/** @internal Whether a column was made by `encrypted()`. */
export const isEncrypted = (col: Column): boolean =>
  (col as unknown as { mapTo?: unknown }).mapTo === assertCiphertext

/** @internal JS keys of a table's `encrypted()` columns. */
export const encryptedKeys = (table: Table): string[] =>
  Object.entries(columnsOf(table))
    .filter(([, c]) => isEncrypted(c))
    .map(([k]) => k)
