import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import * as fc from "fast-check"
import { createSearch, source } from "../../src/search/engine"
import { BOOST_CAP, memoryStore } from "../../src/search/usage"
import { money, NOW } from "./fixtures"

// Rules that must hold for any input (fast-check, 100 runs each; FC_RUNS raises it).
const RUNS = Number(process.env.FC_RUNS) || 100

describe("search rules", () => {
  it("never throws, whatever is typed", () => {
    const s = money()
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (q) => {
        s.search(q)
      }),
      { numRuns: RUNS },
    )
  })

  it("an exact name beats a word-start match, even after many picks of the other", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), (n) => {
        const store = memoryStore()
        const s = createSearch({
          now: () => NOW,
          store,
          sources: [
            source<string>({
              kind: "x",
              title: "X",
              items: ["Lock Private mode", "Private"],
              key: (t) => t,
              name: (t) => t,
            }),
          ],
        })
        for (let i = 0; i < n; i++) s.pick("private", { key: "Lock Private mode" })
        const r = s.search("private")
        const first = r.best?.key ?? r.sections[0]?.hits[0]?.key
        expect(first).toBe("Private")
      }),
      { numRuns: RUNS },
    )
  })

  it("the pick boost is capped", () => {
    const s = createSearch({
      now: () => NOW,
      sources: [
        source<string>({
          kind: "x",
          title: "X",
          items: ["Budgets"],
          key: (t) => t,
          name: (t) => t,
        }),
      ],
    })
    const before = s.search("bud").best?.score ?? 0
    for (let i = 0; i < 50; i++) s.pick("bud", { key: "Budgets" })
    expect((s.search("bud").best?.score ?? 0) - before).toBeLessThanOrEqual(BOOST_CAP)
  })

  it("a date chip never adds payments", () => {
    const s = money()
    const words = fc.constantFrom("swiggy", "uber", "zepto", "rent", "bijli", "meera")
    const when = fc.constantFrom("kal", "last month", "this week", "october", "last 30 days")
    fc.assert(
      fc.property(words, when, (w, d) => {
        const count = (q: string) =>
          s.search(q).sections.find((x) => x.kind === "payment")?.hits.length ?? 0
        expect(count(`${w} ${d}`)).toBeLessThanOrEqual(count(w) || Number.POSITIVE_INFINITY)
      }),
      { numRuns: RUNS },
    )
  })

  it("no typo fix when real matches exist", () => {
    for (const q of ["swiggy", "private", "budget", "goa"])
      expect(money().search(q).fixed).toBeNull()
  })

  it("the engine imports nothing from any app", () => {
    const dir = `${import.meta.dir}/../../src/search`
    for (const f of readdirSync(dir)) {
      const src = readFileSync(`${dir}/${f}`, "utf8")
      expect(src, f).not.toMatch(/from ["'](@|react|\.\.\/)/)
    }
  })
})

describe("review fixes: engine", () => {
  it("a low prior does not make a real match look like a typo", () => {
    const s = createSearch({
      sources: [
        source<string>({
          kind: "a",
          title: "A",
          items: ["Instamart Swiggy"],
          key: (x) => x,
          name: (x) => x,
          prior: 0.6,
        }),
        source<string>({ kind: "b", title: "B", items: ["Swiggo"], key: (x) => x, name: (x) => x }),
      ],
    })
    const r = s.search("swiggy")
    expect(r.fixed).toBeNull()
    expect([r.best?.key, ...r.sections.flatMap((x) => x.hits.map((h) => h.key))]).toContain(
      "Instamart Swiggy",
    )
  })
})
