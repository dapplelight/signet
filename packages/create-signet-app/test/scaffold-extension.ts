/**
 * Scaffolds the extension template OUTSIDE the monorepo, installs Signet's
 * packages from local packs, then typechecks, tests, lints and builds it, and
 * asserts dist/ is a loadable MV3 extension: manifest, both pages and a service
 * worker that never touches the DOM (a worker has no window or document, so
 * one reference there is a crash at the first message).
 */

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const NAME = "scaffold-ext-test"
const DIR = join("/tmp", NAME)

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const out = (r: { stdout: Buffer; stderr: Buffer }) =>
  (r.stdout.toString() + r.stderr.toString()).slice(-800)

rmSync(DIR, { recursive: true, force: true })
try {
  await $`bun run ${ROOT}/packages/create-signet-app/src/index.ts ${DIR} --template extension --theme cinematic`
    .cwd("/tmp")
    .quiet()
  const files = readdirSync(DIR)
  ok(
    "renames _gitignore and _github",
    files.includes(".gitignore") && existsSync(join(DIR, ".github/workflows/ci.yml")),
  )
  const pkg = JSON.parse(readFileSync(join(DIR, "package.json"), "utf8"))
  ok(
    "no router, query or toast deps; no extension plugin",
    !pkg.dependencies["@tanstack/react-router"] &&
      !pkg.dependencies.sonner &&
      !Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => d.includes("crx")),
  )
  const all = ["package.json", "public/manifest.json", "README.md", "src/config.ts", "popup.html"]
    .map((f) => readFileSync(join(DIR, f), "utf8"))
    .join("\n")
  ok("no placeholders remain", !all.includes("__APP_NAME__") && !all.includes("__PM_"))

  for (const p of ["lib", "tokens", "ui"]) await $`npm pack ${ROOT}/packages/${p}`.cwd(DIR).quiet()
  await $`sh -c 'npm install ./dapplelight-signet-*.tgz'`.cwd(DIR).quiet()
  await $`npm install`.cwd(DIR).quiet()

  const tc = await $`bun run typecheck`.cwd(DIR).nothrow().quiet()
  ok("typechecks", tc.exitCode === 0, out(tc))
  const test = await $`bun run test`.cwd(DIR).nothrow().quiet()
  ok("app tests pass (PKCE vector)", test.exitCode === 0, out(test))
  const lint = await $`bunx biome check .`.cwd(DIR).nothrow().quiet()
  ok("biome lints clean", lint.exitCode === 0, out(lint))
  const build = await $`bun run build`.cwd(DIR).nothrow().quiet()
  ok("builds", build.exitCode === 0, out(build))

  const dist = join(DIR, "dist")
  const has = (f: string) => existsSync(join(dist, f))
  ok(
    "dist has manifest, popup, options and the service worker",
    ["manifest.json", "popup.html", "options.html", "background.js", "theme-init.js"].every(has),
    readdirSync(dist).join(","),
  )

  const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"))
  ok("manifest is MV3", manifest.manifest_version === 3)
  ok(
    "manifest asks for storage and identity",
    ["storage", "identity"].every((p) => manifest.permissions?.includes(p)),
  )
  ok(
    "manifest points at files that exist",
    has(manifest.background?.service_worker) &&
      has(manifest.action?.default_popup) &&
      has(manifest.options_ui?.page),
  )
  ok(
    "manifest has a name and version",
    !!manifest.name && /^\d+(\.\d+){0,3}$/.test(manifest.version),
  )

  const worker = readFileSync(join(dist, "background.js"), "utf8")
  ok(
    "service worker bundle references no window or document",
    !/\b(window|document)\b/.test(worker),
  )
  // The worker may import shared chunks; none of those may touch the DOM either.
  const chunks = [...worker.matchAll(/from\s*["']\.\/([^"']+)["']/g)].map((m) => m[1])
  const code = [worker, ...chunks.map((c) => readFileSync(join(dist, c), "utf8"))].join("\n")
  ok(
    "service worker's imported chunks reference no window or document",
    chunks.every((c) => !/\b(window|document)\b/.test(readFileSync(join(dist, c), "utf8"))),
    chunks.join(","),
  )
  ok("service worker bundle handles sign-in", code.includes("launchWebAuthFlow"))

  // MV3's default CSP bans inline scripts; a page that has one loads but never runs it.
  for (const page of ["popup.html", "options.html"]) {
    const html = readFileSync(join(dist, page), "utf8")
    ok(`${page} has no inline script`, !/<script(?![^>]*\bsrc=)[^>]*>/.test(html))
  }

  const assets = readdirSync(join(dist, "assets"))
  const css = readFileSync(join(dist, "assets", assets.find((f) => f.endsWith(".css"))!), "utf8")
  ok("bundle carries the cinematic theme", css.includes("--primary:#6d28d9"))
  ok("bundle contains signet-ui component classes", css.includes("data-slot"))
} finally {
  rmSync(DIR, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
