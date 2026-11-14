#!/usr/bin/env node
/**
 * `signet-db-check [paths...]`: check SQL migration files or directories
 * (default: ./drizzle and ./migrations). Exits 1 if anything is flagged.
 *
 * In CI, check only migrations the change adds, since old ones already ran:
 *   signet-db-check $(git diff --name-only --diff-filter=A origin/main -- 'drizzle/*.sql')
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { checkMigrationSql, formatIssues } from "./check.js"

const args = process.argv.slice(2)
const roots = args.length ? args : ["drizzle", "migrations"].filter((d) => existsSync(d))

const files: string[] = []
const walk = (p: string) => {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p).sort()) walk(join(p, f))
  } else if (p.endsWith(".sql")) files.push(p)
}
for (const r of roots) {
  if (!existsSync(r)) {
    console.error(`signet-db-check: ${r} does not exist`)
    process.exit(2)
  }
  walk(r)
}

const issues = files.flatMap((f) => checkMigrationSql(readFileSync(f, "utf8"), f))
if (issues.length) {
  console.error(formatIssues(issues))
  console.error(
    `\n${issues.length} risky change(s) in ${files.length} file(s). Add "-- signet-allow: <kind>" to a statement to accept it.`,
  )
  process.exit(1)
}
console.log(`signet-db-check: ${files.length} file(s), nothing risky`)
