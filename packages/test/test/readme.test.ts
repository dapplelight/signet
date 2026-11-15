// Every ts/tsx block in the README compiles against the built package, as an
// app importing it by name would.
import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

test("README examples typecheck", () => {
  const root = join(import.meta.dirname, "..")
  const dir = join(root, "test/.readme")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir)
  const md = readFileSync(join(root, "README.md"), "utf8")
  const blocks = [...md.matchAll(/```(tsx?)\n([\s\S]*?)```/g)]
  expect(blocks.length).toBeGreaterThan(6)
  const files = blocks.map(([, lang, code], i) => {
    const f = `block${i}.${lang}`
    writeFileSync(join(dir, f), `${code}\nexport {}\n`)
    return f
  })
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      extends: "../../tsconfig.json",
      compilerOptions: { noUnusedLocals: false },
      files,
    }),
  )
  const r = Bun.spawnSync(["bunx", "tsc", "--noEmit", "-p", dir], { cwd: root })
  const out = r.stdout.toString() + r.stderr.toString()
  if (r.exitCode === 0) rmSync(dir, { recursive: true, force: true })
  expect(out).toBe("")
})
