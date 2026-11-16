#!/usr/bin/env bun

/**
 * create-signet-app — scaffold a Vite + React + TypeScript + Tailwind v4 app
 * wired to @dapplelight/signet-tokens, @dapplelight/signet-ui and @dapplelight/signet-lib.
 *
 * Exists because the audit found the same setup rebuilt by hand 13 times, and
 * the five-package eslint config copied as a block into exactly 8 of 23 repos
 * without ever being templated — a config that turned out to be broken against
 * current plugin versions. Biome replaces the whole graph with one binary.
 */

import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import { appId, DESKTOP_PKG } from "./desktop.js"

const THEMES = ["editorial", "cinematic", "finance"] as const
type Theme = (typeof THEMES)[number]
const TEMPLATES = ["web", "api", "full", "cli", "extension", "desktop"] as const
type Template = (typeof TEMPLATES)[number]
const TARGETS = ["cloudflare", "bun", "node", "vercel"] as const
type Target = (typeof TARGETS)[number]
const PMS = ["bun", "npm", "pnpm"] as const
type Pm = (typeof PMS)[number]

/** `npm create` / `pnpm create` say who ran them; bun otherwise. */
function detectPm(): Pm {
  const agent = process.env.npm_config_user_agent ?? ""
  return agent.startsWith("pnpm/") ? "pnpm" : agent.startsWith("npm/") ? "npm" : "bun"
}

/** How each package manager spells install, a frozen install and running a script or a bin. */
const PM: Record<Pm, { install: string; ci: string; run: string; x: string; lock: string }> = {
  bun: {
    install: "bun install",
    ci: "bun install --frozen-lockfile",
    run: "bun run",
    x: "bunx",
    lock: "bun.lock",
  },
  npm: {
    install: "npm install",
    ci: "npm ci",
    run: "npm run",
    x: "npx",
    lock: "package-lock.json",
  },
  pnpm: {
    install: "pnpm install",
    ci: "pnpm install --frozen-lockfile",
    run: "pnpm run",
    x: "pnpm exec",
    lock: "pnpm-lock.yaml",
  },
}

/**
 * The CI workflow is written for bun; for npm or pnpm, install and run with
 * that instead. Bun stays for `bun test` (and the full template's API).
 */
function applyPm(ci: string, pm: Pm): string {
  if (pm === "bun") return ci
  const p = PM[pm]
  const setup = [
    ...(pm === "pnpm"
      ? ["      - uses: pnpm/action-setup@v4", "        with:", "          version: 10"]
      : []),
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    `          cache: ${pm}`,
    "      - uses: oven-sh/setup-bun@v2",
  ].join("\n")
  return ci
    .replace(/^ {6}- uses: oven-sh\/setup-bun@v2$/gm, setup)
    .replace(
      /Commit bun\.lock: --frozen-lockfile fails/,
      `Commit ${p.lock}: a frozen install fails`,
    )
    .replaceAll("bun install --frozen-lockfile", p.ci)
    .replaceAll("bun run ", `${p.run} `)
    .replaceAll("bunx ", `${p.x} `)
}

const TEMPLATE_DIRS: Record<Template, string> = {
  web: "template",
  api: "template-api",
  full: "template-full",
  cli: "template-cli",
  extension: "template-extension",
  desktop: "template-desktop",
}

// The api template: a Hono Worker with Signet's request id, error envelope,
// validation and exact Durable Object rate limiting already wired.
const API_DEPS = {
  "@dapplelight/signet-server": "^0.5.0",
  hono: "^4.13.8",
  zod: "^4.6.5",
}

// Added with MCP (--mcp, the default): signet-server's optional peer for /mcp.
const MCP_DEPS = {
  "@modelcontextprotocol/server": "^2.1.0",
}

/**
 * The api template marks MCP-only lines with `// mcp:begin` / `// mcp:end`
 * lines: with MCP the markers go, without it the blocks go.
 */
function applyMcp(text: string, mcp: boolean): string {
  return mcp
    ? text.replace(/^[ \t]*\/\/ mcp:(begin|end)\n/gm, "")
    : text.replace(/^[ \t]*\/\/ mcp:begin\n[\s\S]*?^[ \t]*\/\/ mcp:end\n/gm, "")
}

const API_DEV_DEPS = {
  "@biomejs/biome": "^2.5.14",
  "@types/bun": "^1.4.2",
  typescript: "^7.0.2",
}

