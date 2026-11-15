/** Writes dist/registry.json from packages/ui. Run by `bun run build`. */

import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { buildRegistry } from "./registry.js"

const reg = buildRegistry(fileURLToPath(new URL("../../ui", import.meta.url)))
mkdirSync(new URL("../dist", import.meta.url), { recursive: true })
writeFileSync(new URL("../dist/registry.json", import.meta.url), JSON.stringify(reg))
console.log(
  `registry: ${Object.keys(reg.items).length} items, ${Object.keys(reg.files).length} files (signet-ui ${reg.version})`,
)
