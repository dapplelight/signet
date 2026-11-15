/**
 * Adds real signet-ui items into a temp app, edits them, then upgrades
 * against a registry with upstream changes: clean merge, conflict, dry run,
 * refusal to overwrite, new dependencies, and import rewriting.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { add, diff, list, loadConfig, resolve, upgrade } from "../src/core.js"
import { hash, type Registry } from "../src/registry.js"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const PKG = new URL("..", import.meta.url).pathname
const CLI = join(PKG, "src/index.ts")
const REG_PATH = new URL("../dist/registry.json", import.meta.url).pathname
const reg = JSON.parse(readFileSync(REG_PATH, "utf8")) as Registry
const TMP = join(tmpdir(), "signet-cli-test")
const DIALOG = "components/ui/dialog.tsx"

/** A copy of the registry with one file changed upstream (hashes kept honest). */
function bump(r: Registry, path: string, fn: (s: string) => string): Registry {
  const next = structuredClone(r)
  const f = next.files[path]
  if (!f) throw new Error(path)
  f.content = fn(f.content)
  f.hash = hash(f.content)
  for (const item of Object.values(next.items))
    if (item.files.includes(path))
      item.hash = hash(item.files.map((p) => `${p}:${next.files[p]?.hash}`).join("\n"))
  next.version = "9.9.9"
  return next
}

function app(name: string): string {
  const root = join(TMP, name)
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, dependencies: { react: "^19.3.0", clsx: "^2.1.1" } }),
  )
  return root
}
const cli = (root: string, ...args: string[]) => {
  const r = Bun.spawnSync(["bun", CLI, ...args, "--cwd", root])
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }
}
const file = (root: string, p: string) =>
  readFileSync(join(root, "src/components/signet", p), "utf8")

