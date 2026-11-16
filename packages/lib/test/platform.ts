/**
 * Every export path of this package loads with no browser globals: a service
 * worker, a Bun CLI and React Native must all be able to import it. Each
 * global below reads as undefined, as it does there; a module that uses one
 * unguarded at import throws and fails here.
 */

import pkg from "../package.json"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const GLOBALS = [
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "navigator",
  "location",
  "chrome",
]
const saved = GLOBALS.map((g) => [g, Object.getOwnPropertyDescriptor(globalThis, g)] as const)
for (const g of GLOBALS) {
  Object.defineProperty(globalThis, g, {
    configurable: true,
    get: () => undefined,
  })
}

for (const [path, target] of Object.entries(pkg.exports)) {
  const src = target.import.replace("./dist/", "../src/").replace(/\.js$/, ".ts")
  let error = ""
  try {
    await import(src)
  } catch (e) {
    error = String(e)
  }
  ok(`${path} imports with no browser globals`, !error, error)
}

for (const [g, d] of saved) {
  if (d) Object.defineProperty(globalThis, g, d)
  else delete (globalThis as Record<string, unknown>)[g]
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
