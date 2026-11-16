// Run: bun test scripts/qa   (needs Playwright's Chromium, like run.test.ts)
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAQ5WmGQAAAABJRU5ErkJggg==",
  "base64",
)
const sheets = (...args: string[]) =>
  Bun.spawnSync(["bun", "run", join(import.meta.dir, "sheets.ts"), ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

test("no argument exits 2 with usage; a dir without manifest.json exits 1", () => {
  const none = sheets()
  expect(none.exitCode).toBe(2)
  expect(none.stderr.toString()).toContain("Usage: bun run scripts/qa/sheets.ts <run-dir>")
  const dir = mkdtempSync(join(tmpdir(), "qa-sheets-bad-"))
  const bad = sheets(dir)
  expect(bad.exitCode).toBe(1)
  expect(bad.stderr.toString()).toContain(`Sheets failed: no manifest.json in ${dir}`)
  rmSync(dir, { recursive: true })
})

test("a fixture run gets a sheet PNG and a report that ranks critical above minor", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-sheets-"))
  mkdirSync(join(dir, "shots"))
  mkdirSync(join(dir, "axe"))
  const entry = (viewport: string, extra: object = {}) => ({
    item: "fixture-card",
    theme: "editorial",
    mode: "light",
    viewport,
    png: `shots/fixture-card__editorial__light__${viewport}.png`,
    axe: null,
    violations: 0,
    consoleErrors: [],
    overflow: false,
    error: null,
    ...extra,
  })
  writeFileSync(join(dir, entry("mobile").png), PNG)
  writeFileSync(join(dir, entry("desktop").png), PNG)
  // minor listed first so a passing test proves the sort, not the file order
  writeFileSync(
    join(dir, "axe/minor.json"),
    JSON.stringify({
      violations: [
        {
          id: "region",
          impact: "minor",
          help: "Content should be in landmarks",
          nodes: [{ target: ["#a"] }],
        },
      ],
    }),
  )
  writeFileSync(
    join(dir, "axe/critical.json"),
    JSON.stringify({
      violations: [
        {
          id: "button-name",
          impact: "critical",
          help: "Buttons need a name",
          nodes: [{ target: [".save"] }],
        },
      ],
    }),
  )
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      axeTags: [],
      shots: [
        entry("mobile", { axe: "axe/minor.json", violations: 1 }),
        entry("desktop", {
          axe: "axe/critical.json",
          violations: 1,
          overflow: true,
          consoleErrors: ["boom"],
        }),
      ],
    }),
  )

  const r = sheets(dir)
  expect(r.exitCode).toBe(0)
  expect(r.stdout.toString()).toContain(`Wrote ${dir}/sheets (1 sheets)`)
  expect(existsSync(join(dir, "sheets/fixture-card.png"))).toBe(true)
  expect(existsSync(join(dir, "sheets/fixture-card.html"))).toBe(false)

  const md = readFileSync(join(dir, "report.md"), "utf8")
  expect(md.indexOf("button-name (critical): Buttons need a name")).toBeGreaterThan(-1)
  expect(md.indexOf("button-name (critical)")).toBeLessThan(md.indexOf("region (minor)"))
  expect(md).toContain("fixture-card / editorial / light / desktop: `.save`")
  expect(md).toContain("- sheets/fixture-card.png")
  rmSync(dir, { recursive: true })
}, 120_000)
