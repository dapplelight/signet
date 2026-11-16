// Run: bun test scripts/qa   (builds the showcase and needs Playwright's Chromium, so CI's lint job skips it)
import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QA_ITEMS } from "../../apps/showcase/src/qa-items"

const run = (...args: string[]) =>
  Bun.spawnSync(["bun", "run", join(import.meta.dir, "run.ts"), ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

test("an unknown flag exits 2 with the usage line", () => {
  const r = run("--nope")
  expect(r.exitCode).toBe(2)
  expect(r.stderr.toString()).toContain("Unknown flag --nope. Usage: bun run qa")
})

test("a filter that matches nothing exits 1, lists ids and writes nothing", () => {
  const out = mkdtempSync(join(tmpdir(), "qa-empty-"))
  const r = run("--filter", "no-such-item", "--out", join(out, "x"))
  expect(r.exitCode).toBe(1)
  expect(r.stdout.toString()).toContain('No QA items match "no-such-item".')
  expect(existsSync(join(out, "x"))).toBe(false)
  rmSync(out, { recursive: true })
})

test("--quick --filter button writes a manifest, PNGs and axe files", () => {
  const out = mkdtempSync(join(tmpdir(), "qa-run-"))
  const r = run("--quick", "--filter", "button", "--out", out)
  expect(r.stdout.toString() + r.stderr.toString()).toContain("Wrote ")
  expect(r.exitCode).toBe(0)

  const ids = QA_ITEMS.map((i) => i.id).filter((id) => id.includes("button"))
  const expected = ids.flatMap((id) =>
    ["mobile", "desktop"].map((vp) => `${id}__editorial__light__${vp}`),
  )
  const [stamp] = [...new Bun.Glob("*/manifest.json").scanSync(out)]
  const dir = join(out, (stamp as string).replace("/manifest.json", ""))
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))

  expect(manifest.shots).toHaveLength(expected.length)
  for (const e of manifest.shots) {
    expect(e.error).toBeNull()
    expect(expected).toContain(`${e.item}__${e.theme}__${e.mode}__${e.viewport}`)
    expect(statSync(join(dir, e.png)).size).toBeGreaterThan(0)
    expect(JSON.parse(readFileSync(join(dir, e.axe), "utf8")).violations).toHaveLength(e.violations)
    expect(Array.isArray(e.consoleErrors)).toBe(true)
    expect(typeof e.overflow).toBe("boolean")
  }
  rmSync(out, { recursive: true })
}, 600_000)
