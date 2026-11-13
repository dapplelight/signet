import { describe, expect, it } from "bun:test"
import {
  type AmountRange,
  amounts,
  type Command,
  commands,
  type DateRange,
  dates,
  people,
} from "../../src/search/readers"

const now = new Date(2026, 10, 12, 10, 0) // Thursday 12 Nov 2026
const ctx = { now }
const pad = (s: string) => ` ${s} `
const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

describe("dates", () => {
  const r = dates()
  const cases: [string, string, string, string][] = [
    ["today", "Today", "2026-11-12", "2026-11-12"],
    ["aaj", "Today", "2026-11-12", "2026-11-12"],
    ["yesterday", "Yesterday", "2026-11-11", "2026-11-11"],
    ["kal", "Yesterday", "2026-11-11", "2026-11-11"],
    ["this week", "This week", "2026-11-9", "2026-11-12"],
    ["last week", "Last week", "2026-11-2", "2026-11-8"],
    ["pichle hafte", "Last week", "2026-11-2", "2026-11-8"],
    ["this month", "November", "2026-11-1", "2026-11-30"],
    ["is mahine", "November", "2026-11-1", "2026-11-30"],
    ["last month", "October", "2026-10-1", "2026-10-31"],
    ["pichle mahine", "October", "2026-10-1", "2026-10-31"],
    ["last 30 days", "Last 30 days", "2026-10-14", "2026-11-12"],
    ["pichle 7 din", "Last 7 days", "2026-11-6", "2026-11-12"],
    ["this year", "2026", "2026-1-1", "2026-11-12"],
    ["last year", "2025", "2025-1-1", "2025-12-31"],
    ["march", "March", "2026-3-1", "2026-3-31"],
    ["oct", "October", "2026-10-1", "2026-10-31"],
    ["sept", "September", "2026-9-1", "2026-9-30"],
    ["december", "December 2025", "2025-12-1", "2025-12-31"],
    ["mar 2025", "March 2025", "2025-3-1", "2025-3-31"],
  ]
  for (const [q, label, from, to] of cases)
    it(`"${q}" -> ${label}`, () => {
      const out = r.read(pad(q), ctx)
      const v = out.chips[0]?.value as DateRange
      expect(out.chips[0]?.label).toBe(label)
      expect(ymd(v.from)).toBe(from)
      expect(ymd(v.to)).toBe(to)
      expect(out.s.trim()).toBe("")
    })
  it("keeps the other words", () =>
    expect(r.read(pad("swiggy last month"), ctx).s.trim()).toBe("swiggy"))
  it("marathon is not March, maybe is not May", () => {
    expect(r.read(pad("marathon"), ctx).chips).toEqual([])
    expect(r.read(pad("maybe"), ctx).chips).toEqual([])
  })
})

describe("amounts", () => {
  const r = amounts()
  const cases: [string, AmountRange][] = [
    ["500", { exact: 500 }],
    ["₹1,200", { exact: 1200 }],
    ["3k", { exact: 3000 }],
    ["1.2L", { exact: 120000 }],
    ["2 lakh", { exact: 200000 }],
    ["1.5cr", { exact: 15000000 }],
    ["over 5k", { min: 5000 }],
    [">500", { min: 500 }],
    ["500 se zyada", { min: 500 }],
    ["under 100", { max: 100 }],
    ["below 2k", { max: 2000 }],
    ["500-1000", { min: 500, max: 1000 }],
    ["500 to 1k", { min: 500, max: 1000 }],
  ]
  for (const [q, v] of cases.map(([q, v]) => [q.toLowerCase(), v] as const))
    it(`"${q}"`, () => expect(r.read(pad(q), ctx).chips[0]?.value).toEqual(v))
  it("a number inside other words is not an amount", () =>
    expect(r.read(pad("goa 2027"), ctx).chips).toEqual([]))
  it("labels with the app's format", () =>
    expect(amounts((n) => `₹${n}`).read(pad("over 5k"), ctx).chips[0]?.label).toBe("Over ₹5000"))
  it("labels in the app's words", () => {
    const hi = amounts(String, { over: (a) => `${a} से ज़्यादा`, range: (a, b) => `${a} से ${b}` })
    expect(hi.read(pad("over 5k"), ctx).chips[0]?.label).toBe("5000 से ज़्यादा")
    expect(hi.read(pad("over 100 under 500"), ctx).chips[0]?.label).toBe("100 से 500")
    expect(hi.read(pad("under 100"), ctx).chips[0]?.label).toBe("Under 100")
  })
})

