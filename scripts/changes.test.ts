#!/usr/bin/env bun
// Checks scripts/changes.ts on a scratch CHANGELOG, and that release.yml folds
// fragments and regenerates API.md before it builds what it publishes.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname
let fail = 0
const ok = (name: string, c: boolean) => {
  if (!c) fail++
  console.log(c ? "  PASS" : "  FAIL", name)
}

const tmp = mkdtempSync(join(tmpdir(), "signet-changes-"))
const run = (...args: string[]) =>
  spawnSync("bun", [join(ROOT, "scripts/changes.ts"), ...args], {
    env: { ...process.env, CHANGES_ROOT: tmp },
    encoding: "utf8",
  })
const log = () => readFileSync(join(tmp, "CHANGELOG.md"), "utf8")

writeFileSync(join(tmp, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n### old: entry\n\n- x\n")
ok("no .changes directory is a no-op", run().status === 0)
mkdirSync(join(tmp, ".changes"))
writeFileSync(join(tmp, ".changes/README.md"), "# not an entry\n")
writeFileSync(join(tmp, ".changes/b.md"), "### b: second\n\n- two\n")
writeFileSync(join(tmp, ".changes/a.md"), "### a: first\n\n- one\n")

ok("--check passes valid fragments", run("--check").status === 0)
ok("--check writes nothing", !log().includes("### a:") && existsSync(join(tmp, ".changes/a.md")))
ok("fold exits 0", run().status === 0)
ok(
  "fragments go on top of Unreleased, in file-name order",
  log() ===
    "# Changelog\n\n## Unreleased\n\n### a: first\n\n- one\n\n### b: second\n\n- two\n\n### old: entry\n\n- x\n",
)
ok("folded fragments are deleted", !existsSync(join(tmp, ".changes/a.md")))
ok("README.md stays", existsSync(join(tmp, ".changes/README.md")))
const before = log()
ok("second run is a no-op", run().status === 0 && log() === before)
writeFileSync(join(tmp, ".changes/c.md"), "no heading\n")
ok("a fragment without a ### heading fails --check", run("--check").status === 1)
ok("and fails the fold without writing", run().status === 1 && log() === before)
rmSync(tmp, { recursive: true, force: true })

const release = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8")
const at = (s: string) => release.indexOf(s)
ok(
  "release.yml folds and regenerates API.md before build:all",
  at("bun run changes && bun run gen:api") > 0 &&
    at("bun run changes && bun run gen:api") < at("bun run build:all"),
)

console.log(fail ? `\n${fail} failed` : "\nall passed")
process.exit(fail ? 1 : 0)