// What each --target adds over the shared api template: its own files (from
// template-api/_targets/<target>, copied over the shared ones), scripts and dev deps.
const API_TARGETS: Record<
  Target,
  {
    scripts: Record<string, string>
    devDeps?: Record<string, string>
    engines?: Record<string, string>
  }
> = {
  cloudflare: {
    scripts: { dev: "wrangler dev", deploy: "wrangler deploy" },
    devDeps: { wrangler: "^4.136.3" },
  },
  bun: { scripts: { dev: "bun --watch src/server.ts", start: "bun src/server.ts" } },
  node: {
    scripts: { dev: "node --watch src/server.ts", start: "node src/server.ts" },
    devDeps: { "@types/node": "^26.6.2" },
    // Runs src/server.ts as is: type stripping is on by default from 22.18.
    engines: { node: ">=22.18" },
  },
  vercel: { scripts: { dev: "bunx vercel dev", deploy: "bunx vercel deploy" } },
}

const API_NEXT_STEPS: Record<Target, string> = {
  cloudflare: `Rate limiting is exact and per IP, backed by the RateLimitCounter Durable
  Object in wrangler.jsonc. Append migration tags; never edit a deployed one.`,
  bun: `bun run start serves src/server.ts under Bun.serve; the Dockerfile runs the same.
  Rate limiting is in-process and keyed by the socket address.`,
  node: `bun run start runs src/server.ts with node 22.18+ (node:http, no extra dependency).
  Rate limiting is in-process and keyed by the socket address.`,
  vercel: `index.ts is the Vercel entry (Hono preset, vercel.json). Deploy with bun run deploy.
  Rate limiting is per function instance; see the comment in index.ts.`,
}

const DEPS = {
  // Real ranges, not workspace:* — the packages are published, so a scaffolded
  // app installs from npm and works anywhere. Inside this monorepo bun still
  // links the local copies, because the range matches the workspace version.
  "@dapplelight/signet-lib": "^0.4.0",
  "@dapplelight/signet-tokens": "^0.3.0",
  "@dapplelight/signet-ui": "^0.3.0",
  "@tanstack/react-query": "^5.103.2",
  "@tanstack/react-router": "^1.170.39",
  "class-variance-authority": "^0.7.1",
  clsx: "^2.1.1",
  "lucide-react": "^1.47.0",
  react: "^19.3.0",
  "react-dom": "^19.3.0",
  sonner: "^2.0.8",
  "tailwind-merge": "^3.7.0",
}

// The web template's PWA: vite-plugin-pwa builds src/sw.ts with Workbox.
const PWA_DEV_DEPS = {
  "vite-plugin-pwa": "^1.3.0",
  "workbox-precaching": "^7.4.0",
  "workbox-routing": "^7.4.0",
  "workbox-window": "^7.4.0",
}

const DEV_DEPS = {
  "@biomejs/biome": "^2.5.14",
  "@tailwindcss/vite": "^4.3.3",
  "@tanstack/router-plugin": "^1.168.40",
  "@types/bun": "^1.4.2",
  "@types/node": "^26.6.2",
  "@types/react": "^19.3.0",
  "@types/react-dom": "^19.3.0",
  "@vitejs/plugin-react": "^6.1.1",
  tailwindcss: "^4.3.3",
  typescript: "^7.0.2",
  vite: "^8.3.0",
}

// The full template: the web app's deps plus the API's, signet-db and
// signet-payments for plans, admin, privacy and billing, and the screens' peers.
const FULL_DEPS = {
  ...DEPS,
  ...API_DEPS,
  "@base-ui/react": "^1.3.0",
  "@dapplelight/signet-db": "^0.2.0",
  "@dapplelight/signet-payments": "^0.1.0",
  "drizzle-orm": "^0.45.4",
  "input-otp": "^1.4.2",
}

const FULL_DEV_DEPS = {
  ...DEV_DEPS,
  "@playwright/test": "^1.65.1",
  "drizzle-kit": "^0.31.11",
}

// The cli template: a Bun CLI that signs in by device code, compiled to one binary.
const CLI_PKG = {
  scripts: {
    dev: "bun src/index.ts",
    build: "bun build --compile src/index.ts --outfile dist/__APP_NAME__",
    lint: "biome check .",
    format: "biome check --write .",
    typecheck: "tsc --noEmit && tsc --noEmit -p tsconfig.test.json",
    test: "bun test",
  },
  dependencies: {
    "@dapplelight/signet-lib": "^0.4.0",
    "@dapplelight/signet-tokens": "^0.3.0",
  },
  devDependencies: API_DEV_DEPS,
}

