/**
 * Off a terminal the clack prompts never run: a missing argument is the same
 * error, on the same stream, with the same exit code as before. Agents and CI
 * read these.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CLI = process.env.SIGNET_CLI ?? new URL("../src/index.ts", import.meta.url).pathname
const DIR = mkdtempSync(join(tmpdir(), "signet-cli-tty-"))

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

/** stdin not a TTY, stdout a pipe. */
function run(...args: string[]) {
  const p = Bun.spawnSync(["bun", CLI, ...args, "--cwd", DIR], { cwd: DIR, stdin: "ignore" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

try {
  const cases: [string, string[], string][] = [
    ["add", ["add"], "Usage: signet add <name...>"],
    ["diff", ["diff"], "Usage: signet diff <name>"],
  ]
  for (const [label, args, msg] of cases) {
    const r = run(...args)
    ok(
      `${label} with no name, no TTY: same error, exit 1, nothing on stdout`,
      r.code === 1 && r.err === `\n  ${msg}\n\n` && r.out === "",
      r,
    )
  }
  const blk = run("add", "block")
  ok(
    "add block with no name, no TTY: lists the blocks, exit 1",
    blk.code === 1 &&
      blk.err.startsWith("\n  Usage: signet add block <name...>. Blocks: ") &&
      blk.out === "",
    blk,
  )
  const conf = Bun.spawnSync(["bun", CLI, "conformance"], { cwd: DIR, stdin: "ignore" })
  ok(
    "conformance with no URL, no TTY: usage, exit 1",
    conf.exitCode === 1 &&
      conf.stderr.toString() ===
        "\n  Usage: signet conformance <baseUrl> [--auth-prefix /api/auth] [--ingest /api/analytics] [--json]\n\n" &&
      conf.stdout.toString() === "",
    conf.stderr.toString(),
  )
  const th = Bun.spawnSync(["bun", CLI, "theme"], { cwd: DIR, stdin: "ignore" })
  const thHelp = Bun.spawnSync(["bun", CLI, "theme", "--help"], { cwd: DIR, stdin: "ignore" })
  ok(
    "theme with no colour, no TTY: its help on stdout, exit 1",
    th.exitCode === 1 &&
      th.stdout.toString() === thHelp.stdout.toString() &&
      th.stdout.toString().length > 0 &&
      th.stderr.toString() === "",
    th.stdout.toString(),
  )
  const list = run("list")
  ok("list, no TTY: no clack frame", list.code === 0 && !/[│┌└◇]/.test(list.out), list.out)
} finally {
  rmSync(DIR, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
