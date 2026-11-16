/**
 * Conflict rules for local-first sync: devices edit offline, the server (and any
 * device previewing the result) applies their changes in whatever order they
 * arrive, and everyone ends with the same row.
 *
 * - Plain fields: per-field merge; a clash on one field goes to the later edit
 *   by a hybrid logical clock (never device wall clocks alone).
 * - Guarded fields (`options.guarded`, e.g. an amount or a date): never picked
 *   automatically. An edit applies only if the field still holds the value the
 *   editor saw; otherwise both values come back as a `Conflict` for a person.
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

export type Row = {
  id: string
  fields: Record<string, Value>
  /** When each field was last set. */
  stamps: Record<string, Hlc>
  deleted: Hlc | null
}

/**
 * A guarded-field clash: both values. `shown` is the later edit, so every
 * device and the server show the same thing whatever order changes arrive in;
 * nothing is decided until a person picks.
 */
export type Conflict = { rowId: string; field: string; shown: Value; other: Value }

export type Change =
  | { kind: "set"; rowId: string; field: string; value: Value; base: Value; hlc: Hlc }
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

/** Apply one change to a row. Any arrival order ends in the same row and the same conflicts; a retry changes nothing. */
export function apply(
  row: Row,
  c: Change,
  options: ApplyOptions = {},
): { row: Row; conflict: Conflict | null } {
  if (c.kind === "delete") {
    if (row.deleted && compareHlc(row.deleted, c.hlc) >= 0) return { row, conflict: null }
    return { row: { ...row, deleted: c.hlc }, conflict: null }
  }
  const stamp = row.stamps[c.field]
  const current = row.fields[c.field] ?? null
  const later = !stamp || compareHlc(c.hlc, stamp) > 0
  const set = (r: Row): Row => ({
    ...r,
    fields: { ...r.fields, [c.field]: c.value },
    stamps: { ...r.stamps, [c.field]: c.hlc },
  })
  // Same stamp: a retry.
  if (stamp && compareHlc(c.hlc, stamp) === 0) return { row, conflict: null }
  // Guarded: a clash when the field moved since the editor looked, or when this
  // edit is older than what is there (it would otherwise vanish). Keep both.
  if (options.guarded?.includes(c.field) && current !== c.value && (current !== c.base || !later)) {
    const conflict = (shown: Value, other: Value): Conflict => ({
      rowId: row.id,
      field: c.field,
      shown,
      other,
    })
    return later
      ? { row: set(row), conflict: conflict(c.value, current) }
      : { row, conflict: conflict(current, c.value) }
  }
  return { row: later ? set(row) : row, conflict: null }
}