rmSync(TMP, { recursive: true, force: true })
try {
  // ---- registry
  ok(
    "registry: dialog depends on button and utils, with npm peers",
    JSON.stringify(reg.items.dialog?.deps) === JSON.stringify(["button", "utils"]) &&
      !!reg.items.dialog?.peers["@base-ui/react"],
    reg.items.dialog,
  )
  ok(
    "registry: utils needs clsx and tailwind-merge",
    JSON.stringify(Object.keys(reg.items.utils?.peers ?? {})) ===
      JSON.stringify(["clsx", "tailwind-merge"]),
  )
  const order = resolve(reg, ["job-runs"])
  ok(
    "resolve: dependencies come first, transitively (job-runs -> data-table -> table -> utils)",
    order.at(-1) === "job-runs" &&
      order.indexOf("utils") < order.indexOf("table") &&
      order.indexOf("table") < order.indexOf("data-table"),
    order,
  )
  let threw = ""
  try {
    resolve(reg, ["dialg"])
  } catch (e) {
    threw = (e as Error).message
  }
  ok("resolve: an unknown name is refused", threw.includes('No item "dialg"'), threw)

  // ---- add, through the real CLI
  const a = app("add")
  const r1 = cli(a, "add", "dialog")
  ok("add: exits 0", r1.code === 0, r1.out)
  ok(
    "add: copies the item and its dependencies, keeping signet-ui's layout",
    ["components/ui/dialog.tsx", "components/ui/button.tsx", "lib/utils.ts"].every((p) =>
      existsSync(join(a, "src/components/signet", p)),
    ),
  )
  const d = file(a, DIALOG)
  ok(
    "add: relative imports are rewritten to the alias",
    d.includes('from "@/components/signet/components/ui/button"') &&
      d.includes('from "@/components/signet/lib/utils"') &&
      !d.includes("../../lib/utils.js"),
    d.slice(0, 400),
  )
  const cfg = loadConfig(a)
  ok(
    "add: signet.json records dir, alias, items and base hashes",
    cfg.dir === "src/components/signet" &&
      cfg.alias === "@/components/signet" &&
      cfg.items.dialog?.version === reg.version &&
      cfg.items.button?.hash === reg.items.button?.hash &&
      cfg.files[DIALOG] === reg.files[DIALOG]?.hash &&
      existsSync(join(a, ".signet/base", DIALOG)),
    cfg,
  )
  ok(
    "add: prints the missing npm peers only",
    r1.out.includes('"@base-ui/react@') &&
      r1.out.includes('"tailwind-merge@') &&
      !r1.out.includes('"react@') &&
      !r1.out.includes('"clsx@'),
    r1.out,
  )
  ok(
    "add: every aliased import points at a copied file",
    [...d.matchAll(/"@\/components\/signet\/([^"]+)"/g)].every((m) =>
      ["", ".ts", ".tsx", "/index.ts"].some((x) =>
        existsSync(join(a, "src/components/signet", `${m[1]}${x}`)),
      ),
    ),
  )
  ok("add: again with nothing changed is a no-op", cli(a, "add", "dialog").code === 0)

  // ---- alias "" keeps relative imports; --dir is saved
  const rel = app("relative")
  add(rel, reg, ["dialog"], { config: { dir: "ui", alias: "" } })
  ok(
    'add: alias "" keeps the relative imports and --dir is saved',
    readFileSync(join(rel, "ui", DIALOG), "utf8").includes('"../../lib/utils.js"') &&
      loadConfig(rel).dir === "ui",
  )

  // ---- upgrade: app edit + upstream edit in different places merges cleanly
  const m = app("merge")
  add(m, reg, ["dialog"])
  const appPath = join(m, "src/components/signet", DIALOG)
  writeFileSync(appPath, `// app: our tweak\n${readFileSync(appPath, "utf8")}`)
  const up = bump(reg, DIALOG, (s) => `${s}\n// upstream: new helper\n`)
  ok(
    "list: an edited item shows edited",
    list(m, reg).find((e) => e.name === "dialog")?.edited === true,
  )
  ok(
    "list: upstream changes show as an update",
    list(m, up).find((e) => e.name === "dialog")?.update === true,
  )
  ok("diff: shows the upstream change", diff(m, up, "dialog").includes("+// upstream: new helper"))
  const dry = upgrade(m, up, ["dialog"], { dryRun: true })
  ok(
    "upgrade --dry-run: reports the merge and writes nothing",
    dry.files.find((f) => f.path === DIALOG)?.status === "merged" &&
      !readFileSync(appPath, "utf8").includes("upstream: new helper") &&
      loadConfig(m).items.dialog?.version === reg.version,
    dry,
  )
  const u1 = upgrade(m, up, ["dialog"])
  const merged = readFileSync(appPath, "utf8")
  ok(
    "upgrade: 3-way merge keeps the app edit and brings the upstream one",
    u1.files.find((f) => f.path === DIALOG)?.status === "merged" &&
      merged.includes("// app: our tweak") &&
      merged.includes("// upstream: new helper") &&
      !merged.includes("<<<<<<<"),
    u1,
  )
  ok(
    "upgrade: base and version move to upstream",
    loadConfig(m).items.dialog?.version === "9.9.9" &&
      loadConfig(m).files[DIALOG] === up.files[DIALOG]?.hash,
  )
  ok(
    "upgrade: again is current",
    upgrade(m, up, []).files.every((f) => f.status === "current"),
  )

  // ---- upgrade: both sides change the same line -> conflict markers, exit 1
  const c = app("conflict")
  add(c, reg, ["dialog"])
  const cPath = join(c, "src/components/signet", DIALOG)
  const line = readFileSync(cPath, "utf8").split("\n")[0] as string
  writeFileSync(cPath, readFileSync(cPath, "utf8").replace(line, `${line} // app`))
  const upC = bump(reg, DIALOG, (s) => s.replace(s.split("\n")[0] as string, `${line} // upstream`))
  writeFileSync(join(TMP, "up.json"), JSON.stringify(upC))
  const r2 = cli(c, "upgrade", "dialog", "--registry", join(TMP, "up.json"))
  const conflicted = readFileSync(cPath, "utf8")
  ok(
    "upgrade: a clash leaves conflict markers and exits 1",
    r2.code === 1 &&
      r2.out.includes("conflict") &&
      conflicted.includes("<<<<<<< app") &&
      conflicted.includes(">>>>>>> signet-ui 9.9.9") &&
      conflicted.includes("// app") &&
      conflicted.includes("// upstream"),
    r2.out,
  )

  // ---- upgrade an untouched copy: replaced outright
  const clean = app("clean")
  add(clean, reg, ["dialog"])
  upgrade(clean, up, [])
  ok(
    "upgrade: an unedited copy is replaced",
    file(clean, DIALOG).endsWith("// upstream: new helper\n"),
  )

  // ---- add refuses to overwrite edits unless --force
  const f = app("force")
  add(f, reg, ["dialog"])
  const fPath = join(f, "src/components/signet", DIALOG)
  writeFileSync(fPath, "// mine\n")
  writeFileSync(join(TMP, "up2.json"), JSON.stringify(up))
  const r3 = cli(f, "add", "dialog", "--registry", join(TMP, "up2.json"))
  ok(
    "add: refuses to overwrite an edited file when upstream changed",
    r3.code === 1 && readFileSync(fPath, "utf8") === "// mine\n" && r3.out.includes(DIALOG),
    r3.out,
  )
  const r4 = cli(f, "add", "dialog", "--force", "--registry", join(TMP, "up2.json"))
  ok(
    "add --force: overwrites",
    r4.code === 0 && readFileSync(fPath, "utf8").includes("upstream: new helper"),
    r4.out,
  )
  const keep = app("keep")
  add(keep, reg, ["dialog"])
  const kPath = join(keep, "src/components/signet", "components/ui/button.tsx")
  writeFileSync(kPath, "// my button\n")
  add(keep, reg, ["dialog"])
  ok(
    "add: an edited dependency upstream did not change is left alone",
    readFileSync(kPath, "utf8") === "// my button\n",
  )

  // ---- upgrade pulls in a dependency upstream added
  const n = app("newdep")
  add(n, reg, ["dialog"])
  const withDep = bump(reg, DIALOG, (s) => `import { Kbd } from "./kbd.js"\n${s}`)
  withDep.files[DIALOG] = {
    ...(withDep.files[DIALOG] as Registry["files"][string]),
    imports: { ...withDep.files[DIALOG]?.imports, "./kbd.js": "components/ui/kbd.tsx" },
  }
  withDep.items.dialog?.deps.push("kbd")
  const u3 = upgrade(n, withDep, ["dialog"])
  ok(
    "upgrade: a new upstream dependency is added and its import rewritten",
    u3.added.includes("kbd") &&
      existsSync(join(n, "src/components/signet/components/ui/kbd.tsx")) &&
      file(n, DIALOG).includes('from "@/components/signet/components/ui/kbd"') &&
      !!loadConfig(n).items.kbd,
    u3,
  )

  let notAdded = ""
  try {
    upgrade(n, reg, ["card"])
  } catch (e) {
    notAdded = (e as Error).message
  }
  ok("upgrade: an item that was never added is refused", notAdded.includes("signet add card"))
  ok("list: through the CLI", cli(n, "list").out.includes("dialog              added 9.9.9"))

  // ---- every item, copied with rewritten imports, typechecks in an app
  // Inside the package so its npm imports resolve from the workspace's node_modules.
  const all = join(PKG, ".typecheck-app")
  rmSync(all, { recursive: true, force: true })
  mkdirSync(all)
  writeFileSync(join(all, "package.json"), "{}")
  symlinkSync(join(PKG, "../ui/node_modules"), join(all, "node_modules"))
  add(all, reg, Object.keys(reg.items))
  writeFileSync(
    join(all, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        isolatedModules: true,
        types: [],
        paths: { "@/*": ["./src/*"] },
      },
      include: ["src"],
    }),
  )
  const tsc = Bun.spawnSync(["bun", join(PKG, "../ui/node_modules/.bin/tsc"), "-p", all])
  rmSync(all, { recursive: true, force: true })
  ok(
    `typecheck: all ${Object.keys(reg.items).length} items compile in an app with the @/ alias`,
    tsc.exitCode === 0,
    tsc.stdout.toString().slice(0, 2000),
  )
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
