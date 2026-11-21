/**
 * The mobile starter, OUTSIDE the monorepo: scaffold, check the shape (two
 * projects, no placeholders, the scheme and the EAS profiles), install
 * Signet's packages from local packs, then lint, typecheck and test both
 * halves: server/ with bun test, mobile/ with jest-expo.
 *
 * Does NOT build a native binary: that is EAS's job, from the app's README.
 */

import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const CLI = `${ROOT}/packages/create-signet-app/src/index.ts`
const PACKAGES = ["config", "db", "lib", "server", "tokens"]
const DIR = join("/tmp", "scaffold-mobile")
const ID = "scaffoldmobile" // appId("scaffold-mobile")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const out = (r: { stdout: Buffer; stderr: Buffer }) =>
  (r.stdout.toString() + r.stderr.toString()).slice(-2000)
const read = (f: string) => readFileSync(join(DIR, f), "utf8")

function files(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (["node_modules", "dist", ".git"].includes(e.name)) return []
    const full = join(dir, e.name)
    return e.isDirectory() ? files(full, base) : [full.slice(base.length + 1)]
  })
}

/** Point each @dapplelight dependency of `dir` at a local pack of this checkout. */
async function installFromPacks(dir: string) {
  const path = join(dir, "package.json")
  const pkg = JSON.parse(readFileSync(path, "utf8"))
  for (const p of PACKAGES) {
    const name = `@dapplelight/signet-${p}`
    const field = ["dependencies", "devDependencies"].find((k) => pkg[k]?.[name])
    if (!field) continue
    const tgz = (await $`npm pack ${ROOT}/packages/${p}`.cwd(dir).quiet()).text().trim()
    pkg[field][name] = `file:./${tgz}`
  }
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
}

rmSync(DIR, { recursive: true, force: true })
try {
  await $`bun run ${CLI} ${DIR} --starter mobile --theme cinematic`.cwd("/tmp").quiet()
  const all = files(DIR)

  ok(
    "ships both projects, the README and the CI workflow",
    [
      "README.md",
      ".gitignore",
      ".github/workflows/ci.yml",
      "server/package.json",
      "server/.env",
      "server/api/routes/mobile.ts",
      "server/test/mobile.test.ts",
      "mobile/package.json",
      "mobile/.gitignore",
      "mobile/app.config.ts",
      "mobile/eas.json",
      "mobile/assets/icon.png",
      "mobile/assets/splash-icon.png",
      "mobile/src/app/_layout.tsx",
      "mobile/src/app/(auth)/sign-in.tsx",
      "mobile/src/app/(auth)/verify.tsx",
      "mobile/src/app/(app)/_layout.tsx",
      "mobile/src/app/(app)/index.tsx",
      "mobile/src/app/(app)/devices/index.tsx",
      "mobile/src/app/(app)/devices/[id].tsx",
      "mobile/src/app/(app)/settings.tsx",
      "mobile/src/__tests__/auth-gate.test.tsx",
    ].every((f) => all.includes(f)),
    all.join(","),
  )
  ok(
    "no _gitignore, _github or web half left",
    !all.some((f) => /(^|\/)_(gitignore|github)/.test(f)) &&
      !all.some((f) => f.startsWith("src/") || f.startsWith("server/src/")),
  )
  const left = all.filter(
    (f) => !/\.(png|tgz)$/.test(f) && /__(APP_NAME|APP_ID|THEME|PM_\w+)__/.test(read(f)),
  )
  ok("no placeholders left", left.length === 0, left.join(","))
  ok("cinematic theme selected", read("mobile/src/lib/theme.tsx").includes('"cinematic"'))

  const config = read("mobile/app.config.ts")
  ok(
    "app.config: scheme, ids, typed routes and expo-updates from the app's name",
    config.includes(`scheme: "${ID}"`) &&
      config.includes(`"com.example.${ID}"`) &&
      config.includes("typedRoutes: true") &&
      config.includes("expo-notifications") &&
      config.includes("updates"),
  )
  const eas = JSON.parse(read("mobile/eas.json"))
  ok(
    "eas.json: development, preview and production",
    ["development", "preview", "production"].every((p) => p in eas.build),
  )
  const mpkg = JSON.parse(read("mobile/package.json"))
  const spkg = JSON.parse(read("server/package.json"))
  ok(
    "package names follow the app",
    mpkg.name === "scaffold-mobile-mobile" && spkg.name === "scaffold-mobile-server",
  )
  // expo-dev-client is installed, so a plain `expo start` waits for a
  // development build that a first run does not have.
  ok(
    "start opens Expo Go; start:dev is for the development build",
    mpkg.scripts.start.includes("--go") && mpkg.scripts["start:dev"].includes("--dev-client"),
  )
  // Expo Go may lack the ExpoCrypto native module; importing it at the top
  // crashed the app at launch.
  ok(
    "the crypto polyfill tolerates a missing expo-crypto",
    !/^import .* from "expo-crypto"/m.test(read("mobile/src/lib/polyfills.ts")),
  )
  // The server names sessions after the User-Agent; React Native's is "okhttp".
  ok("the API client names this phone", read("mobile/src/lib/api.ts").includes('"User-Agent"'))
  ok("the server reads EXPO_ACCESS_TOKEN", read("server/.env").includes("EXPO_ACCESS_TOKEN="))
  const ci = read(".github/workflows/ci.yml")
  ok(
    "CI runs each half's scripts, and each exists",
    [...ci.matchAll(/bun run ([\w:-]+)/g)].every(
      (m) => m[1] && (m[1] in mpkg.scripts || m[1] in spkg.scripts),
    ) && ci.includes("working-directory: mobile"),
  )

  for (const half of ["server", "mobile"]) {
    const dir = join(DIR, half)
    await installFromPacks(dir)
    const install = await $`bun install`.cwd(dir).nothrow().quiet()
    ok(`${half}: installs`, install.exitCode === 0, out(install))
    for (const script of ["lint", "typecheck", "test"]) {
      const r = await $`bun run ${script}`.cwd(dir).nothrow().quiet()
      ok(`${half}: ${script}`, r.exitCode === 0, out(r))
    }
  }
} catch (err) {
  ok("mobile scaffold run completed", false, String(err))
} finally {
  rmSync(DIR, { recursive: true, force: true })
}

// --- refusals: a web half or an unsupported package manager ---------------

for (const [args, why] of [
  [["--starter", "mobile", "--ui"], "--ui with the mobile starter"],
  [["--starter", "mobile", "--pm", "pnpm"], "--pm pnpm with the mobile starter"],
] as const) {
  const dir = join("/tmp", "scaffold-mobile-refused")
  rmSync(dir, { recursive: true, force: true })
  const r = await $`bun run ${CLI} ${dir} ${args}`.cwd("/tmp").nothrow().quiet()
  ok(`refuses ${why}`, r.exitCode !== 0, out(r))
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
