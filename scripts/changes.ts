#!/usr/bin/env bun
/**
 * Fold `.changes/*.md` into CHANGELOG.md under "## Unreleased", then delete
 * them. PRs add a fragment instead of editing CHANGELOG.md, so parallel PRs
 * never conflict on it; the post-merge workflow runs this on main.
 *
 * Fragments go in at the top of Unreleased (newest first, as the file reads),
 * in file-name order among themselves.
 *
 *   bun run changes           fold and delete (the post-merge workflow)
 *   bun run changes --check   only validate the fragments (CI on PRs)
 *
 * release.yml also runs it (without committing) before building, so the
 * signet-mcp index it publishes carries the folded changelog even when the
 * release commit lands before the post-merge fold. Tested by changes.test.ts.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.env.CHANGES_ROOT ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const DIR = join(ROOT, ".changes")
const LOG = join(ROOT, "CHANGELOG.md")
const HEAD = "## Unreleased\n\n"

const files = (existsSync(DIR) ? readdirSync(DIR) : [])
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort()
if (!files.length) process.exit(0)

const entries = files.map((f) => {
  const text = readFileSync(join(DIR, f), "utf8").trim()
  if (!text.startsWith("### ")) {
    console.error(`.changes/${f} must start with a "### package: title" heading`)
    process.exit(1)
  }
  return text
})
if (process.argv.includes("--check")) {
  console.log(`  PASS ${files.length} changelog fragment(s)`)
  process.exit(0)
}

const log = readFileSync(LOG, "utf8")
const at = log.indexOf(HEAD)
if (at < 0) {
  console.error(`CHANGELOG.md has no "## Unreleased" section`)
  process.exit(1)
}
const cut = at + HEAD.length
writeFileSync(LOG, `${log.slice(0, cut)}${entries.join("\n\n")}\n\n${log.slice(cut)}`)
for (const f of files) rmSync(join(DIR, f))
console.log(`CHANGELOG.md: folded ${files.join(", ")}`)
