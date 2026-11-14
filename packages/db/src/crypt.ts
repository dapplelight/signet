/**
 * Internal: encrypt values before a write and decrypt rows after a read, for
 * a table's `encrypted()` columns.
 */

import { decryptFields } from "@dapplelight/signet-lib/crypto"
import { getTableName, type Table } from "drizzle-orm"
import { encryptedKeys, type SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"

function cipherFor(db: SignetDb<unknown>, table: Table) {
  if (!db.cipher) {
    throw new SignetDbError(
      "NO_CIPHER",
      `${getTableName(table)} has encrypted() columns but the db has no cipher. Pass createDb(..., { cipher: createCipher({ keys, current }) }).`,
    )
  }
  return db.cipher
}

export async function encryptValues<V extends Record<string, unknown>>(
  db: SignetDb<unknown>,
  table: Table,
  values: V,
): Promise<V> {
  const keys = encryptedKeys(table).filter((k) => values[k] != null)
  if (keys.length === 0) return values
  const cipher = cipherFor(db, table)
  const out: Record<string, unknown> = { ...values }
  for (const k of keys) {
    const v = out[k]
    if (typeof v !== "string")
      throw new SignetDbError(
        "BAD_VALUE",
        `${getTableName(table)}.${k} is encrypted() and takes a string; got ${typeof v}.`,
      )
    out[k] = await cipher.encrypt(v)
  }
  return out as V
}

/** Fails closed: a field that does not decrypt comes back as null. */
export async function decryptRows<R>(db: SignetDb<unknown>, table: Table, rows: R[]): Promise<R[]> {
  const keys = encryptedKeys(table)
  if (keys.length === 0 || rows.length === 0) return rows
  const cipher = cipherFor(db, table)
  const { data, undecrypted } = await decryptFields(rows, keys, {
    decrypt: (v) => cipher.decrypt(v),
  })
  if (undecrypted.length) cipher.onUndecrypted?.({ table: getTableName(table), paths: undecrypted })
  return data
}
