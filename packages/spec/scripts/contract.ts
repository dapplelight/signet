/**
 * Parses packages/tokens/CONTRACT.md into the list of theme variables.
 * A name counts when it sits in a plain fenced code block under a
 * "## Required" or "## Optional" heading; `group` is the nearest heading
 * above the block. Mirrors the parse in packages/tokens/test/themes.ts.
 */
type Entry = { name: string; group: string }
export type ThemeContract = { version: string; required: Entry[]; optional: Entry[] }

export function parseContract(md: string, version: string): ThemeContract {
  const out: ThemeContract = { version, required: [], optional: [] }
  const seen = new Set<string>()
  let kind: "required" | "optional" | null = null
  let group = ""
  let fence = false // inside a plain fence (no info string)
  let skip = false // inside a fence with an info string, e.g. ```css
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) {
      if (fence || skip) fence = skip = false
      else if (line.trim() === "```") fence = true
      else skip = true
      continue
    }
    if (skip) continue
    if (fence) {
      if (!kind) continue
      for (const [name] of line.matchAll(/--[a-z0-9-]+/g)) {
        if (seen.has(name)) continue
        seen.add(name)
        out[kind].push({ name, group })
      }
      continue
    }
    const h = line.match(/^(#{1,6}) (.+)$/)
    if (!h) continue
    group = h[2].trim()
    if (h[1] === "##")
      kind = group.startsWith("Required")
        ? "required"
        : group.startsWith("Optional")
          ? "optional"
          : null
  }
  return out
}
