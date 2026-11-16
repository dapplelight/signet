/**
 * The QA gallery must cover every component. This fails when a file under
 * packages/ui/src/components/{ui,domain,screens} (or a screen export in a screens file) is
 * neither in QA_ITEMS nor in QA_SKIP, when a registry entry points at nothing, and when the
 * gallery's themes and modes drift from the ones packages/test/src/playwright.ts uses.
 */
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { QA_ITEMS, QA_MODES, QA_SKIP } from "../src/qa-items"

const ROOT = new URL("../../..", import.meta.url).pathname
const DIR = "packages/ui/src/components"
// Bun's own parser lists a file's exports, `export { A, B }` lists included. Typed here by hand
// because the showcase has no @types/bun.
declare const Bun: {
  Transpiler: new (options: { loader: "tsx" }) => { scan(code: string): { exports: string[] } }
}
const transpiler = new Bun.Transpiler({ loader: "tsx" })
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
/** Component-like value exports: PascalCase, not an ALL_CAPS constant. */
const componentExports = (source: string) =>
  transpiler.scan(readFileSync(ROOT + source, "utf8")).exports.filter((e) => /^[A-Z][a-z]/.test(e))

// Registry sanity.
const ids = QA_ITEMS.map((i) => i.id)
assert.equal(new Set(ids).size, ids.length, "duplicate QA item id")
for (const item of QA_ITEMS) {
  assert.ok(existsSync(ROOT + item.source), `${item.id}: ${item.source} does not exist`)
  const stem = item.source
    .split("/")
    .pop()
    ?.replace(/\.tsx$/, "")
  assert.equal(item.id, item.kind === "screen" ? `${stem}/${item.id.split("/")[1]}` : stem)
}
for (const skip of QA_SKIP) {
  assert.ok(skip.reason.trim().length > 10, `${skip.source}: skip needs a reason`)
  assert.ok(existsSync(ROOT + skip.source), `skip: ${skip.source} does not exist`)
  if (skip.export) {
    assert.ok(
      componentExports(skip.source).includes(skip.export),
      `skip: ${skip.source} has no export ${skip.export}`,
    )
  }
}
const skipped = (source: string, name?: string) =>
  QA_SKIP.some((s) => s.source === source && (!s.export || s.export === name))

// ui and domain: every file is an item (id = file stem) or is skipped whole.
for (const [kind, dir] of [
  ["ui", "ui"],
  ["domain", "domain"],
] as const) {
  for (const file of readdirSync(`${ROOT}${DIR}/${dir}`).filter((f) => f.endsWith(".tsx"))) {
    const source = `${DIR}/${dir}/${file}`
    const covered = QA_ITEMS.some((i) => i.source === source && i.kind === kind)
    assert.ok(
      covered || skipped(source),
      `${source} is not in QA_ITEMS or QA_SKIP (src/qa-items.ts)`,
    )
  }
}

// screens: every component export is its own item `<stem>/<kebab>` or is skipped.
for (const file of readdirSync(`${ROOT}${DIR}/screens`).filter((f) => f.endsWith(".tsx"))) {
  const source = `${DIR}/screens/${file}`
  const stem = file.replace(/\.tsx$/, "")
  const exports = componentExports(source)
  for (const name of exports) {
    const registered = QA_ITEMS.some((i) => i.id === `${stem}/${kebab(name)}`)
    assert.ok(
      registered || skipped(source, name),
      `${source} exports ${name}: add ${stem}/${kebab(name)} to QA_ITEMS or list it in QA_SKIP (src/qa-items.ts)`,
    )
  }
  for (const item of QA_ITEMS.filter((i) => i.source === source)) {
    const name = exports.find((e) => `${stem}/${kebab(e)}` === item.id)
    assert.ok(name, `${item.id} is registered but ${source} has no matching export`)
  }
}

// Themes and modes: the gallery lists what the Playwright helpers screenshot.
const playwright = readFileSync(`${ROOT}packages/test/src/playwright.ts`, "utf8")
const list = (name: string) => {
  const m = playwright.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))
  assert.ok(m?.[1], `${name} not found in packages/test/src/playwright.ts`)
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}
const showcaseThemes = readdirSync(new URL("../src/themes/", import.meta.url))
  .map((f) => f.replace(/\.css$/, ""))
  .sort()
assert.deepEqual(showcaseThemes, [...list("THEMES")].sort(), "showcase themes != playwright THEMES")
assert.deepEqual([...QA_MODES], list("MODES"), "QA_MODES != playwright MODES")

console.log(`qa-items: ${QA_ITEMS.length} items, ${QA_SKIP.length} skips: ok`)