describe("date labels", () => {
  const hi = dates({
    today: "आज",
    lastDays: (n) => `पिछले ${n} दिन`,
    month: (m, y) => `m${m}${y ?? ""}`,
  })
  const label = (q: string) => hi.read(pad(q), ctx).chips[0]?.label
  it("uses the app's words, English for the rest", () => {
    expect(label("today")).toBe("आज")
    expect(label("last 30 days")).toBe("पिछले 30 दिन")
    expect(label("march")).toBe("m2")
    expect(label("march 2025")).toBe("m22025")
    expect(label("yesterday")).toBe("Yesterday")
  })
})

describe("people", () => {
  const r = people(() => ["Meera Sharma", "Arjun"])
  it("by first name or @name", () => {
    expect(r.read(pad("meera kal"), ctx).chips[0]?.value).toBe("Meera Sharma")
    expect(r.read(pad("@arjun"), ctx).chips[0]?.value).toBe("Arjun")
    expect(r.read(pad("meera kal"), ctx).s.trim()).toBe("kal")
  })
  it("not inside another word", () => expect(r.read(pad("arjuna"), ctx).chips).toEqual([]))
})

describe("commands", () => {
  const r = commands(["add", "split"])
  it("leading verb with amount", () => {
    const out = r.read(pad("add 250 chai"), ctx)
    expect(out.chips[0]?.value as Command).toEqual({ verb: "add", amount: 250 })
    expect(out.s.trim()).toBe("chai")
  })
  it("verb only at the start", () => expect(r.read(pad("chai add"), ctx).chips).toEqual([]))
  it("k amounts", () =>
    expect(
      (r.read(pad("split 1.2k dinner"), ctx).chips[0]?.value as Command | undefined)?.amount,
    ).toBe(1200))
})

// Found in review of the Signet PR (12 Nov 2026). Each was a real wrong answer.
describe("review fixes", () => {
  it("full name beats an earlier first name", () => {
    const out = people(() => ["Rahul Sharma", "Rahul Verma"]).read(pad("rahul verma"), ctx)
    expect(out.chips.map((c) => c.label)).toEqual(["Rahul Verma"])
    expect(out.s.trim()).toBe("")
  })
  it("commands drop ₹, rs and commas from the text", () => {
    const r = commands(["add"])
    for (const q of ["add ₹250 chai", "add rs 250 chai", "add 1,200 chai"]) {
      const out = r.read(pad(q), ctx)
      expect(out.s.trim(), q).toBe("chai")
      expect((out.chips[0]?.value as Command | undefined)?.amount, q).toBeGreaterThan(0)
    }
  })
  it("rs only as its own word", () => {
    expect(amounts().read(pad("chairs 500"), ctx).chips).toEqual([])
    expect(amounts().read(pad("chairs over 500"), ctx).s.trim()).toBe("chairs")
  })
  it("month found after a word that only looks like one", () => {
    for (const q of ["mayank march", "marathon march"])
      expect(dates().read(pad(q), ctx).chips[0]?.label, q).toBe("March")
  })
  it("may on its own in a sentence is not May", () => {
    expect(dates().read(pad("may i pay"), ctx).chips).toEqual([])
    expect(dates().read(pad("may"), ctx).chips[0]?.label).toBe("May")
    expect(dates().read(pad("may 2025"), ctx).chips[0]?.label).toBe("May 2025")
  })
  it("last 0 days is not a range", () =>
    expect(dates().read(pad("last 0 days"), ctx).chips).toEqual([]))
  it("a reversed range is put the right way round", () => {
    const v = amounts().read(pad("5000 to 500"), ctx).chips[0]?.value as AmountRange
    expect([v.min, v.max]).toEqual([500, 5000])
  })
})
