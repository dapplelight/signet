// one-off, not committed: name -> candidate import paths
import { INDEX } from "./packages/mcp/src/generated/index.ts"
import { readFileSync } from "node:fs"

const cands = new Map<string, Set<string>>()
for (const e of INDEX.exports as any[])
  for (const s of e.symbols) {
    if (!cands.has(s.name)) cands.set(s.name, new Set())
    cands.get(s.name)!.add(`${e.path}|${s.kind}`)
  }
const t = readFileSync(".snip.txt", "utf8")
const names = new Map<string, number>()
for (const m of t.matchAll(/^(\S+?):(\d+): (\S+) is used/gm)) names.set(m[3], (names.get(m[3]) ?? 0) + 1)
const out: string[] = []
for (const [n, c] of [...names].sort((a, b) => b[1] - a[1])) {
  const k = cands.get(n)
  if (k) out.push(`${n} (${c}): ${[...k].join(" ")}`)
}
console.log(out.length, "of", names.size, "resolvable")
console.log(out.join("\n"))