// The extension template: the web app's deps without the router, query and
// toasts, built by plain Vite into popup, options and service worker.
const EXT_OMIT = ["@tanstack/react-query", "@tanstack/react-router", "sonner"]
const EXT_DEV_OMIT = ["@tanstack/router-plugin"]
const omit = (o: Record<string, string>, keys: string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
const EXT_SCRIPTS = {
  dev: "vite build --watch",
  build: "tsc --noEmit && vite build",
  lint: "biome check .",
  format: "biome check --write .",
  typecheck: "tsc --noEmit",
  test: "bun test",
}

const FULL_SCRIPTS = {
  // Both halves: the API (restarting on change) and Vite, which proxies /api to it.
  dev: "bun scripts/dev.ts",
  build: "tsc -b && vite build",
  // One process serves the API and the built app from dist/.
  start: "bun api/server.ts",
  preview: "vite preview",
  lint: "biome check .",
  format: "biome check --write .",
  typecheck: "tsc -b --noEmit",
  test: "bun test src test",
  "test:e2e": "playwright test",
  "db:generate": "drizzle-kit generate",
  "db:check": "signet-db-check drizzle",
}

/** A fresh 48-character secret for the generated env file. */
const secret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(36))).toString("base64url")

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  let name: string | undefined
  let theme: Theme = "editorial"
  let template: Template = "web"
  let target: Target | undefined
  let mcp: boolean | undefined
  let pm: Pm | undefined

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--theme" || a === "-t") {
      const v = args[++i]
      if (!THEMES.includes(v as Theme)) {
        throw new Error(`Unknown theme "${v}". Available: ${THEMES.join(", ")}`)
      }
      theme = v as Theme
    } else if (a === "--template") {
      const v = args[++i]
      if (!TEMPLATES.includes(v as Template)) {
        throw new Error(`Unknown template "${v}". Available: ${TEMPLATES.join(", ")}`)
      }
      template = v as Template
    } else if (a === "--target") {
      const v = args[++i]
      if (!TARGETS.includes(v as Target)) {
        throw new Error(`Unknown target "${v}". Available: ${TARGETS.join(", ")}`)
      }
      target = v as Target
    } else if (a === "--pm") {
      const v = args[++i]
      if (!PMS.includes(v as Pm)) {
        throw new Error(`Unknown package manager "${v}". Available: ${PMS.join(", ")}`)
      }
      pm = v as Pm
    } else if (a === "--mcp" || a === "--no-mcp") {
      mcp = a === "--mcp"
    } else if (a === "--help" || a === "-h") {
      console.log(`
create-signet-app <directory> [options]

Options:
  --template <kind>    web | api | full | cli | extension | desktop   (default: web)
                       web: Vite + React + Signet UI
                       api: Hono Worker with the error envelope, request ids,
                            validation and Durable Object rate limiting
                       full: web + API in one project, typed client between
                            them, SQLite with migrations, phone sign-in,
                            account, inbox, privacy, billing and admin
                       cli: Bun CLI compiled to one binary; login by device
                            code, logout, whoami
                       extension: Chrome MV3 extension: popup, options page and
                            service worker, signed in over PKCE with
                            chrome.identity (plain Vite, no extension plugin)
                       desktop: Tauri v2 desktop + menu-bar app, browser sign-in
                            (PKCE, loopback redirect), CI on macOS/Windows/Linux
  --target <runtime>   ${TARGETS.join(" | ")}   (default: cloudflare; api only)
                       cloudflare: Worker entry + wrangler.jsonc
                       bun: Bun.serve entry + Dockerfile
                       node: node:http entry (Node 22.18+)
                       vercel: Vercel entry + vercel.json
  --mcp, --no-mcp      api and full: serve the routes to agents at /mcp
                       (default: asks when interactive, else --mcp)
  -t, --theme <name>   ${THEMES.join(" | ")}   (default: editorial; web and full)
  --pm <name>          ${PMS.join(" | ")}   (default: the one that ran this, else bun)
                       Sets the commands in CI, the README and below.
  -h, --help

Examples:
  bun create-signet-app my-app --theme cinematic
  bun create-signet-app my-api --template api
  bun create-signet-app my-api --template api --target bun
  bun create-signet-app my-app --template full --theme finance
  bun create-signet-app my-cli --template cli
  npm create signet-app my-app -- --template full --pm npm
`)
      process.exit(0)
    } else if (!a.startsWith("-")) {
      name = a
    } else {
      throw new Error(`Unknown option "${a}"`)
    }
  }

  if (!name) throw new Error("Missing target directory.\nUsage: create-signet-app <directory>")
  if (target && template !== "api") throw new Error("--target applies to --template api only.")
  if (
    mcp !== undefined &&
    (template === "web" || template === "cli" || template === "extension" || template === "desktop")
  )
    throw new Error("--mcp / --no-mcp apply to --template api and full only.")
  if (theme !== "editorial" && template === "api")
    throw new Error("--theme applies to --template web and full only.")
  return { name, theme, template, target: target ?? "cloudflare", mcp, pm: pm ?? detectPm() }
}

