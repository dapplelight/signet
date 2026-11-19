/**
 * Off a terminal the picker never runs: stdout must stay byte for byte what it
 * was before the clack picker, since agents and CI read it. And `--starter api`,
 * the old name of api-billing, must still scaffold that starter.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CLI = new URL("../src/index.ts", import.meta.url).pathname
const DIR = mkdtempSync(join(tmpdir(), "csa-picker-"))

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

/** Runs the scaffolder with stdin from /dev/null, so it is not a TTY. */
function run(...args: string[]) {
  const p = Bun.spawnSync(["bun", CLI, ...args], { cwd: DIR, stdin: "ignore" })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

try {
  const web = run("my-web")
  ok("no flags, no TTY: exits 0", web.code === 0, web.err)
  ok(
    "no flags, no TTY: the web platform's output, unchanged",
    web.out ===
      `
  Created my-web with the editorial theme.

  cd my-web
  bun install
  bun run dev

  Switch themes by editing the @dapplelight/signet-tokens import in src/app.css.

`,
    JSON.stringify(web.out),
  )
  ok("no flags, no TTY: scaffolds the web template", existsSync(join(DIR, "my-web/vite.config.ts")))

  const api = run("my-api", "--starter", "api")
  ok("--starter api: exits 0", api.code === 0, api.err)
  ok(
    "--starter api: resolves to api-billing (API half, account + payments)",
    api.out ===
      `
  Created my-api: API, MCP at /mcp.
  Parts: auth, account, payments, mcp (added auth for account).

  cd my-api
  bun install
  bun run dev

  Sign in with POST /api/auth/otp, then /api/auth/verify; in development the
  code is printed in this terminal.
  README.md walks through the first day. The API runs on Bun,
  whichever package manager installs it.

`,
    JSON.stringify(api.out),
  )
  ok("--starter api: no web half", !existsSync(join(DIR, "my-api/vite.config.ts")))

  const billing = run("my-billing", "--starter", "api-billing")
  ok(
    "--starter api-billing: the same app",
    billing.code === 0 && billing.out === api.out.replaceAll("my-api", "my-billing"),
    billing.err,
  )
  const help = run("--help")
  ok(
    "--help lists api-billing, not the alias",
    /\n {25}api-billing /.test(help.out) && !/\n {25}api /.test(help.out),
  )
} finally {
  rmSync(DIR, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
