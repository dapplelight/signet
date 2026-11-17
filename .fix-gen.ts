// one-off: what would sync.ts emit for every component, does it pass?
import { INDEX } from "./packages/mcp/src/generated/index.ts"
import { checkSnippets } from "./scripts/check-snippets.ts"

const comps = (INDEX.components as any[]).filter((c) => c.importPath.includes("signet-ui"))
const files = comps.map((c) => ({
  file: `gen/${c.name}.mdx`,
  src: `## Usage\n\n\`\`\`tsx\n${c.example}\n\`\`\`\n`,
}))
const p = checkSnippets(files)
console.log(files.length, "pages;", p.length, "problems")
for (const x of p.slice(0, 60)) console.log(x.file, x.line, x.message.split(" ")[0])