/** Replace placeholders in every text file under dir. */
async function substitute(dir: string, vars: Record<string, string>) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await substitute(full, vars)
      continue
    }
    let text = await readFile(full, "utf8")
    let changed = false
    for (const [k, v] of Object.entries(vars)) {
      if (text.includes(k)) {
        text = text.replaceAll(k, v)
        changed = true
      }
    }
    if (changed) await writeFile(full, text)
  }
}

/** "Add MCP for agents?", default yes; only asked on a terminal. */
async function askMcp(): Promise<boolean> {
  if (!process.stdin.isTTY) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question("  Add MCP for agents? (Y/n) ")).trim().toLowerCase()
    return answer === "" || answer.startsWith("y")
  } finally {
    rl.close()
  }
}

async function main() {
  const { name, theme, template, target, pm, ...flags } = parseArgs(process.argv)
  const dest = resolve(process.cwd(), name)
  const appName = basename(dest)

  if (existsSync(dest) && (await readdir(dest)).length > 0) {
    throw new Error(`${dest} already exists and is not empty.`)
  }

  const mcp = (template === "api" || template === "full") && (flags.mcp ?? (await askMcp()))
  const templateDir = resolve(import.meta.dirname, `../${TEMPLATE_DIRS[template]}`)
  await mkdir(dest, { recursive: true })
  const targetsDir = join(templateDir, "_targets")
  const mcpDir = join(templateDir, "_mcp")
  await cp(templateDir, dest, {
    recursive: true,
    filter: (src) => src !== targetsDir && src !== mcpDir,
  })
  // Only the chosen runtime's files, laid over the shared ones; MCP's tests with MCP.
  if (template === "api") await cp(join(targetsDir, target), dest, { recursive: true })
  if (mcp && existsSync(mcpDir)) await cp(mcpDir, dest, { recursive: true })
  const mcpFiles: Record<Template, string[]> = {
    web: [],
    extension: [],
    desktop: [],
    api: ["src/app.ts", "src/env.ts"],
    full: ["api/app.ts", "api/env.ts"],
    cli: [],
  }
  for (const f of mcpFiles[template]) {
    const path = join(dest, f)
    await writeFile(path, applyMcp(await readFile(path, "utf8"), mcp))
  }

  // npm strips a file literally named .gitignore from published packages, so
  // the template ships it as _gitignore and it is renamed on scaffold.
  // .github goes the same way: npm can drop dot-directories from a package, so
  // the CI workflow ships under _github.
  await rename(join(dest, "_gitignore"), join(dest, ".gitignore"))
  await rename(join(dest, "_github"), join(dest, ".github"))
  if (template === "api" && target === "bun")
    await rename(join(dest, "_dockerignore"), join(dest, ".dockerignore"))
  // pnpm (10+) refuses to install until build scripts are reviewed; esbuild's
  // (vite, drizzle-kit, wrangler) and workerd's are the ones these templates
  // pull in. allowBuilds is pnpm 11+, onlyBuiltDependencies pnpm 10.
  if (pm === "pnpm")
    await writeFile(
      join(dest, "pnpm-workspace.yaml"),
      "allowBuilds:\n  esbuild: true\n  workerd: true\nonlyBuiltDependencies:\n  - esbuild\n  - workerd\n",
    )
  const ci = join(dest, ".github/workflows/ci.yml")
  await writeFile(ci, applyPm(await readFile(ci, "utf8"), pm))

  await substitute(dest, {
    __APP_NAME__: appName,
    __APP_ID__: appId(appName),
    __THEME__: theme,
    __PM_INSTALL__: PM[pm].install,
    __PM_RUN__: PM[pm].run,
    __PM_X__: PM[pm].x,
  })

  if (template === "full") {
    // The API's secrets for this machine, fresh per app; gitignored. Bun loads
    // it on its own. Production sets these on the host instead.
    await writeFile(
      join(dest, ".env"),
      [
        "APP_ENV=development",
        `SESSION_SECRET=${secret()}`,
        `OTP_SECRET=${secret()}`,
        "# Phone numbers (E.164, comma-separated) that become admins on sign-in.",
        "ADMIN_PHONES=",
        "BILLING=fake",
        "",
      ].join("\n"),
    )
  }

  // signet-mcp's index reads the scripts below from this source by their
  // shape: the api object first, the web object as the next literal.
  const pkg = {
    scripts:
      template === "api"
        ? {
            ...API_TARGETS[target].scripts,
            lint: "biome check .",
            format: "biome check --write .",
            typecheck: "tsc --noEmit && tsc --noEmit -p tsconfig.test.json",
            test: "bun test",
          }
        : template === "full"
          ? FULL_SCRIPTS
          : {
              dev: "vite",
              build: "tsc -b && vite build",
              preview: "vite preview",
              lint: "biome check .",
              format: "biome check --write .",
              typecheck: "tsc -b --noEmit",
              test: "bun test",
            },
    dependencies:
      template === "api"
        ? { ...API_DEPS, ...(mcp ? MCP_DEPS : {}) }
        : template === "full"
          ? { ...FULL_DEPS, ...(mcp ? MCP_DEPS : {}) }
          : DEPS,
    devDependencies:
      template === "api"
        ? { ...API_DEV_DEPS, ...API_TARGETS[target].devDeps }
        : template === "full"
          ? FULL_DEV_DEPS
          : { ...DEV_DEPS, ...PWA_DEV_DEPS },
    ...(template === "api" && API_TARGETS[target].engines
      ? { engines: API_TARGETS[target].engines }
      : {}),
  }
  if (template === "extension")
    Object.assign(pkg, {
      scripts: EXT_SCRIPTS,
      // ^0.4.1: chromeStorage().watch, so the pages see the service worker sign in.
      dependencies: { ...omit(DEPS, EXT_OMIT), "@dapplelight/signet-lib": "^0.4.1" },
      devDependencies: omit(DEV_DEPS, EXT_DEV_OMIT),
    })
  const final =
    template === "cli"
      ? JSON.parse(JSON.stringify(CLI_PKG).replaceAll("__APP_NAME__", appName))
      : pkg
  await writeFile(
    join(dest, "package.json"),
    `${JSON.stringify({ name: appName, private: true, version: "0.1.0", type: "module", ...(template === "desktop" ? DESKTOP_PKG : final) }, null, 2)}\n`,
  )

  const { install, run } = PM[pm]
  const steps = `cd ${name}\n  ${install}\n  ${run} dev`
  console.log(
    template === "cli"
      ? `
  Created ${appName}, a CLI that compiles to one binary.

  ${steps.replace(`${run} dev`, `${run} build`)}

  Then ./dist/${appName} login. README.md covers the server side.
`
      : template === "extension"
        ? `
  Created ${appName}, a Chrome extension with the ${theme} theme.

  ${steps.replace(`${run} dev`, `${run} build`)}

  Then load dist/ at chrome://extensions (Developer mode, Load unpacked), and
  register its redirect URI on your server. README.md has both steps.
`
        : template === "api"
          ? `
  Created ${appName}, an API for ${target}${mcp ? ", with MCP at /mcp (MCP=off turns it off)" : ""}.

  ${steps}

  ${API_NEXT_STEPS[target]}
`
          : template === "desktop"
            ? `
  Created ${appName}, a Tauri desktop + menu-bar app with the ${theme} theme.

  ${steps.replace(`${run} dev`, `${PM[pm].x} tauri dev`)}

  Needs Rust and Tauri's system dependencies. README.md covers sign-in (register
  the client on signet-server) and the identifier in src-tauri/tauri.conf.json.
`
            : template === "full"
              ? `
  Created ${appName}: web app + API with the ${theme} theme${mcp ? ", MCP at /mcp" : ""}.

  ${steps}

  Open the URL Vite prints and sign in with any phone number; in development
  the code is printed in this terminal. Put your number in ADMIN_PHONES (.env)
  to see /admin. README.md walks through the first day. The API runs on Bun,
  whichever package manager installs it.
`
              : `
  Created ${appName} with the ${theme} theme.

  ${steps}

  Switch themes by editing the @dapplelight/signet-tokens import in src/app.css.
`,
  )
}

main().catch((err: unknown) => {
  console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
