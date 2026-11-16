/** sync: hybrid logical clock and the conflict rules, incl. a 2000-seed convergence property. */

import {
  apply,
  type Change,
  type Conflict,
  compareHlc,
  deletedButEdited,
  type Hlc,
  type Row,
  receive,
  tick,
  type Value,
} from "../src/sync"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, JSON.stringify(d)))
}
// Key order differs with arrival order; compare as values, like toEqual.
const canon = (v: unknown): unknown =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(
        Object.entries(v)
          .sort(([x], [y]) => (x < y ? -1 : 1))
          .map(([k, x]) => [k, canon(x)]),
      )
    : v
const eq = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

const GUARDED = ["amount", "date"] as const
const opts = { guarded: GUARDED }
const base = (): Row => ({
  id: "t1",
  fields: { amount: 500, date: "2026-10-01", label: "food", notes: null, done: false },
  stamps: {},
  deleted: null,
})
const h = (wall: number, node: string, n = 0): Hlc => ({ wall, n, node })
const set = (field: string, value: Value, b: Value, hlc: Hlc): Change => ({
  kind: "set",
  rowId: "t1",
  field,
  value,
  base: b,
  hlc,
})

// --- clock ---
const a = tick(null, 1000, "a")
ok("clock never goes backwards when the device clock does", compareHlc(tick(a, 900, "a"), a) > 0)
ok(
  "clock moves past a remote stamp it hears",
  compareHlc(receive(h(100, "a"), h(500, "b", 3), 200, "a"), h(500, "b", 3)) > 0,
)

// --- rules ---
{
  const r = apply(
    apply(base(), set("amount", 600, 500, h(1, "a")), opts).row,
    set("amount", 450, 500, h(2, "b")),
    opts,
  )
  ok("guarded clash: later edit shown", r.row.fields.amount === 450)
  ok(
    "guarded clash: both values kept",
    eq(r.conflict, { rowId: "t1", field: "amount", shown: 450, other: 600 }),
  )
}
ok(
  "guarded edit on an unchanged field just applies",
  eq(apply(base(), set("amount", 450, 500, h(1, "a")), opts), {
    row: { ...base(), fields: { ...base().fields, amount: 450 }, stamps: { amount: h(1, "a") } },
    conflict: null,
  }),
)
ok(
  "without options every field is last-write-wins",
  apply(apply(base(), set("amount", 600, 500, h(1, "a"))).row, set("amount", 450, 500, h(2, "b")))
    .conflict === null,
)
{
  const x = set("label", "x", "food", h(2, "a"))
  const y = set("label", "y", "food", h(1, "b"))
  ok(
    "plain field: later edit wins in either order",
    apply(apply(base(), x).row, y).row.fields.label === "x" &&
      apply(apply(base(), y).row, x).row.fields.label === "x",
  )
}
{
  const del: Change = { kind: "delete", rowId: "t1", hlc: h(1, "a") }
  const edit = set("notes", "x", null, h(2, "b"))
  ok(
    "edit after delete brings the row back to ask",
    deletedButEdited(apply(apply(base(), del).row, edit).row) &&
      deletedButEdited(apply(apply(base(), edit).row, del).row),
  )
}
{
  const c = set("amount", 450, 500, h(1, "a"))
  const once = apply(base(), c, opts).row
  ok("a retried change changes nothing", eq(apply(once, c, opts), { row: once, conflict: null }))
}

// --- property: two devices offline, random edits, any arrival order ---
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
function session(r: () => number, node: string, start: number): Change[] {
  const view = base()
  const ops: Change[] = []
  let clock: Hlc | null = null
  const usedGuarded = new Set<string>()
  const n = 1 + Math.floor(r() * 5)
  for (let i = 0; i < n; i++) {
    clock = tick(clock, start + Math.floor(r() * 50), node)
    if (r() < 0.1) {
      ops.push({ kind: "delete", rowId: "t1", hlc: clock })
      continue
    }
    const fields = ["amount", "date", "label", "notes", "done"]
    const field = fields[Math.floor(r() * fields.length)] as string
    // One guarded edit per field per device (two offline edits of one amount reach the server as one).
    if ((GUARDED as readonly string[]).includes(field)) {
      if (usedGuarded.has(field)) continue
      usedGuarded.add(field)
    }
    const value =
      field === "amount"
        ? 100 + Math.floor(r() * 900)
        : field === "date"
          ? `2026-10-0${1 + Math.floor(r() * 9)}`
          : field === "done"
            ? r() < 0.5
            : `${node}-${Math.floor(r() * 3)}`
    ops.push({
      kind: "set",
      rowId: "t1",
      field,
      value,
      base: view.fields[field] ?? null,
      hlc: clock,
    })
    view.fields[field] = value
  }
  return ops
}
function deliver(x: Change[], y: Change[], r: () => number) {
  let row = base()
  const conflicts: Conflict[] = []
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    const c = (j >= y.length || (i < x.length && r() < 0.5) ? x[i++] : y[j++]) as Change
    const out = apply(row, c, opts)
    row = out.row
    if (out.conflict) conflicts.push(out.conflict)
  }
  return { row, conflicts }
}
let bad: unknown = null
for (let seed = 1; seed <= 2000 && !bad; seed++) {
  const r = rng(seed)
  const x = session(r, "a", 1000)
  const y = session(r, "b", 1000)
  const one = deliver(x, y, rng(seed * 7))
  const two = deliver(x, y, rng(seed * 13))
  if (!eq(one.row, two.row)) bad = { seed, why: "diverged" }
  for (const c of [...x, ...y]) {
    if (c.kind !== "set" || !(GUARDED as readonly string[]).includes(c.field) || c.value === c.base)
      continue
    for (const run of [one, two]) {
      const seen =
        run.row.fields[c.field] === c.value ||
        run.conflicts.some(
          (k) => k.field === c.field && (k.other === c.value || k.shown === c.value),
        )
      if (!seen) bad = { seed, why: "guarded edit lost", field: c.field, value: c.value }
    }
  }
}
ok("2000 seeds: every order converges, no guarded edit lost", bad === null, bad)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
