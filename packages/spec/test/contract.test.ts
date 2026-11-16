import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { CONTRACT_MD, generate, PUBLIC_DIR, SCHEMAS_DIR } from "../scripts/gen"
import { SPEC_VERSION } from "../src/error"

type Entry = { name: string; group: string }
const read = (dir: string) => readFileSync(join(dir, "contract.json"), "utf8")
const contract = JSON.parse(read(SCHEMAS_DIR)) as {
  version: string
  required: Entry[]
  optional: Entry[]
}

describe("contract.json", () => {
  test("committed copies equal what gen.ts generates from CONTRACT.md (run `bun run gen`)", () => {
    const text = generate()["contract.json"]
    expect(read(SCHEMAS_DIR)).toBe(text)
    expect(read(PUBLIC_DIR)).toBe(text)
  })

  test("carries the spec version", () => expect(contract.version).toBe(SPEC_VERSION))

  test("78 required and 16 optional, the counts CONTRACT.md states and the tokens test enforces", () => {
    const stated = readFileSync(CONTRACT_MD, "utf8").match(
      /\*\*(\d+) required, (\d+) optional\.\*\*/,
    )
    expect(contract.required).toHaveLength(78)
    expect(contract.optional).toHaveLength(16)
    expect([Number(stated?.[1]), Number(stated?.[2])]).toEqual([78, 16])
  })

  test("every entry is a CSS variable with a group, and no name repeats", () => {
    const all = [...contract.required, ...contract.optional]
    for (const e of all) {
      expect(e.name).toMatch(/^--[a-z0-9-]+$/)
      expect(e.group.length).toBeGreaterThan(0)
    }
    expect(new Set(all.map((e) => e.name)).size).toBe(all.length)
  })

  test("groups are the nearest heading", () => {
    const group = (n: string) =>
      [...contract.required, ...contract.optional].find((e) => e.name === n)?.group
    expect(group("--color-background")).toBe("Required — color")
    expect(group("--text-sm")).toBe("The size scale the components actually use")
    expect(group("--text-body")).toBe("Semantic scale — for app-level use")
    expect(group("--font-sans")).toBe("Type and motion")
    expect(group("--color-money-debit")).toBe("Optional — named slots, never required")
  })
})

describe("every theme defines every required variable in contract.json", () => {
  const dir = join(import.meta.dirname, "../../tokens/src/themes")
  const themes = readdirSync(dir).filter((f) => f.endsWith(".css"))
  /** The theme's CSS with its `@import "./x.css"` lines inlined, as the tokens test reads it. */
  const source = (file: string): string =>
    readFileSync(join(dir, file), "utf8").replace(/@import "\.\/([\w-]+\.css)";/g, (_, f) =>
      source(f),
    )

  test("there are three themes", () =>
    expect(themes.sort()).toEqual(["cinematic.css", "editorial.css", "finance.css"]))
  for (const theme of themes) {
    test(theme, () => {
      const css = source(theme)
      const missing = contract.required.filter(
        ({ name }) => !new RegExp(`^\\s*${name}\\s*:`, "m").test(css),
      )
      expect(missing).toEqual([])
    })
  }
})
