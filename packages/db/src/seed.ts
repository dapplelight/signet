/**
 * `seed(table, n)`: realistic fake rows for a table, inferred from its column
 * types and names, deterministic for a given seed.
 *
 * Column names steer the values: names, emails, `+91` mobile numbers, 6-digit
 * PIN codes, Indian cities and states, amounts in minor units, currencies.
 * Columns with a default (ids, timestamps) are left out so the database or
 * Drizzle fills them. Encrypted columns get plaintext; write the rows through
 * `scoped()`/`audited()` so they are encrypted.
 */

import type { Column, InferInsertModel, Table } from "drizzle-orm"
import { columnsOf, isEncrypted } from "./db.js"

const FIRST = [
  "Aarav",
  "Ananya",
  "Vivaan",
  "Diya",
  "Aditya",
  "Saanvi",
  "Ishaan",
  "Kavya",
  "Arjun",
  "Meera",
  "Rohan",
  "Priya",
  "Karthik",
  "Lakshmi",
  "Farhan",
  "Zoya",
  "Harpreet",
  "Nikhil",
  "Sneha",
  "Tanvi",
]
const LAST = [
  "Sharma",
  "Iyer",
  "Reddy",
  "Nair",
  "Patel",
  "Gupta",
  "Khan",
  "Singh",
  "Das",
  "Menon",
  "Mukherjee",
  "Joshi",
  "Kulkarni",
  "Bose",
  "Pillai",
  "Chopra",
  "Rao",
  "Banerjee",
]
const CITIES = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Chennai",
  "Kolkata",
  "Hyderabad",
  "Pune",
  "Ahmedabad",
  "Jaipur",
  "Kochi",
  "Lucknow",
  "Indore",
]
const STATES = [
  "Maharashtra",
  "Delhi",
  "Karnataka",
  "Tamil Nadu",
  "West Bengal",
  "Telangana",
  "Gujarat",
  "Rajasthan",
  "Kerala",
  "Uttar Pradesh",
  "Madhya Pradesh",
  "Punjab",
]
const STREETS = [
  "MG Road",
  "Station Road",
  "Park Street",
  "Lake View",
  "Gandhi Nagar",
  "Nehru Marg",
]
const WORDS = [
  "quick",
  "monthly",
  "groceries",
  "rent",
  "notes",
  "review",
  "plan",
  "trip",
  "invoice",
  "call",
  "follow",
  "up",
  "weekend",
  "project",
  "draft",
  "order",
  "gift",
  "repair",
  "class",
  "visit",
]
const ID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** mulberry32: small, fast, deterministic. Not for secrets. */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T
  return { next, int, pick }
}

type Rng = ReturnType<typeof rng>
type Person = { first: string; last: string }

function stringFor(key: string, col: Column, r: Rng, p: Person, i: number): string {
  const k = key.toLowerCase()
  if (col.enumValues?.length) return r.pick(col.enumValues)
  if (k.endsWith("currency")) return "INR"
  if (/first_?name/.test(k)) return p.first
  if (/last_?name|surname/.test(k)) return p.last
  if (k.endsWith("name")) return `${p.first} ${p.last}`
  if (k.includes("email")) return `${p.first}.${p.last}${i + 1}@example.com`.toLowerCase()
  if (/phone|mobile/.test(k))
    return `+91${r.int(6, 9)}${String(r.int(0, 999999999)).padStart(9, "0")}`
  if (/pin|postal|zip/.test(k)) return String(r.int(110001, 855999))
  if (k.includes("city")) return r.pick(CITIES)
  if (k.includes("state")) return r.pick(STATES)
  if (k.includes("address")) return `${r.int(1, 250)}, ${r.pick(STREETS)}, ${r.pick(CITIES)}`
  if (/url|website/.test(k)) return `https://example.com/${r.pick(WORDS)}/${i + 1}`
  if (col.columnType === "PgUUID") {
    const h = () => r.int(0, 0xffff).toString(16).padStart(4, "0")
    return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`
  }
  if (k === "id" || k.endsWith("id"))
    return Array.from({ length: 26 }, () => r.pick([...ID_CHARS])).join("")
  const n = r.int(2, 4)
  const words = Array.from({ length: n }, () => r.pick(WORDS)).join(" ")
  return words[0]?.toUpperCase() + words.slice(1)
}

function numberFor(key: string, col: Column, r: Rng): number {
  const k = key.toLowerCase()
  if (/real|double|numeric|decimal/i.test(col.columnType)) return r.int(0, 100000) / 100
  if (/amount|price|total|balance|cost|fee/.test(k)) return r.int(100, 500000)
  if (k.includes("age")) return r.int(18, 80)
  if (/qty|quantity|count/.test(k)) return r.int(1, 10)
  return r.int(0, 1000)
}

const START = Date.UTC(2024, 0, 1)
const SPAN = Date.UTC(2026, 0, 1) - START

/**
 * `n` fake rows for `table`. `overrides` is merged into every row, or called
 * with the row index. The same `seed` always gives the same rows.
 */
export function seed<T extends Table>(
  table: T,
  n: number,
  overrides?: Partial<InferInsertModel<T>> | ((i: number) => Partial<InferInsertModel<T>>),
  options: { seed?: number } = {},
): InferInsertModel<T>[] {
  const r = rng(options.seed ?? 1)
  const cols = columnsOf(table)
  return Array.from({ length: n }, (_, i) => {
    const p = { first: r.pick(FIRST), last: r.pick(LAST) }
    const row: Record<string, unknown> = {}
    for (const [key, col] of Object.entries(cols)) {
      if (col.hasDefault || col.generated || key === "deletedAt") continue
      const type = isEncrypted(col) ? "string" : col.dataType
      if (type === "string") row[key] = stringFor(key, col, r, p, i)
      else if (type === "number") row[key] = numberFor(key, col, r)
      else if (type === "bigint") row[key] = BigInt(numberFor(key, col, r))
      else if (type === "boolean") row[key] = r.next() < 0.5
      else if (type === "date") row[key] = new Date(START + Math.floor(r.next() * SPAN))
      else if (type === "json") row[key] = {}
      else if (!col.notNull) row[key] = null
    }
    const extra = typeof overrides === "function" ? overrides(i) : overrides
    return { ...row, ...extra } as InferInsertModel<T>
  })
}
