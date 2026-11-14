/**
 * Zod schemas generated from a table's columns: `toZod(table, { mode })` for
 * validating request bodies (e.g. with signet-server's `parseBody`) and rows.
 *
 * - `insert`: what a client may send to create a row. Leaves out the primary
 *   key when it has a default, `createdAt`, `updatedAt`, `deletedAt` and
 *   `userId` (scoped() sets it), so they are stripped if sent. Columns with a
 *   default or that allow null are optional.
 * - `update`: the insert schema with every field optional.
 * - `select`: a full row as read through signet-db (encrypted fields as
 *   plaintext or null).
 *
 * Dates accept ISO strings and epoch milliseconds (JSON has no Date). Money
 * amounts must be safe integers of minor units and currency codes three
 * capital letters. Encrypted columns take plaintext strings.
 */

import type { Column, InferInsertModel, InferSelectModel, Table } from "drizzle-orm"
import { z } from "zod"
import { columnsOf, isEncrypted } from "./db.js"

export type ZodMode = "insert" | "update" | "select"

/** Keys `insert` and `update` leave out unless `keep` lists them. */
export const MANAGED_KEYS = ["id", "createdAt", "updatedAt", "deletedAt", "userId"] as const
type Managed = (typeof MANAGED_KEYS)[number]

/** `id` is managed only when it has a default, i.e. is optional on insert. */
type OptionalId<T extends Table> = "id" extends keyof InferInsertModel<T>
  ? Record<never, never> extends Pick<InferInsertModel<T>, "id">
    ? "id"
    : never
  : never
type InsertOut<T extends Table, K extends string> = Omit<
  InferInsertModel<T>,
  Exclude<Exclude<Managed, "id"> | OptionalId<T>, K>
>

export type ZodOutput<
  T extends Table,
  M extends ZodMode,
  K extends string = never,
> = M extends "select"
  ? InferSelectModel<T>
  : M extends "update"
    ? Partial<InsertOut<T, K>>
    : InsertOut<T, K>

function base(key: string, col: Column, cols: Record<string, Column>, coerce: boolean): z.ZodType {
  if (isEncrypted(col)) return z.string()
  if (col.enumValues?.length) return z.enum(col.enumValues as [string, ...string[]])
  if (key.endsWith("Currency") && key.slice(0, -8) in cols) {
    return z.string().regex(/^[A-Z]{3}$/, "an ISO 4217 code like INR")
  }
  switch (col.dataType) {
    case "string":
      return z.string()
    case "number":
      return /real|double|numeric|decimal/i.test(col.columnType)
        ? z.number()
        : z.number().int().safe()
    case "bigint":
      return coerce ? z.coerce.bigint() : z.bigint()
    case "boolean":
      return z.boolean()
    case "date":
      return coerce ? z.coerce.date() : z.date()
    case "json":
      return z.unknown()
    default:
      return z.unknown()
  }
}

/** A Zod object schema for `table` in the given mode. Unknown keys are stripped. */
export function toZod<T extends Table, M extends ZodMode, K extends Managed = never>(
  table: T,
  options: { mode: M; keep?: readonly K[] },
): z.ZodType<ZodOutput<T, M, K>> {
  const { mode, keep = [] } = options
  const cols = columnsOf(table)
  const shape: Record<string, z.ZodType> = {}
  for (const [key, col] of Object.entries(cols)) {
    const managed = (MANAGED_KEYS as readonly string[]).includes(key) && !keep.includes(key as K)
    if (mode !== "select" && managed && (key !== "id" || col.hasDefault)) continue
    let s = base(key, col, cols, mode !== "select")
    if (!col.notNull) s = s.nullable()
    if (mode === "update" || (mode === "insert" && (!col.notNull || col.hasDefault)))
      s = s.optional()
    shape[key] = s
  }
  return z.object(shape) as unknown as z.ZodType<ZodOutput<T, M, K>>
}
