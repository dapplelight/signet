/**
 * The composer's migration pruning, without scaffolding: a table two parts
 * list stays while either is chosen, and a migration that empties out goes
 * without leaving a gap in the numbers or a broken snapshot chain.
 */

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { droppedTables, filterMigrations } from "../src/compose"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, JSON.stringify(d)))
}

// usage_counters is listed by payments and ai.
ok("usage_counters goes with neither part", droppedTables(["auth"]).has("usage_counters"))
ok("usage_counters stays with payments", !droppedTables(["auth", "payments"]).has("usage_counters"))
ok("usage_counters stays with ai alone", !droppedTables(["auth", "ai"]).has("usage_counters"))
ok(
  "payments' other tables still go with ai alone",
  droppedTables(["auth", "ai"]).has("subject_plans"),
)

// Without orgs the middle migration (0001_orgs) empties out.
const dir = mkdtempSync(join(tmpdir(), "csa-migrations-"))
try {
  cpSync(join(import.meta.dirname, "../base/api/drizzle"), dir, { recursive: true })
  await filterMigrations(dir, droppedTables(["auth", "ai", "workflows"]))
  const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[]
  }
  const tags = journal.entries.map((e) => `${e.idx}:${e.tag}`)
  ok(
    "the later migration moves up a number",
    tags.join() === "0:0000_init,1:0001_ai_paywalls_workflows",
    tags,
  )
  const files = [...readdirSync(dir), ...readdirSync(join(dir, "meta"))].sort()
  ok(
    "files match the journal",
    files.join() ===
      "0000_init.sql,0000_snapshot.json,0001_ai_paywalls_workflows.sql,0001_snapshot.json,_journal.json,meta",
    files,
  )
  const snap = (n: string) =>
    JSON.parse(readFileSync(join(dir, `meta/${n}_snapshot.json`), "utf8")) as {
      id: string
      prevId: string
      tables: Record<string, unknown>
    }
  const [first, second] = [snap("0000"), snap("0001")]
  ok("its snapshot links to the one before", second.prevId === first.id)
  const tables = Object.keys(second.tables)
  ok(
    "its snapshot keeps the chosen tables only",
    tables.includes("workflow_runs") &&
      tables.includes("ai_spend_caps") &&
      tables.includes("usage_counters") &&
      !tables.includes("offerings") &&
      !tables.includes("organizations") &&
      !tables.includes("subject_plans"),
    tables,
  )
  const sql = readFileSync(join(dir, "0001_ai_paywalls_workflows.sql"), "utf8")
  ok(
    "its SQL keeps the chosen tables only",
    sql.includes("CREATE TABLE `workflow_runs`") && !sql.includes("`placements`"),
  )
  const init = readFileSync(join(dir, "0000_init.sql"), "utf8")
  ok(
    "usage_counters is still created for ai",
    init.includes("CREATE TABLE `usage_counters`") && !init.includes("`subject_plans`"),
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
