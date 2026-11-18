// signet-server/mcp must load without hono: signet-mcp's stdio bin installs
// it with only its own dependencies, and hono is an optional peer here.
// Walks every relative import reachable from src/mcp/index.ts and fails on
// a runtime (non-type) import of hono.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const seen = new Set<string>()
const bad: string[] = []
const walk = (file: string) => {
  if (seen.has(file)) return
  seen.add(file)
  const src = readFileSync(file, "utf8")
  for (const m of src.matchAll(/^(?:import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gms)) {
    const [, isType, spec] = m
    if (isType) continue
    if (spec === "hono" || spec.startsWith("hono/")) bad.push(`${file}: ${spec}`)
    else if (spec.startsWith(".")) walk(join(dirname(file), spec.replace(/\.js$/, ".ts")))
  }
}
walk(fileURLToPath(new URL("../src/mcp/index.ts", import.meta.url)))
if (bad.length) {
  console.error(`signet-server/mcp loads hono at runtime:\n  ${bad.join("\n  ")}`)
  process.exit(1)
}
console.log(`mcp-no-hono: ${seen.size} modules, no runtime hono import`)
