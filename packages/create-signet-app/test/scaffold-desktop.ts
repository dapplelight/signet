/**
 * The desktop (Tauri v2) template, OUTSIDE the monorepo: scaffold, install
 * Signet's packages from local packs, then lint, typecheck, run the app's
 * tests and `vite build` the webview, and check the Tauri half by shape: the
 * config and capabilities are valid JSON that agree with each other, the Rust
 * files exist with the app's name in them, and no placeholder is left.
 *
 * Does NOT run cargo: Rust is verified by the template's own CI (macOS, Windows,
 * Linux), not here.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const CLI = `${ROOT}/packages/create-signet-app/src/index.ts`
const PACKAGES = ["lib", "tokens", "ui"]
const DIR = join("/tmp", "scaffold-desktop")
const ID = "scaffolddesktop" // appId("scaffold-desktop")

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const out = (r: { stdout: Buffer; stderr: Buffer }) =>
  (r.stdout.toString() + r.stderr.toString()).slice(-1500)
const read = (f: string) => readFileSync(join(DIR, f), "utf8")

function files(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (["node_modules", "dist", ".git"].includes(e.name)) return []
    const full = join(dir, e.name)
    return e.isDirectory() ? files(full, base) : [full.slice(base.length + 1)]
  })
}

rmSync(DIR, { recursive: true, force: true })
try {
  await $`bun run ${CLI} ${DIR} --template desktop --theme cinematic`.cwd("/tmp").quiet()
  const all = files(DIR)

  ok(
    "ships the webview, the Rust half and the CI workflow",
    [
      "src/App.tsx",
      "src/lib/auth.ts",
      "src/lib/pkce.ts",
      "src-tauri/Cargo.toml",
      "src-tauri/build.rs",
      "src-tauri/src/main.rs",
      "src-tauri/tauri.conf.json",
      "src-tauri/capabilities/default.json",
      "src-tauri/icons/icon.png",
      "src-tauri/icons/icon.ico",
      "src-tauri/icons/icon.icns",
      ".github/workflows/ci.yml",
      ".gitignore",
    ].every((f) => all.includes(f)),
  )
  ok("no _gitignore or _github left", !all.some((f) => f.startsWith("_")))
  const left = all.filter(
    (f) => !/\.(png|ico|icns)$/.test(f) && /__(APP_NAME|APP_ID|THEME|PM_\w+)__/.test(read(f)),
  )
  ok("no placeholders left", left.length === 0, left.join(","))
  ok("cinematic theme selected", read("src/app.css").includes("cinematic.css"))

  const conf = JSON.parse(read("src-tauri/tauri.conf.json"))
  const cap = JSON.parse(read("src-tauri/capabilities/default.json"))
  ok(
    "tauri.conf.json: app name, derived placeholder identifier, dev and build commands",
    conf.productName === "scaffold-desktop" &&
      conf.identifier === `com.example.${ID}` &&
      conf.build.beforeDevCommand === "bun run dev" &&
      conf.build.beforeBuildCommand === "bun run build" &&
      conf.build.frontendDist === "../dist",
    JSON.stringify(conf.identifier),
  )
  const labels: string[] = conf.app.windows.map((w: { label: string }) => w.label)
  ok(
    "capabilities: valid, least privilege, only for windows that exist",
    cap.windows.every((w: string) => labels.includes(w)) &&
      labels.includes("tray") &&
      cap.permissions.every(
        (p: string | { identifier: string }) =>
          !/^(fs|shell|http|process):/.test(typeof p === "string" ? p : p.identifier),
      ) &&
      cap.permissions.some(
        (p: string | { identifier: string; allow?: unknown[] }) =>
          typeof p !== "string" && p.identifier === "opener:allow-open-url" && !!p.allow?.length,
      ),
  )
  ok(
    "CSP is set",
    typeof conf.app.security.csp === "string" &&
      conf.app.security.csp.includes("default-src 'self'"),
  )
  const cargo = read("src-tauri/Cargo.toml")
  ok(
    "Cargo.toml: crate named from the app, official plugins only",
    cargo.includes(`name = "${ID}"`) &&
      cargo.includes('description = "scaffold-desktop"') &&
      cargo.includes("tauri-plugin-opener") &&
      cargo.includes("tauri-plugin-store") &&
      !/tauri-plugin-(oauth|localhost)/.test(cargo),
  )
  ok(
    "main.rs: tray, loopback listener command, plugins registered",
    [
      "TrayIconBuilder",
      "listen_for_callback",
      "tauri_plugin_opener::init()",
      "tauri_plugin_store",
    ].every((s) => read("src-tauri/src/main.rs").includes(s)),
  )
  const auth = read("src/lib/auth.ts")
  ok(
    "sign-in: createSession + tauriStorage, bearer client without cookies, S256 PKCE",
    auth.includes("tauriStorage(") &&
      auth.includes("tokenEndpointRefresh(") &&
      auth.includes('credentials: "omit"') &&
      auth.includes('code_challenge_method: "S256"') &&
      auth.includes(`"${ID}-desktop"`),
  )
  const pkg = JSON.parse(read("package.json"))
  const ci = read(".github/workflows/ci.yml")
  ok(
    "CI builds on macos, windows and ubuntu, and each bun script it runs exists",
    ["macos-latest", "windows-latest", "ubuntu-latest"].every((o) => ci.includes(o)) &&
      [...ci.matchAll(/bun run ([\w:-]+)/g)].every((m) => m[1] && m[1] in pkg.scripts) &&
      ci.includes("bunx tauri build"),
  )

  for (const p of PACKAGES) await $`npm pack ${ROOT}/packages/${p}`.cwd(DIR).quiet()
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".tgz"))) {
    const name = `@dapplelight/${f.replace(/^dapplelight-/, "").replace(/-\d+\.\d+\.\d+\.tgz$/, "")}`
    pkg.dependencies[name] = `file:./${f}`
  }
  writeFileSync(join(DIR, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`)

  const install = await $`bun install`.cwd(DIR).nothrow().quiet()
  ok("installs", install.exitCode === 0, out(install))
  const tc = await $`bun run typecheck`.cwd(DIR).nothrow().quiet()
  ok("typechecks", tc.exitCode === 0, out(tc))
  const lint = await $`bun run lint`.cwd(DIR).nothrow().quiet()
  ok("lints clean", lint.exitCode === 0, out(lint))
  const test = await $`bun run test`.cwd(DIR).nothrow().quiet()
  ok("PKCE test passes (RFC 7636 vector)", test.exitCode === 0, out(test))
  const build = await $`bun run build`.cwd(DIR).nothrow().quiet()
  ok(
    "vite build of the webview",
    build.exitCode === 0 && existsSync(join(DIR, "dist/index.html")),
    out(build),
  )
} catch (err) {
  ok("desktop scaffold run completed", false, String(err))
} finally {
  rmSync(DIR, { recursive: true, force: true })
}

// --- npm: the CI's commands and the README follow the package manager ------

const NPM = join("/tmp", "scaffold-desktop-npm")
rmSync(NPM, { recursive: true, force: true })
try {
  await $`bun run ${CLI} ${NPM} --template desktop --pm npm`.cwd("/tmp").quiet()
  const ci = readFileSync(join(NPM, ".github/workflows/ci.yml"), "utf8")
  ok(
    "--pm npm: both jobs install with npm, tauri runs through npx",
    ci.split("npm ci").length === 3 && ci.includes("npx tauri build") && !ci.includes("bun run"),
    ci,
  )
  ok(
    "--pm npm: tauri.conf.json runs npm scripts",
    readFileSync(join(NPM, "src-tauri/tauri.conf.json"), "utf8").includes('"npm run dev"'),
  )
} finally {
  rmSync(NPM, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
