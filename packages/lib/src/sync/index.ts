/**
 * Conflict rules for local-first sync: devices edit offline, the server (and any
 * device previewing the result) applies their changes in whatever order they
 * arrive, and everyone ends with the same row.
 *
 * - Plain fields: per-field merge; a clash on one field goes to the later edit
 *   by a hybrid logical clock (never device wall clocks alone).
 * - Guarded fields (`options.guarded`, e.g. an amount or a date): never picked
 *   automatically. Every edit is kept on the row; edits that did not see each
 *   other's value (`base`) come back as a `Conflict` (`conflictOf`) for a person,
 *   whose pick is a `set` with `resolve` listing the values the person saw.
 * - Delete vs edit: an edit after a delete brings the row back flagged
 *   (`deletedButEdited`), never silently lost or revived.
 *
 * Pure: no storage, no network. `apply` is order-independent and idempotent.
 */

/** Hybrid logical clock: wall time, a counter for same-millisecond events, the device id as tiebreak. */
export type Hlc = { wall: number; n: number; node: string }

export function compareHlc(a: Hlc, b: Hlc): number {
  return a.wall - b.wall || a.n - b.n || (a.node < b.node ? -1 : a.node > b.node ? 1 : 0)
}

/** The next stamp for a local event: never behind anything this device has seen. */
export function tick(last: Hlc | null, now: number, node: string): Hlc {
  if (!last || now > last.wall) return { wall: now, n: 0, node }
  return { wall: last.wall, n: last.n + 1, node }
}

/** After hearing `remote`, the local clock moves past it (keeps later local edits later). */
export function receive(last: Hlc | null, remote: Hlc, now: number, node: string): Hlc {
  const top = !last || compareHlc(remote, last) > 0 ? remote : last
  return now > top.wall ? { wall: now, n: 0, node } : { wall: top.wall, n: top.n + 1, node }
}

export type Value = string | number | boolean | null

/** One edit of a guarded field, kept on the row so conflicts are worked out from the whole set. */
export type GuardedEdit = { value: Value; base: Value; hlc: Hlc; resolve?: Value[] }

export type Row = {
  id: string
  fields: Record<string, Value>
  /** When each field was last set. */
  stamps: Record<string, Hlc>
  deleted: Hlc | null
  /** Every edit seen of each guarded field, oldest first; this is what makes retries and any arrival order safe. */
  edits?: Record<string, GuardedEdit[]>
}

/**
 * A guarded-field clash. `shown` is the later edit, so every device and the
 * server show the same thing whatever order changes arrive in; `others` are the
 * competing values (latest first) nobody has settled. Nothing is decided until
 * a person picks (a `set` with `resolve`).
 */
export type Conflict = { rowId: string; field: string; shown: Value; others: Value[] }

export type Change =
  | {
      kind: "set"
      rowId: string
      field: string
      value: Value
      /** What the editor saw in the field when they made this edit. */
      base: Value
      hlc: Hlc
      /**
       * A person's pick on a conflict: the values they saw (`shown` and `others`).
       * Settles earlier edits of those values only; an older edit of any other
       * value was never seen, so it stays in the conflict.
       */
      resolve?: Value[]
    }
  | { kind: "delete"; rowId: string; hlc: Hlc }

export type ApplyOptions = {
  /** Fields a person must reconcile instead of last-write-wins. */
  guarded?: readonly string[]
}

/** "Deleted by one person, edited by another after that": the row comes back to ask keep or delete. */
export function deletedButEdited(row: Row): boolean {
  const d = row.deleted
  return !!d && Object.values(row.stamps).some((s) => compareHlc(s, d) > 0)
}

/**
 * The open conflict on a guarded field, worked out from the edits on the row, so
 * it is the same whatever order they arrived in. An edit is settled once a later
 * edit either saw its value (`base` equals it) or is a person's `resolve` that
 * listed that value. The
 * edits still standing with different values are the clash.
 */
export function conflictOf(row: Row, field: string): Conflict | null {
  const edits = row.edits?.[field] ?? []
  const win = edits.at(-1)
  if (!win) return null
  const standing = edits.filter(
    (e) =>
      !edits.some(
        (l) => compareHlc(l.hlc, e.hlc) > 0 && (l.resolve?.includes(e.value) || l.base === e.value),
      ),
  )
  const others: Value[] = []
  for (const e of standing.reverse())
    if (e.value !== win.value && !others.includes(e.value)) others.push(e.value)
  return others.length ? { rowId: row.id, field, shown: win.value, others } : null
}

/**
 * Apply one change to a row. Any arrival order ends in the same row and the same
 * conflicts (`conflictOf`); a change already applied, however late it is
 * redelivered, changes nothing. `conflict` is the field's open conflict after a
 * guarded edit, null for a retry or a plain field.
 * ponytail: every guarded edit stays on the row; compact settled ones if rows grow large.
 */
export function apply(
  row: Row,
  c: Change,
  options: ApplyOptions = {},
): { row: Row; conflict: Conflict | null } {
  if (c.kind === "delete") {
    if (row.deleted && compareHlc(row.deleted, c.hlc) >= 0) return { row, conflict: null }
    return { row: { ...row, deleted: c.hlc }, conflict: null }
  }
  if (options.guarded?.includes(c.field)) {
    const log = row.edits?.[c.field] ?? []
    if (log.some((e) => compareHlc(e.hlc, c.hlc) === 0)) return { row, conflict: null }
    const edits = [...log, { value: c.value, base: c.base, hlc: c.hlc, resolve: c.resolve }].sort(
      (x, y) => compareHlc(x.hlc, y.hlc),
    )
    const win = edits[edits.length - 1] as GuardedEdit
    const next: Row = {
      ...row,
      fields: { ...row.fields, [c.field]: win.value },
      stamps: { ...row.stamps, [c.field]: win.hlc },
      edits: { ...row.edits, [c.field]: edits },
    }
    return { row: next, conflict: conflictOf(next, c.field) }
  }
  const stamp = row.stamps[c.field]
  // Same or older stamp: a retry, or an edit that lost.
  if (stamp && compareHlc(c.hlc, stamp) <= 0) return { row, conflict: null }
  return {
    row: {
      ...row,
      fields: { ...row.fields, [c.field]: c.value },
      stamps: { ...row.stamps, [c.field]: c.hlc },
    },
    conflict: null,
  }
}
