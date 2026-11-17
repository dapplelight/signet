#!/usr/bin/env bun
// Checks scripts/check-snippets.ts: names a block uses must be imported, defined or global.
import { checkSnippets } from "./check-snippets.ts"

let fail = 0
const ok = (name: string, c: boolean) => {
  if (!c) fail++
  console.log(c ? "  PASS" : "  FAIL", name)
}
const fence = (body: string, head = "tsx") => `# T\n\n\`\`\`${head}\n${body}\n\`\`\`\n`
const run = (...pages: string[]) =>
  checkSnippets(pages.map((src, i) => ({ file: `p${i}.mdx`, src })))
const msgs = (...pages: string[]) => run(...pages).map((p) => `${p.file}:${p.line}: ${p.message}`)

// The real breakages.
const bare = run(fence('import { Alert } from "x"\n\n<Alert><CircleAlertIcon /></Alert>'))
ok("unimported JSX component is flagged", bare.length === 1)
ok("line points at the use, not the fence", bare[0].line === 6)
ok(
  "message tells how to fix it",
  bare[0].message ===
    "CircleAlertIcon is used but never imported or defined. Import it in this block, or give the block the same title= as the block it continues.",
)
ok("unimported function call is flagged", run(fence("const a = betterAuth({})", "ts")).length === 1)
ok("each name is reported once per block", run(fence("eq(a, 1)\neq(a, 2)", "ts")).length === 2) // eq, a

// Stays quiet.
ok(
  "imports, local definitions and params pass",
  run(fence('import { db } from "./db"\n\nexport const f = (id: string) => db.get(id)', "ts"))
    .length === 0,
)
ok(
  "bare JSX after imports passes",
  run(fence('import { A } from "x"\n\n<A />\n<A />')).length === 0,
)
ok(
  "statements then bare JSX pass",
  run(fence('import { A } from "x"\n\nconst n = 1\n\n<A x={n} />')).length === 0,
)
ok("lowercase tags pass", run(fence("<div><span /></div>")).length === 0)
ok(
  "JS, DOM and Workers globals pass",
  run(
    fence(
      "console.log(process.env.X, crypto.randomUUID())\nexport const f = (db: D1Database) => fetch(new Response(), { signal: AbortSignal.timeout(1) })",
      "ts",
    ),
  ).length === 0,
)
ok(
  "node: imports pass",
  run(fence('import { writeFileSync } from "node:fs"\n\nwriteFileSync("a", "b")', "ts")).length ===
    0,
)
ok("a free name in shorthand is flagged", run(fence("export const o = { kv }", "ts")).length === 1)
ok("other languages are ignored", run(fence("nothing(imported)", "bash")).length === 0)
ok("~~~ fences are read too", run("~~~ts\nnothing(1)\n~~~\n").length === 1)

// Continuation: same title= on the same page.
const cont = (second: string) =>
  `# T\n\n\`\`\`ts title="src/db.ts"\nimport { eq } from "drizzle-orm"\n\`\`\`\n\n\`\`\`ts title="src/db.ts"\n${second}\n\`\`\`\n`
ok("a block with the same title continues the earlier one", run(cont("eq(1, 1)")).length === 0)
ok(
  "an untitled block is not a continuation",
  run(`\`\`\`ts title="a.ts"\nimport { eq } from "x"\n\`\`\`\n\n\`\`\`ts\neq(1, 1)\n\`\`\`\n`)
    .length === 1,
)
ok(
  "a different title is not a continuation",
  run(
    `\`\`\`ts title="a.ts"\nimport { eq } from "x"\n\`\`\`\n\n\`\`\`ts title="b.ts"\neq(1, 1)\n\`\`\`\n`,
  ).length === 1,
)
ok(
  "titles do not carry across pages",
  msgs(
    `\`\`\`ts title="a.ts"\nimport { eq } from "x"\n\`\`\`\n`,
    `\`\`\`ts title="a.ts"\neq(1, 1)\n\`\`\`\n`,
  ).length === 1,
)
ok(
  "an earlier block cannot see a later one",
  run(
    `\`\`\`ts title="a.ts"\neq(1, 1)\n\`\`\`\n\n\`\`\`ts title="a.ts"\nimport { eq } from "x"\n\`\`\`\n`,
  ).length === 1,
)

// Syntax errors are reported, not hidden.
const syn = run(fence("const = ;", "ts"))
ok(
  "a block that does not parse is flagged",
  syn.length === 1 && syn[0].message.startsWith("Block does not parse"),
)

// Line numbers survive a continuation and a file with several blocks.
const multi = run(`intro\n\n\`\`\`ts\nconst a = 1\n\`\`\`\n\n\`\`\`ts\nconst b = missing\n\`\`\`\n`)
ok("line numbers are file lines", multi.length === 1 && multi[0].line === 8)

if (fail) {
  console.log(`\n${fail} failed`)
  process.exit(1)
}
console.log("\nall passed")
