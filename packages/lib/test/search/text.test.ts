import { describe, expect, it } from "bun:test"
import { lev, norm, quality, sound, typo } from "../../src/search/text"

describe("text", () => {
  it("norm", () => expect(norm("Café-Coffee  Day!")).toBe("cafe coffee day"))
  it("lev", () => {
    expect(lev("swigy", "swiggy")).toBe(1)
    expect(lev("", "abc")).toBe(3)
  })
  it("sound folds Indian spellings", () => {
    expect(sound("biriyani")).toBe(sound("briyani"))
    expect(sound("swigy")).toBe(sound("swiggy"))
    expect(sound("zomatto")).toBe(sound("zomato"))
  })
  it("typo", () => {
    expect(typo("privte", "private")).toBe(true)
    expect(typo("dentsit", "dentist")).toBe(true)
    expect(typo("ab", "abc")).toBe(false)
  })
  it("tiers", () => {
    expect(quality("budgets", [], "budgets")).toBe(100)
    expect(quality("budgets", [], "bud")).toBe(88)
    expect(quality("private mode", ["pin"], "pin")).toBe(78)
    expect(quality("lock private mode", [], "private")).toBe(72)
    expect(quality("net worth", [], "nw")).toBe(60)
    expect(quality("private mode", ["encryption"], "encr")).toBe(55)
    expect(quality("appearance", ["dark mode"], "mode")).toBe(45)
    expect(quality("private mode", [], "privte")).toBe(25)
    expect(quality("budgets", [], "zzz")).toBe(0)
  })
  it("several words must each match", () => {
    expect(quality("star health family", [], "star family")).toBe(72)
    expect(quality("star health family", [], "star zzz")).toBe(0)
  })
})
