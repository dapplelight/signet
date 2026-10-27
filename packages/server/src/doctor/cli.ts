#!/usr/bin/env node
/**
 * signet-doctor [dir] — check a Worker's Durable Object rate-limit setup.
 *
 *   npx signet-doctor            # the current directory
 *   npx signet-doctor apps/api
 *
 * Exits 1 when anything would fail at deploy or at runtime.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { diagnose, parseWranglerConfig } from "./check.js"

const dir = resolve(process.argv[2] ?? ".")

const configPath = ["wrangler.jsonc", "wrangler.json"].map((f) => join(dir, f)).find(existsSync)
if (!configPath && existsSync(join(dir, "wrangler.toml"))) {
  console.log("  wrangler.toml is not supported yet; convert to wrangler.jsonc to check it.")
  process.exit(0)
}
const wranglerConfig = configPath ? readFileSync(configPath, "utf8") : null

let entrySource: string | null = null
try {
  const main = wranglerConfig ? parseWranglerConfig(wranglerConfig).main : undefined
  if (main) entrySource = readFileSync(join(dir, main), "utf8")
} catch {
  entrySource = null
}

function readSources(d: string): string {
  let out = ""
  for (const name of readdirSync(d)) {
    if (name === "node_modules" || name.startsWith(".") || name === "dist") continue
    const full = join(d, name)
    if (statSync(full).isDirectory()) out += readSources(full)
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out += `${readFileSync(full, "utf8")}\n`
  }
  return out
}
const srcDir = existsSync(join(dir, "src")) ? join(dir, "src") : dir

const findings = diagnose({ wranglerConfig, entrySource, appSource: readSources(srcDir) })
const mark = { ok: "✓", warn: "!", error: "✗" } as const
for (const f of findings) {
  console.log(`  ${mark[f.level]} ${f.message}`)
  if (f.fix) console.log(`      fix: ${f.fix}`)
}
const errors = findings.filter((f) => f.level === "error").length
console.log(errors ? `\n${errors} problem(s).` : "\nRate-limit setup looks right.")
process.exit(errors ? 1 : 0)
