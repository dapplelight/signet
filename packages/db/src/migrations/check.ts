/**
 * Scan SQL migrations for changes that lose data or break running code:
 * dropped tables or columns, renames, and NOT NULL added without a default.
 *
 * Works on drizzle-kit output (statements split by `--> statement-breakpoint`)
 * and plain `;`-separated SQL. SQLite table rebuilds (`__new_x` copied, `x`
 * dropped, `__new_x` renamed to `x`) are not flagged. To accept a finding, put
 * `-- signet-allow: <kind>` (or `-- signet-allow: all`) in the statement.
 */

export type MigrationIssueKind =
  | "drop-table"
  | "drop-column"
  | "rename"
  | "not-null-without-default"

export type MigrationIssue = {
  kind: MigrationIssueKind
  file: string
  line: number
  statement: string
  message: string
}

const MESSAGES: Record<MigrationIssueKind, string> = {
  "drop-table": "drops a table and its data",
  "drop-column": "drops a column and its data; running code that reads it will fail",
  rename: "renames a table or column; code deployed before the migration will break",
  "not-null-without-default": "adds NOT NULL without a DEFAULT; fails on a table that has rows",
}

const ident = String.raw`["\`\[]?([\w.]+)["\`\]]?`

function split(sql: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = []
  let line = 1
  for (const chunk of sql.split(/--> statement-breakpoint|;/)) {
    const lead = chunk.match(/^\s*/)?.[0] ?? ""
    const text = chunk.trim()
    const start = line + (lead.match(/\n/g)?.length ?? 0)
    line += chunk.match(/\n/g)?.length ?? 0
    if (text.replace(/--[^\n]*/g, "").trim()) out.push({ text, line: start })
  }
  return out
}

/** Issues in one migration file's SQL. */
export function checkMigrationSql(sql: string, file = "<sql>"): MigrationIssue[] {
  const statements = split(sql)
  // Tables a SQLite rebuild replaces: `ALTER TABLE __new_x RENAME TO x`.
  const rebuilt = new Set<string>()
  for (const { text } of statements) {
    const m = text.match(
      new RegExp(String.raw`alter\s+table\s+${ident}\s+rename\s+to\s+${ident}`, "i"),
    )
    if (m?.[1]?.startsWith("__new_")) rebuilt.add(m[2]?.toLowerCase() ?? "")
  }

  const issues: MigrationIssue[] = []
  for (const { text, line } of statements) {
    const allow = [...text.matchAll(/--\s*signet-allow:\s*([\w-]+)/gi)].map((m) =>
      m[1]?.toLowerCase(),
    )
    const code = text
      .replace(/--[^\n]*/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    const flag = (kind: MigrationIssueKind) => {
      if (allow.includes(kind) || allow.includes("all")) return
      issues.push({ kind, file, line, statement: code, message: MESSAGES[kind] })
    }

    const drop = code.match(
      new RegExp(String.raw`^drop\s+table\s+(?:if\s+exists\s+)?${ident}`, "i"),
    )
    if (drop) {
      if (!rebuilt.has(drop[1]?.toLowerCase() ?? "")) flag("drop-table")
      continue
    }
    if (!/^alter\s+table/i.test(code)) continue
    if (/\bdrop\s+column\b/i.test(code)) flag("drop-column")
    const rename = code.match(
      new RegExp(String.raw`\brename\s+(?:column\s+)?(?:${ident}\s+)?to\b`, "i"),
    )
    if (rename && !/^alter\s+table\s+["`[]?__new_/i.test(code)) flag("rename")
    const adds = /\badd\s+(?:column\s+)?/i.test(code) && /\bnot\s+null\b/i.test(code)
    if (adds && !/\bdefault\b/i.test(code) && !/\bgenerated\b/i.test(code)) {
      flag("not-null-without-default")
    }
    if (/\balter\s+column\s+\S+\s+set\s+not\s+null\b/i.test(code)) flag("not-null-without-default")
  }
  return issues
}

/** Human-readable report, one issue per line. */
export function formatIssues(issues: readonly MigrationIssue[]): string {
  return issues
    .map((i) => `${i.file}:${i.line}  ${i.kind}  ${i.message}\n    ${i.statement.slice(0, 160)}`)
    .join("\n")
}
