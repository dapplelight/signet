/**
 * Scaffolds a real app, installs, builds and lints it, then asserts the chosen
 * theme reached the production CSS bundle.
 *
 * A generator that emits a non-building project is worthless, and this caught
 * two template bugs on first run: a missing `vite/client` type (so
 * `import.meta.env` failed typecheck) and an eslint preset that no longer
 * exists in eslint-plugin-react-hooks >= 5.2.
 */

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const NAME = "__scaffold_test__"
// Scaffold OUTSIDE the monorepo. Inside it, bun would link the local workspace
// packages and the test would pass even if the published deps were wrong —
// which is exactly the bug this now guards against.
const DIR = join("/tmp", NAME)
const CI = ".github/workflows/ci.yml"
/** Every `bun run <script>` in a workflow, so a renamed script fails here, not in CI. */
const ciRunScripts = (yml: string) => [...yml.matchAll(/bun run ([\w:-]+)/g)].map((m) => m[1])

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

rmSync(DIR, { recursive: true, force: true })
try {
  await $`bun run ${ROOT}/packages/create-signet-app/src/index.ts ${DIR} --theme cinematic`
    .cwd("/tmp")
    .quiet()
  ok("scaffolds", readdirSync(DIR).length > 0)

  ok("renames _gitignore", readdirSync(DIR).includes(".gitignore"))
  ok("no _gitignore left", !readdirSync(DIR).includes("_gitignore"))
  ok("renames _github to a real .github/workflows/ci.yml", existsSync(join(DIR, CI)))
  ok("no _github left", !readdirSync(DIR).includes("_github"))

  // The templates ship _github because npm may drop dot-directories: prove the
  // published tarball actually carries both workflows.
  const packed = await $`npm pack --dry-run --json`
    .cwd(`${ROOT}/packages/create-signet-app`)
    .quiet()
    .json()
  const packedPaths = (packed as { files: { path: string }[] }[])[0].files.map((f) => f.path)
  ok(
    "published package carries both CI workflows",
    ["template/_github/workflows/ci.yml", "template-api/_github/workflows/ci.yml"].every((p) =>
      packedPaths.includes(p),
    ),
    packedPaths.filter((p) => p.includes("github")).join(","),
  )

  const pkg = JSON.parse(readFileSync(join(DIR, "package.json"), "utf8"))
  const ciScripts = ciRunScripts(readFileSync(join(DIR, CI), "utf8"))
  ok(
    "CI runs lint, typecheck, test and build, and each script exists",
    ["lint", "typecheck", "test", "build"].every((s) => ciScripts.includes(s)) &&
      ciScripts.every((s) => s in pkg.scripts),
    ciScripts.join(","),
  )
  ok(
    "ships router, login route and sonner",
    ["src/routes/__root.tsx", "src/routes/index.tsx", "src/routes/login.tsx"].every((f) =>
      existsSync(join(DIR, f)),
    ) &&
      !!pkg.dependencies["@tanstack/react-router"] &&
      !!pkg.devDependencies["@tanstack/router-plugin"] &&
      !!pkg.dependencies.sonner,
  )
  const main = readFileSync(join(DIR, "src/main.tsx"), "utf8")
  ok(
    "main.tsx mounts the router and a Toaster",
    main.includes("<RouterProvider") && main.includes("<Toaster"),
  )

  const appCss = readFileSync(join(DIR, "src/app.css"), "utf8")
  ok("theme substituted", appCss.includes("cinematic.css"))
  const html = readFileSync(join(DIR, "index.html"), "utf8")
  ok("app name substituted", html.includes(`<title>${NAME}</title>`))
  // Check the real placeholder tokens, not any "__" — the test app is named
  // __scaffold_test__, which legitimately contains double underscores.
  const anyPlaceholder = (t: string) => t.includes("__APP_NAME__") || t.includes("__THEME__")
  ok("no placeholders remain", !anyPlaceholder(html) && !anyPlaceholder(appCss))
  ok("ships flash-prevention script", html.includes("prefers-color-scheme"))

  // Install the LOCAL packages as tarballs, not from npm. Installing from the
  // registry would only ever test the last release, so a fix could not be
  // validated before publishing it — and installing from the workspace would
  // hide packaging bugs entirely. Packing is the middle ground: exactly what
  // would ship, verified before it ships.
  for (const p of ["lib", "tokens", "ui"]) {
    await $`npm pack ${ROOT}/packages/${p}`.cwd(DIR).quiet()
  }
  await $`sh -c 'npm install ./dapplelight-signet-*.tgz'`.cwd(DIR).quiet()
  await $`npm install`.cwd(DIR).quiet()
  // Before build, in CI's order: the committed routeTree.gen.ts must typecheck
  // on its own, before the router plugin has ever run.
  const tc = await $`bun run typecheck`.cwd(DIR).nothrow().quiet()
  ok("typechecks before any build", tc.exitCode === 0, tc.stdout.toString().slice(0, 800))
  // The app's own tests: "/" and "/login" each resolve to their route.
  const test = await $`bun run test`.cwd(DIR).nothrow().quiet()
  ok(
    "app tests pass (routes resolve)",
    test.exitCode === 0,
    (test.stdout.toString() + test.stderr.toString()).slice(-800),
  )
  await $`bun run build`.cwd(DIR).quiet()
  ok("builds", readdirSync(join(DIR, "dist")).includes("index.html"))

  // Static evidence that /login is a real route: the router plugin splits each
  // route into its own chunk, so the login page ships as one.
  const assets = readdirSync(join(DIR, "dist/assets"))
  const loginChunk = assets.find((f) => f.startsWith("login-") && f.endsWith(".js"))
  ok(
    "build emits the /login route chunk",
    !!loginChunk &&
      readFileSync(join(DIR, "dist/assets", loginChunk), "utf8").includes("Replace this page"),
    assets.join(","),
  )
  const js = assets
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(DIR, "dist/assets", f), "utf8"))
    .join("\n")
  ok("bundle mounts sonner's Toaster", js.includes("data-sonner-toaster"))
  const installed = readdirSync(join(DIR, "node_modules/@dapplelight"))
  ok(
    "installs the signet packages",
    ["signet-ui", "signet-lib", "signet-tokens"].every((p) => installed.includes(p)),
    installed.join(","),
  )
  const lock = readFileSync(join(DIR, "package.json"), "utf8")
  ok("scaffolded app has NO workspace: deps", !lock.includes("workspace:"), lock)

  await $`bunx biome check .`.cwd(DIR).quiet()
  ok("biome lints clean", true)
  ok(
    "ships biome config, not eslint",
    readdirSync(DIR).includes("biome.json") && !readdirSync(DIR).includes("eslint.config.js"),
  )

  const cssFile = readdirSync(join(DIR, "dist/assets")).find((f) => f.endsWith(".css"))!
  const css = readFileSync(join(DIR, "dist/assets", cssFile), "utf8")
  // Cinematic values, not editorial ones — proves the theme reached the bundle.
  ok(
    "bundle carries cinematic type scale",
    css.includes(".text-sm{font-size:1rem"),
    "(editorial would be 0.8125rem)",
  )
  ok(
    "bundle carries cinematic radius",
    css.includes(".rounded-lg{border-radius:.1875rem"),
    "(editorial would be .75rem)",
  )
  ok(
    "bundle carries cinematic primary",
    css.includes("--primary:#6d28d9"),
    "(editorial would be #16a34a)",
  )
  ok("bundle carries cinematic font", css.includes('--font-sans:"Inter"'))
  // The Toaster's surface points at the contract's popover token, and that
  // token is emitted — an unresolved var would draw sonner's own white box.
  ok(
    "toasts use the theme's popover token",
    css.includes("--normal-bg:var(--color-popover)") && css.includes("--color-popover:"),
  )

  // The bug this guards: the theme hardcoded @source "../../../ui/src", which
  // exists only inside the monorepo. Installed from a package, Tailwind scanned
  // nothing and every @dapplelight/signet-ui component rendered UNSTYLED — while the
  // app's own utility classes still worked, so it looked fine at a glance.
  ok(
    "bundle contains @dapplelight/signet-ui component classes",
    css.includes("data-slot"),
    "Tailwind is not scanning the installed ui package",
  )
  ok(
    "bundle has the Button variant classes",
    /\.bg-primary\{/.test(css),
    "component utilities missing from the bundle",
  )
} finally {
  rmSync(DIR, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
