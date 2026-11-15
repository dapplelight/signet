/**
 * @internal The version snapshot every tracked write takes (see
 * `DbConfig.versions`), shared by `scoped`/`audited` and `createCollab`.
 */

import { and, desc, eq, getTableName, type Table } from "drizzle-orm"
import { columnsOf, type SignetDb } from "./db.js"

// biome-ignore lint/suspicious/noExplicitAny: structural call into a Drizzle db of any dialect
type AnyOrm = any
type Rec = Record<string, unknown>

/** @internal The JS key of a table's primary key column. */
export function primaryKeyOf(table: Table): string | undefined {
  const cols = columnsOf(table)
  return Object.keys(cols).find((k) => cols[k]?.primary) ?? ("id" in cols ? "id" : undefined)
}

/** @internal Whether writes to `table` are snapshotted. */
export const isTracked = (db: SignetDb<unknown>, table: Table): boolean =>
  !!db.versions?.track.includes(table)

/** @internal The latest version number of one record, 0 when it has none. */
export async function latestVersion(
  db: SignetDb<unknown>,
  tableName: string,
  rowId: string,
): Promise<number> {
  const V = db.versions?.table as unknown as Record<string, AnyOrm>
  const [row] = await (db.orm as AnyOrm)
    .select({ version: V.version })
    .from(V)
    .where(and(eq(V.tableName, tableName), eq(V.rowId, rowId)))
    .orderBy(desc(V.version))
    .limit(1)
  return Number(row?.version ?? 0)
}

/** @internal Write the next version of each row (as stored) when `table` is tracked. */
export async function snapshot(
  db: SignetDb<unknown>,
  table: Table,
  action: string,
  rows: Rec[],
  actor: { type: string; id: string },
): Promise<number[]> {
  if (!isTracked(db, table) || rows.length === 0) return []
  const pk = primaryKeyOf(table)
  if (!pk) return []
  const tableName = getTableName(table)
  const out: number[] = []
  // ponytail: max+1 then insert; two writers racing on one record hit the
  // unique index and the second write throws. Fine for human-speed edits.
  for (const r of rows) {
    const rowId = String(r[pk])
    const version = (await latestVersion(db, tableName, rowId)) + 1
    await (db.orm as AnyOrm).insert(db.versions?.table).values({
      orgId: typeof r.orgId === "string" ? r.orgId : null,
      tableName,
      rowId,
      version,
      action,
      data: JSON.parse(JSON.stringify(r)),
      actorType: actor.type,
      actorId: actor.id,
      at: new Date(),
    })
    out.push(version)
  }
  return out
}
