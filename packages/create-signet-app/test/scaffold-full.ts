/**
 * The full template, end to end, OUTSIDE the monorepo: scaffold with
 * `--theme finance`, install Signet's packages from local packs, then lint,
 * typecheck, run the app's tests, build, and drive sign-in → admin → billing
 * in headless Chromium (the app's own e2e/smoke.spec.ts, fake SMS and billing,
 * no keys). Then a `--no-mcp --pm pnpm` app installs with pnpm, typechecks,
 * tests and builds; and `--pm npm` rewrites CI for npm.
 *
 * Needs bun, pnpm and Playwright's Chromium (`bunx playwright install
 * chromium`; the test runs it, so a cached browser costs nothing).
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const CLI = `${ROOT}/packages/create-signet-app/src/index.ts`
const CI = ".github/workflows/ci.yml"
// Every Signet package the full app uses. signet-db and signet-payments are not
// on npm yet, so all of them install from packs of this checkout.
const PACKAGES = ["lib", "tokens", "ui", "server", "db", "payments"]

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const out = (r: { stdout: Buffer; stderr: Buffer }) =>
  (r.stdout.toString() + r.stderr.toString()).slice(-1500)

/** Files under dir, minus installs and builds. */
function files(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (["node_modules", "dist", ".git"].includes(e.name)) return []
    const full = join(dir, e.name)
    return e.isDirectory() ? files(full, base) : [full.slice(base.length + 1)]
  })
}

