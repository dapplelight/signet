/**
 * Every package manager: for each one on this machine, the full starter and
 * the web platform are scaffolded with `--pm <it>`, installed with it (Signet's
 * packages from local packs), then typechecked and built through its own
 * script runner. A manager that is not installed is skipped with a note.
 *
 *   bun run test/scaffold-pm.ts [pm]
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const CLI = `${ROOT}/packages/create-signet-app/src/index.ts`
const PACKAGES = ["lib", "tokens", "ui", "server", "db", "payments"]
const TMP = join("/tmp", "__scaffold_pm__")
const APPS = { full: ["--starter", "full", "--no-mcp"], web: ["--platform", "web"] }

// How to install and run a script with each; yarn goes through corepack.
const MANAGERS = {
  bun: { probe: ["bun", "--version"], install: ["bun", "install"], run: ["bun", "run"] },
  npm: { probe: ["npm", "--version"], install: ["npm", "install"], run: ["npm", "run"] },
  pnpm: { probe: ["pnpm", "--version"], install: ["pnpm", "install"], run: ["pnpm", "run"] },
  yarn: {
    probe: ["corepack", "--version"],
    install: ["corepack", "yarn", "install"],
    run: ["corepack", "yarn", "run"],
  },
  // Deno skips versions under 24h old by default; the templates track the
  // latest ranges, so the test turns that off to not fail for a day per bump.
  deno: {
    probe: ["deno", "--version"],
    install: ["deno", "install", "--minimum-dependency-age=0"],
    run: ["deno", "task"],
  },
}
type Manager = keyof typeof MANAGERS

const only = process.argv[2] as Manager | undefined
let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const out = (r: { stdout: Buffer; stderr: Buffer }) =>
  (r.stdout.toString() + r.stderr.toString()).slice(-4000)
// CI on a public PR turns on yarn's hardened mode, which refuses to write the
// lockfile a fresh app needs; users installing locally never see it.
const env = {
  ...process.env,
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  YARN_ENABLE_HARDENED_MODE: "0",
  YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
}

rmSync(TMP, { recursive: true, force: true })
const PACKS = join(TMP, "packs")
mkdirSync(PACKS, { recursive: true })
await Promise.all(PACKAGES.map((p) => $`npm pack ${ROOT}/packages/${p}`.cwd(PACKS).quiet()))
const packs: Record<string, string> = Object.fromEntries(
  readdirSync(PACKS).map((f) => [
    `@dapplelight/${f.replace(/^dapplelight-/, "").replace(/-\d+\.\d+\.\d+\.tgz$/, "")}`,
    `file:${join(PACKS, f)}`,
  ]),
)

for (const [pm, m] of Object.entries(MANAGERS) as [Manager, (typeof MANAGERS)[Manager]][]) {
  if (only && only !== pm) continue
  const probe = await $`${m.probe}`.nothrow().quiet()
  if (probe.exitCode !== 0) {
    console.log(`\n${pm}: not installed here, skipped`)
    continue
  }
  // One app at a time, removed after: each install is a few hundred MB.
  for (const [app, args] of Object.entries(APPS)) {
    const label = `${pm} ${app}`
    console.log(`\n${label}`)
    const dir = join(TMP, `${pm}-${app}`)
    try {
      const made = await $`bun run ${CLI} ${dir} ${args} --pm ${pm}`.cwd(TMP).nothrow().quiet()
      ok(`${label}: scaffolds`, made.exitCode === 0, out(made))
      if (made.exitCode !== 0) continue
      const ci = readFileSync(join(dir, ".github/workflows/ci.yml"), "utf8")
      const run = pm === "deno" ? "deno task" : `${pm} run`
      ok(
        `${label}: README and CI speak ${pm}`,
        ci.includes(`${run} `) &&
          (app === "web" || readFileSync(join(dir, "README.md"), "utf8").includes(`${run} dev`)),
      )
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
      if (pm === "yarn") {
        // Yarn does not install peers: the app must list signet-ui's required ones.
        const ui = JSON.parse(readFileSync(`${ROOT}/packages/ui/package.json`, "utf8"))
        const missing = Object.keys(ui.peerDependencies).filter(
          (d) => !ui.peerDependenciesMeta?.[d]?.optional && !pkg.dependencies[d],
        )
        ok(`${label}: lists signet-ui's required peers`, missing.length === 0, missing.join(", "))
      }
      // Deno links a file: dependency instead of installing it (the packed
      // package then misses its own dependencies), so deno takes the unpacked
      // packages through deno.json's `links`, at their exact versions.
      const links: string[] = []
      for (const name of Object.keys(pkg.dependencies ?? {})) {
        const pack = packs[name]
        if (!pack) continue
        if (pm !== "deno") {
          pkg.dependencies[name] = pack
          continue
        }
        const unpacked = join(PACKS, name.replace("@dapplelight/", ""))
        mkdirSync(unpacked, { recursive: true })
        await $`tar xzf ${pack.slice(5)} -C ${unpacked}`.quiet()
        pkg.dependencies[name] = JSON.parse(
          readFileSync(join(unpacked, "package/package.json"), "utf8"),
        ).version
        links.push(join(unpacked, "package"))
      }
      if (links.length) writeFileSync(join(dir, "deno.json"), JSON.stringify({ links }))
      writeFileSync(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`)
      const install = await $`${m.install}`.cwd(dir).env(env).nothrow().quiet()
      ok(`${label}: installs`, install.exitCode === 0, out(install))
      if (install.exitCode !== 0) continue
      for (const script of ["typecheck", "build"]) {
        const r = await $`${m.run} ${script}`.cwd(dir).env(env).nothrow().quiet()
        ok(`${label}: ${script}`, r.exitCode === 0, out(r))
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
