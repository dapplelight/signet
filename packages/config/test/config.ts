/**
 * Installs the packed tarball into a consumer OUTSIDE the monorepo, extends the
 * Biome preset and each tsconfig by package name, and runs the real tools.
 *
 * A preset that does not resolve fails loudly, but one that resolves and is
 * then ignored does not: Biome and tsc both fall back to their defaults. So
 * every check pairs "clean code passes" with "a violation of a setting that is
 * NOT the tool's default fails". Semicolons ("asNeeded"), line width (100) and
 * strict mode are all non-defaults.
 *
 * Installing the tarball, not linking the directory, also proves `files`: a
 * config missing from the package is missing here too.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { $ } from "bun"

const PKG = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const ROOT = join(PKG, "../..")
const BIOME = join(ROOT, "node_modules/.bin/biome")
const TSC = join(ROOT, "node_modules/.bin/tsc")

// packages/config/biome.json is the preset itself, so Biome treats it as this
// directory's nested config: the root's test-file overrides do not reach here.
let pass = 0
let fail = 0
const ok = (n: string, c: boolean, d = "") => {
  if (c) {
    pass++
    console.log("  PASS", n)
  } else {
    fail++
    console.log("  FAIL", n, d)
  }
}
const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
const run = async (cmd: string[], cwd: string) => {
  const r = await $`${cmd}`.cwd(cwd).nothrow().quiet()
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }
}

const TMP = mkdtempSync(join(tmpdir(), "signet-config-"))
try {
  // ── The tarball ships the configs and nothing else ─────────────────────────
  const tgz = (await $`npm pack ${PKG} --silent`.cwd(TMP).quiet().text()).trim()
  const listed = (await $`tar -tzf ${tgz}`.cwd(TMP).quiet().text()).split("\n").filter(Boolean)
  for (const f of [
    "biome.json",
    "tsconfig/base.json",
    "tsconfig/react.json",
    "tsconfig/worker.json",
  ])
    ok(`tarball ships ${f}`, listed.includes(`package/${f}`), listed.join(" "))
  ok(
    "tarball ships no tests or local tsconfig",
    !listed.some((f) => f.startsWith("package/test/") || f === "package/tsconfig.json"),
    listed.join(" "),
  )

  // A root config above the consumer. The preset carries `"root": false` so
  // Signet's own lint accepts packages/config/biome.json as a nested config.
  // Checked below: that must not leak into the consumer's config.
  const OUTER = join(TMP, "outer")
  write(
    join(OUTER, "biome.json"),
    '{ "formatter": { "enabled": false }, "linter": { "enabled": false } }\n',
  )
  const APP = join(OUTER, "app")
  write(
    join(APP, "package.json"),
    JSON.stringify({
      name: "consumer",
      private: true,
      type: "module",
      devDependencies: { "@dapplelight/signet-config": `file:${join(TMP, tgz)}` },
    }),
  )
  await $`npm install --no-audit --no-fund --silent`.cwd(APP).quiet()
  const installed = readdirSync(join(APP, "node_modules/@dapplelight/signet-config"))
  ok("installs via file:", installed.includes("biome.json"), installed.join(","))

  // ── Biome ──────────────────────────────────────────────────────────────────
  write(join(APP, ".gitignore"), "node_modules\n") // the preset turns on vcs.useIgnoreFile
  write(join(APP, "biome.json"), '{ "extends": ["@dapplelight/signet-config/biome"] }\n')
  // 90 columns: over Biome's default of 80, under the preset's 100.
  const wide = `export const wide = "${"x".repeat(90 - 'export const wide = ""'.length)}"`
  ok("sample line is 90 columns", wide.length === 90)
  write(join(APP, "src/clean.ts"), `export const greeting = "hi"\n${wide}\n`)
  let r = await run([BIOME, "check", "biome.json", "src/clean.ts"], APP)
  ok("biome: house-style code passes (no semicolons, 90 columns)", r.code === 0, r.out)

  write(join(APP, "src/semi.ts"), "export const a = 1;\n")
  r = await run([BIOME, "check", "src/semi.ts"], APP)
  ok("biome: a semicolon is flagged", r.code !== 0 && r.out.includes("semi.ts"), r.out)

  write(join(APP, "src/quotes.ts"), "export const b = 'x'\n")
  r = await run([BIOME, "check", "src/quotes.ts"], APP)
  ok("biome: single quotes are flagged", r.code !== 0 && r.out.includes("quotes.ts"), r.out)

  // Run from the outer directory, Biome discovers the consumer's config as a
  // nested one. It must still be a root config (a consumer's `root` is its own,
  // not the preset's), which Biome reports as a second root. Had `"root": false`
  // been inherited, the consumer would silently merge into whatever config sits
  // above it.
  r = await run([BIOME, "check", "."], OUTER)
  ok(
    "biome: the preset's root:false is not inherited",
    r.out.includes("nested root configuration"),
    r.out,
  )

  // The same file without the preset: Biome's defaults demand the semicolon,
  // so the clean sample fails. Proves the pass above came from the preset.
  write(join(APP, "biome.json"), "{}\n")
  r = await run([BIOME, "check", "src/clean.ts"], APP)
  ok("biome: without the preset the clean sample fails", r.code !== 0, r.out)
  write(join(APP, "biome.json"), '{ "extends": ["@dapplelight/signet-config/biome.json"] }\n')
  r = await run([BIOME, "check", "biome.json", "src/clean.ts"], APP)
  ok("biome: the ./biome.json export resolves too", r.code === 0, r.out)

  // ── TypeScript ─────────────────────────────────────────────────────────────
  const implicitAny = "export function id(x) {\n  return x\n}\n"

  for (const base of ["base", "react", "worker"] as const) {
    const dir = join(APP, `ts-${base}`)
    const tsconfig: Record<string, unknown> = {
      extends: `@dapplelight/signet-config/tsconfig/${base}.json`,
      include: ["src"],
    }
    if (base === "react") {
      // `paths` with no baseUrl: TypeScript 7 removed baseUrl.
      tsconfig.compilerOptions = { paths: { "@/*": ["./src/*"] } }
      // Stand-in for @types/react, so the test needs no network beyond npm pack.
      write(
        join(dir, "src/jsx.d.ts"),
        `declare module "react/jsx-runtime" {
  export namespace JSX {
    interface Element {}
    interface IntrinsicElements { [tag: string]: Record<string, unknown> }
  }
  export const jsx: unknown, jsxs: unknown, Fragment: unknown
}
`,
      )
      write(join(dir, "src/title.ts"), 'export const title = "Signet"\n')
      write(
        join(dir, "src/app.tsx"),
        'import { title } from "@/title"\n\ndocument.title = title\nexport const App = () => <h1>{title}</h1>\n',
      )
    } else {
      write(join(dir, "src/ok.ts"), "export const double = (n: number) => n * 2\n")
    }
    write(join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2))

    r = await run([TSC, "-p", dir, "--showConfig"], APP)
    const shown = r.out
    ok(
      `tsc ${base}: extends resolves (strict, bundler)`,
      r.code === 0 && /"strict": true/.test(shown) && /"moduleResolution": "bundler"/i.test(shown),
      shown,
    )
    ok(`tsc ${base}: no baseUrl`, !shown.includes("baseUrl"), shown)

    r = await run([TSC, "--noEmit", "-p", dir], APP)
    ok(`tsc ${base}: clean sample typechecks`, r.code === 0, r.out)

    write(join(dir, "src/any.ts"), implicitAny)
    r = await run([TSC, "--noEmit", "-p", dir], APP)
    ok(
      `tsc ${base}: strict catches an implicit any`,
      r.code !== 0 && r.out.includes("TS7006"),
      r.out,
    )
    rmSync(join(dir, "src/any.ts"))

    if (base !== "react") {
      // No DOM outside react.json: a Worker has no `document`.
      write(join(dir, "src/dom.ts"), "export const t = document.title\n")
      r = await run([TSC, "--noEmit", "-p", dir], APP)
      ok(`tsc ${base}: no DOM lib`, r.code !== 0 && /document/.test(r.out), r.out)
      rmSync(join(dir, "src/dom.ts"))
    }
  }

  // ── The preset is the house style, not a fork of it ────────────────────────
  // The scaffold templates cannot extend the preset until it is on npm, so
  // they carry a copy. Fail when the copies drift.
  const preset = JSON.parse(readFileSync(join(PKG, "biome.json"), "utf8"))
  delete preset.root
  for (const t of ["template", "template-api"]) {
    const copy = JSON.parse(
      readFileSync(join(ROOT, `packages/create-signet-app/${t}/biome.json`), "utf8"),
    )
    // Which files a project lints is its own business (the web template skips
    // TanStack Router's generated routeTree.gen.ts); the rules and formatting
    // are the house style that must not drift.
    delete copy.files?.includes
    ok(
      `preset matches create-signet-app/${t}/biome.json`,
      JSON.stringify(copy) === JSON.stringify(preset),
    )
  }
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