/** Pack the local Signet packages into dir and point the app's deps at them. */
async function installFromLocalPacks(dir: string) {
  for (const p of PACKAGES) await $`npm pack ${ROOT}/packages/${p}`.cwd(dir).quiet()
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".tgz"))) {
    const name = `@dapplelight/${f.replace(/^dapplelight-/, "").replace(/-\d+\.\d+\.\d+\.tgz$/, "")}`
    pkg.dependencies[name] = `file:./${f}`
  }
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`)
}

// --- bun, finance, MCP on: everything, including the browser ---------------

const DIR = join("/tmp", "__scaffold_full__")
rmSync(DIR, { recursive: true, force: true })
try {
  await $`bun run ${CLI} ${DIR} --template full --theme finance`.cwd("/tmp").quiet()
  const all = files(DIR)
  const pkg = JSON.parse(readFileSync(join(DIR, "package.json"), "utf8"))
  const appTs = readFileSync(join(DIR, "api/app.ts"), "utf8")

  ok(
    "web and api in one project, with migrations, tests and the smoke test",
    [
      "src/routes/login.tsx",
      "src/routes/_app/account.tsx",
      "src/routes/_app/notifications.tsx",
      "src/routes/_app/privacy.tsx",
      "src/routes/_app/billing.tsx",
      "src/routes/_app/admin.tsx",
      "src/lib/api.ts",
      "api/app.ts",
      "api/db/schema.ts",
      "drizzle/0000_init.sql",
      "drizzle/meta/_journal.json",
      "test/api.test.ts",
      "e2e/smoke.spec.ts",
      "README.md",
    ].every((f) => all.includes(f)),
  )
  ok(
    "no template leftovers: placeholders, _gitignore, _github, _mcp",
    !all.some((f) => /^_|\/_mcp\//.test(f)) &&
      all.every((f) => {
        const t = readFileSync(join(DIR, f), "utf8")
        return !/__(APP_NAME|THEME|PM_RUN|PM_INSTALL|PM_X)__/.test(t)
      }),
    all
      .filter((f) => /__(APP_NAME|THEME|PM_\w+)__/.test(readFileSync(join(DIR, f), "utf8")))
      .join(","),
  )
  const envFile = readFileSync(join(DIR, ".env"), "utf8")
  ok(
    "an env file with fresh secrets, and gitignored",
    /^SESSION_SECRET=.{40,}$/m.test(envFile) &&
      /^OTP_SECRET=.{40,}$/m.test(envFile) &&
      readFileSync(join(DIR, ".gitignore"), "utf8").split("\n").includes(".env"),
  )
  ok(
    "the typed client imports the API's type, not its code",
    readFileSync(join(DIR, "src/lib/api.ts"), "utf8").includes(
      'import type { AppType } from "../../api/app.ts"',
    ),
  )
  ok(
    "finance theme selected",
    readFileSync(join(DIR, "src/app.css"), "utf8").includes("finance.css"),
  )
  ok(
    "MCP by default: the dependency, the mount, its test",
    !!pkg.dependencies["@modelcontextprotocol/server"] &&
      appTs.includes('mountMcp(app, "/mcp"') &&
      !appTs.includes("mcp:begin") &&
      all.includes("test/mcp.test.ts"),
  )
  const ciScripts = [...readFileSync(join(DIR, CI), "utf8").matchAll(/bun run ([\w:-]+)/g)].map(
    (m) => m[1],
  )
  ok(
    "CI runs lint, typecheck, test and build, and each script exists",
    ["lint", "typecheck", "test", "build"].every((s) => ciScripts.includes(s)) &&
      ciScripts.every((s) => s && s in pkg.scripts),
    ciScripts.join(","),
  )
  ok("README speaks bun", readFileSync(join(DIR, "README.md"), "utf8").includes("bun run dev"))

  await installFromLocalPacks(DIR)
  const install = await $`bun install`.cwd(DIR).nothrow().quiet()
  ok("installs", install.exitCode === 0, out(install))
  const tc = await $`bun run typecheck`.cwd(DIR).nothrow().quiet()
  ok("typechecks, client against server types", tc.exitCode === 0, out(tc))
  const lint = await $`bun run lint`.cwd(DIR).nothrow().quiet()
  ok("lints clean", lint.exitCode === 0, out(lint))
  const test = await $`bun run test`.cwd(DIR).nothrow().quiet()
  ok("app tests pass (routes, API flows, MCP)", test.exitCode === 0, out(test))
  const build = await $`bun run build`.cwd(DIR).nothrow().quiet()
  ok("builds", build.exitCode === 0 && existsSync(join(DIR, "dist/index.html")), out(build))
  const css = readdirSync(join(DIR, "dist/assets"))
    .filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(join(DIR, "dist/assets", f), "utf8"))
    .join("")
  ok(
    "bundle carries the finance tokens and the screens' classes",
    css.includes("--cat-needs:#2563eb") && css.includes("data-slot"),
  )

  await $`bunx playwright install chromium`.cwd(DIR).quiet()
  const e2e = await $`bun run test:e2e`.cwd(DIR).nothrow().quiet()
  ok("browser: sign in → admin → billing → inbox, account, privacy", e2e.exitCode === 0, out(e2e))
} catch (err) {
  ok("full scaffold run completed", false, String(err))
} finally {
  rmSync(DIR, { recursive: true, force: true })
}

// --- pnpm, no MCP: installs and builds with pnpm's strict layout -----------

const PNPM = join("/tmp", "__scaffold_full_pnpm__")
rmSync(PNPM, { recursive: true, force: true })
try {
  await $`bun run ${CLI} ${PNPM} --template full --no-mcp --pm pnpm`.cwd("/tmp").quiet()
  const pkg = JSON.parse(readFileSync(join(PNPM, "package.json"), "utf8"))
  const appTs = readFileSync(join(PNPM, "api/app.ts"), "utf8")
  const envTs = readFileSync(join(PNPM, "api/env.ts"), "utf8")
  ok(
    "--no-mcp: no MCP dependency, mount, setting or test",
    !pkg.dependencies["@modelcontextprotocol/server"] &&
      !/mcp/i.test(appTs) &&
      !/mcp/i.test(envTs) &&
      !existsSync(join(PNPM, "test/mcp.test.ts")),
  )
  const ci = readFileSync(join(PNPM, CI), "utf8")
  ok(
    "--pm pnpm: CI installs frozen and runs scripts with pnpm, bun kept for tests",
    ci.includes("pnpm/action-setup") &&
      ci.includes("pnpm install --frozen-lockfile") &&
      ci.includes("pnpm run test") &&
      !ci.includes("bun run") &&
      ci.includes("oven-sh/setup-bun"),
  )
  ok("README speaks pnpm", readFileSync(join(PNPM, "README.md"), "utf8").includes("pnpm run dev"))

  await installFromLocalPacks(PNPM)
  const install = await $`pnpm install`.cwd(PNPM).nothrow().quiet()
  ok("pnpm installs", install.exitCode === 0, out(install))
  const tc = await $`pnpm run typecheck`.cwd(PNPM).nothrow().quiet()
  ok("pnpm: typechecks (no undeclared imports)", tc.exitCode === 0, out(tc))
  const test = await $`pnpm run test`.cwd(PNPM).nothrow().quiet()
  ok("pnpm: app tests pass", test.exitCode === 0, out(test))
  const build = await $`pnpm run build`.cwd(PNPM).nothrow().quiet()
  ok("pnpm: builds", build.exitCode === 0, out(build))
} catch (err) {
  ok("pnpm scaffold run completed", false, String(err))
} finally {
  rmSync(PNPM, { recursive: true, force: true })
}

// --- npm: commands only ------------------------------------------------------

const NPM = join("/tmp", "__scaffold_web_npm__")
rmSync(NPM, { recursive: true, force: true })
try {
  await $`bun run ${CLI} ${NPM} --pm npm`.cwd("/tmp").quiet()
  const ci = readFileSync(join(NPM, CI), "utf8")
  ok(
    "--pm npm: CI runs npm ci and npm run, with node set up",
    ci.includes("npm ci") &&
      ci.includes("npm run build") &&
      ci.includes("actions/setup-node") &&
      !ci.includes("bun run"),
  )
} finally {
  rmSync(NPM, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
