/**
 * Scaffolds the cli template OUTSIDE the monorepo with the LOCAL lib and tokens
 * as tarballs (pointed at before the first install: a bumped version is not on
 * npm yet), typechecks, lints, runs the app's tests, compiles once with
 * `bun build --compile`, and runs the binary. The binary is ~60MB; it is
 * deleted with the scratch dir.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const DIR = join("/tmp", "__scaffold_cli__")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

rmSync(DIR, { recursive: true, force: true })
try {
  await $`bun run ${ROOT}/packages/create-signet-app/src/index.ts ${DIR} --template cli`
    .cwd("/tmp")
    .quiet()
  const pkgPath = join(DIR, "package.json")
  let pkg = readFileSync(pkgPath, "utf8")
  const json = JSON.parse(pkg)
  ok(
    "cli deps: lib and tokens, no react, no CLI framework",
    !!json.dependencies["@dapplelight/signet-lib"] &&
      !!json.dependencies["@dapplelight/signet-tokens"] &&
      Object.keys(json.dependencies).length === 2,
  )
  ok("build script compiles to dist/<name>", json.scripts.build.includes("dist/__scaffold_cli__"))
  ok(
    "no _github left, CI has the binary matrix",
    readFileSync(join(DIR, ".github/workflows/ci.yml"), "utf8").includes("matrix"),
  )
  ok(
    "client id substituted",
    readFileSync(join(DIR, "src/config.ts"), "utf8").includes('"__scaffold_cli__"'),
  )

  for (const p of ["lib", "tokens"]) {
    const tgz = (await $`npm pack ${ROOT}/packages/${p}`.cwd(DIR).quiet()).text().trim()
    pkg = pkg.replace(new RegExp(`("@dapplelight/signet-${p}": )"[^"]+"`), `$1"file:./${tgz}"`)
  }
  writeFileSync(pkgPath, pkg)
  await $`bun install`.cwd(DIR).quiet()

  ok("typechecks", (await $`bun run typecheck`.cwd(DIR).nothrow().quiet()).exitCode === 0)
  const lint = await $`bun run lint`.cwd(DIR).nothrow().quiet()
  ok(
    "lints clean",
    lint.exitCode === 0,
    (lint.stdout.toString() + lint.stderr.toString()).slice(-800),
  )
  const t = await $`bun run test`.cwd(DIR).nothrow().quiet()
  ok(
    "device poll tests pass",
    t.exitCode === 0,
    (t.stdout.toString() + t.stderr.toString()).slice(-800),
  )

  const b = await $`bun run build`.cwd(DIR).nothrow().quiet()
  ok(
    "bun build --compile",
    b.exitCode === 0 && existsSync(join(DIR, "dist/__scaffold_cli__")),
    b.stderr.toString(),
  )
  const help = await $`./dist/__scaffold_cli__ --help`.cwd(DIR).nothrow().quiet()
  ok(
    "binary --help lists the commands",
    help.exitCode === 0 &&
      ["login", "logout", "whoami"].every((c) => help.stdout.toString().includes(c)),
  )
  const plain = await $`./dist/__scaffold_cli__ whoami`
    .cwd(DIR)
    .env({ ...process.env, HOME: DIR, XDG_CONFIG_HOME: DIR, NO_COLOR: "1" })
    .nothrow()
    .quiet()
  ok(
    "whoami signed out: error, exit 1, no colour codes",
    plain.exitCode === 1 &&
      plain.stderr.toString().includes("Not signed in") &&
      !plain.stderr.toString().includes("\x1b"),
    plain.stderr.toString(),
  )
} catch (err) {
  ok("scaffold-cli run completed", false, String(err))
} finally {
  rmSync(DIR, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
