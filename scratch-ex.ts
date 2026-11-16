import { readdirSync, readFileSync } from "node:fs"
const t = new Bun.Transpiler({ loader: "tsx" })
for (const d of ["ui", "domain", "screens"]) {
  const dir = `packages/ui/src/components/${d}`
  for (const f of readdirSync(dir).sort()) {
    const ex = t
      .scan(readFileSync(`${dir}/${f}`, "utf8"))
      .exports.filter((e) => /^[A-Z][a-z]/.test(e) && !/^[A-Z_]+$/.test(e))
    console.log(`${d}/${f}: ${ex.join(" ")}`)
  }
}
