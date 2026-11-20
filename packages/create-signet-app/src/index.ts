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
import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  select,
  text,
} from "@clack/prompts"
import {
  applyBlocks,
  type BaseDeps,
  compose,
  PART_NAMES,
  PARTS,
  type PartName,
  RUNTIMES,
  type Runtime,
  resolveParts,
  STARTERS,
  type StarterName,
} from "./compose.js"
import { appId, DESKTOP_PKG } from "./desktop.js"
import {
  answer,
  choose,
  command,
  hasApi,
  hasUi,
  type Mix,
  mixRows,
  nameError,
  PLATFORMS,
  type Platform,
  partRows,
  summary,
  THEME_LABELS,
  ticked,
  WHAT,
} from "./picker.js"

const THEMES = ["editorial", "cinematic", "finance"] as const
type Theme = (typeof THEMES)[number]
// --template is the old name for --platform, kept working; its `full` is now `--starter full`.
const TEMPLATES = [...PLATFORMS, "full"] as const
type Template = (typeof TEMPLATES)[number]
const STARTER_NAMES = Object.keys(STARTERS) as StarterName[]
const TARGETS = ["cloudflare", "bun", "deno", "node", "vercel"] as const
type Target = (typeof TARGETS)[number]
const DESCRIBE_TEMPLATES: readonly Template[] = ["web", "api", "full"]
const PMS = ["bun", "npm", "pnpm", "yarn", "deno"] as const
type Pm = (typeof PMS)[number]

/** `npm create`, `pnpm create`, `yarn create`, `deno run`... say who ran them; bun otherwise. */
function detectPm(): Pm {
  const agent = process.env.npm_config_user_agent ?? ""
  for (const pm of ["yarn", "pnpm", "bun", "deno", "npm"] as const)
    if (agent.startsWith(`${pm}/`)) return pm
  return "bun"
}

/** Yarn through corepack, pinned so CI and every machine run the same one. */
const YARN = "yarn@4.18.1"

/**
 * signet-ui's required peers. npm, pnpm, bun and deno install them on their
 * own; Yarn does not, so a Yarn app lists them (test/scaffold-pm.ts checks
 * this list against signet-ui's package.json).
 */
const UI_PEERS: Record<string, string> = {
  "@base-ui/react": ">=1.3.0",
  "@radix-ui/react-checkbox": ">=1.0.0",
  "@radix-ui/react-dropdown-menu": ">=2.0.0",
  "@radix-ui/react-popover": ">=1.0.0",
  "@radix-ui/react-tooltip": ">=1.0.0",
  "@tanstack/react-table": ">=9.0.0",
  "class-variance-authority": ">=0.0.0",
  clsx: ">=2.0.0",
  "input-otp": ">=1.4.0",
  "lucide-react": ">=1.0.0",
  react: ">=19.0.0",
  "react-day-picker": ">=10.0.0",
  "react-dom": ">=19.0.0",
  "tailwind-merge": ">=3.0.0",
  "@dapplelight/signet-tokens": "^0.3.0 || ^0.4.0",
}
const sortDeps = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))

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
  yarn: {
    install: "yarn install",
    ci: "yarn install --immutable",
    run: "yarn run",
    x: "yarn exec",
    lock: "yarn.lock",
  },
  deno: {
    install: "deno install",
    ci: "deno install --frozen",
    run: "deno task",
    x: "deno x",
    lock: "deno.lock",
  },
}

/**
 * The CI workflow is written for bun; for another manager, install and run
 * with that instead. Bun stays for `bun test` (and the composed app's API).
 */
function applyPm(ci: string, pm: Pm): string {
  if (pm === "bun") return ci
  const p = PM[pm]
  const node = [
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
  ]
  const setup = [
    ...(pm === "pnpm"
      ? ["      - uses: pnpm/action-setup@v4", "        with:", "          version: 10"]
      : []),
    ...(pm === "deno"
      ? ["      - uses: denoland/setup-deno@v2", "        with:", "          deno-version: v2.x"]
      : pm === "yarn"
        ? [...node, "      - run: corepack enable"]
        : [...node, `          cache: ${pm}`]),
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

const TEMPLATE_DIRS: Record<Platform, string> = {
  web: "template",
  api: "template-api",
  cli: "template-cli",
  extension: "template-extension",
  desktop: "template-desktop",
}

// The api template: a Hono Worker with Signet's request id, error envelope,
// validation and exact Durable Object rate limiting already wired.
const API_DEPS = {
  "@dapplelight/signet-server": "^0.6.1",
  hono: "^4.13.8",
  zod: "^4.6.7",
}

// Added with MCP (--mcp, the default): signet-server's optional peer for /mcp.
const MCP_DEPS = {
  "@modelcontextprotocol/server": "^2.4.0",
}

/**
 * The api template marks MCP-only lines with `// mcp:begin` / `// mcp:end`
 * lines: with MCP the markers go, without it the blocks go. The same markers
 * the composer resolves for every part (applyBlocks in compose.ts).
 */
function applyMcp(text: string, mcp: boolean): string {
  return applyBlocks(text, new Set(mcp ? ["mcp"] : []))
}

const API_DEV_DEPS = {
  "@biomejs/biome": "^2.5.14",
  "@types/bun": "^1.4.4",
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
  deno: {
    scripts: { dev: "deno run -A --watch src/server.ts", start: "deno run -A src/server.ts" },
  },
  node: {
    scripts: { dev: "node --watch src/server.ts", start: "node src/server.ts" },
    devDeps: { "@types/node": "^26.6.6" },
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
  deno: `bun run start serves src/server.ts under Deno.serve (Deno 2); the Dockerfile runs the same.
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
  "@dapplelight/signet-tokens": "^0.4.0",
  // LabelsProvider (src/components/signet-labels.tsx) since 0.3.2.
  "@dapplelight/signet-ui": "^0.5.0",
  "@tanstack/react-query": "^5.108.0",
  "@tanstack/react-router": "^1.170.39",
  "class-variance-authority": "^0.7.1",
  clsx: "^2.1.1",
  "lucide-react": "^1.74.0",
  react: "^19.3.1",
  "react-dom": "^19.3.1",
  sonner: "^2.0.8",
  "tailwind-merge": "^3.7.0",
  // Listed so npm resolves signet-ui's optional zod 4 peer, not the zod 3
  // that @hookform/resolvers' optional peers pull in otherwise (ERESOLVE).
  zod: "^4.6.7",
}

// The web template's i18n: src/lib/i18n.ts + src/locales/*.json.
const I18N_DEPS = {
  i18next: "^26.4.2",
  "react-i18next": "^17.0.15",
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
  "@tailwindcss/vite": "^4.3.5",
  "@tanstack/router-plugin": "^1.168.40",
  "@types/bun": "^1.4.4",
  "@types/node": "^26.6.6",
  "@types/react": "^19.3.0",
  "@types/react-dom": "^19.3.0",
  "@vitejs/plugin-react": "^6.3.0",
  tailwindcss: "^4.3.5",
  typescript: "^7.0.2",
  vite: "^8.3.8",
}

// Composed apps (--ui, --api, --with, --starter): the base's own deps per
// surface. Each part adds its own in parts/<name>/part.ts. The web half calls
// the API through hono/client; the screens need @base-ui/react.
const BASE: BaseDeps = {
  web: {
    deps: { ...DEPS, "@base-ui/react": "^1.3.0", hono: API_DEPS.hono },
    devDeps: DEV_DEPS,
  },
  api: {
    deps: { ...API_DEPS, "@dapplelight/signet-db": "^0.2.0", "drizzle-orm": "^0.45.4" },
    devDeps: { ...API_DEV_DEPS, "drizzle-kit": "^0.31.11" },
  },
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
    "@dapplelight/signet-tokens": "^0.4.0",
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

/** What a composed app is made of, as the flags said it. */
type ComposeFlags = {
  starter?: StarterName
  ui: boolean
  api: boolean
  with: string[]
  without: string[]
}

const list = (v: string | undefined, flag: string) => {
  if (!v || v.startsWith("-")) throw new Error(`${flag} needs parts, e.g. ${flag} auth,payments`)
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  let name: string | undefined
  let theme: Theme = "editorial"
  let template: Template = "web"
  let target: Target | undefined
  let mcp: boolean | undefined
  let pm: Pm | undefined
  let describe: string | undefined
  let themeGiven: Theme | undefined
  let templateGiven: Template | undefined
  const composeFlags: ComposeFlags = { ui: false, api: false, with: [], without: [] }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--theme" || a === "-t") {
      const v = args[++i]
      if (!THEMES.includes(v as Theme)) {
        throw new Error(`Unknown theme "${v}". Available: ${THEMES.join(", ")}`)
      }
      theme = themeGiven = v as Theme
    } else if (a === "--platform" || a === "--template") {
      const v = args[++i]
      if (a === "--platform" && v === "full")
        throw new Error("full is a starter now: --starter full (or --template full).")
      if (!(a === "--platform" ? PLATFORMS : TEMPLATES).includes(v as Platform)) {
        throw new Error(`Unknown platform "${v}". Available: ${PLATFORMS.join(", ")}`)
      }
      if (templateGiven && templateGiven !== v)
        throw new Error("--platform and --template are the same flag; give one.")
      template = templateGiven = v as Template
    } else if (a === "--starter") {
      // `api` was api-billing's name until the picker listed it beside the api platform.
      const v = args[++i] === "api" ? "api-billing" : args[i]
      if (!STARTER_NAMES.includes(v as StarterName)) {
        throw new Error(`Unknown starter "${v}". Available: ${STARTER_NAMES.join(", ")}`)
      }
      composeFlags.starter = v as StarterName
    } else if (a === "--ui" || a === "--api") {
      composeFlags[a === "--ui" ? "ui" : "api"] = true
    } else if (a === "--with" || a === "--without") {
      composeFlags[a === "--with" ? "with" : "without"].push(...list(args[++i], a))
    } else if (a === "--describe") {
      const v = args[++i]
      if (!v?.trim() || v.startsWith("--"))
        throw new Error(
          '--describe needs a sentence, e.g. --describe "a team inbox with settings".',
        )
      describe = v
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

Platforms (one app each):
  --platform <name>    web | api | cli | extension | desktop   (default: web)
                       web: Vite + React + Signet UI
                       api: Hono Worker with the error envelope, request ids,
                            validation and Durable Object rate limiting
                       cli: Bun CLI compiled to one binary; login by device
                            code, logout, whoami
                       extension: Chrome MV3 extension: popup, options page and
                            service worker, signed in over PKCE with
                            chrome.identity (plain Vite, no extension plugin)
                       desktop: Tauri v2 desktop + menu-bar app, browser sign-in
                            (PKCE, loopback redirect), CI on macOS/Windows/Linux
  --template <name>    the old name for --platform; --template full is --starter full

Composed apps (a web app and its API from parts; any of these flags):
  --starter <name>     a named mix of parts, web + API in one project, typed
                       client between them, SQLite with migrations:
${STARTER_NAMES.map((s) => `                         ${s.padEnd(14)}${STARTERS[s].description}`).join("\n")}
  --with <parts>       comma-separated parts to add; the parts they need come too
  --without <parts>    parts to leave out (alone: the full starter without them)
  --ui                 the web half only; it calls an API elsewhere (VITE_API_URL)
  --api                the API half only (Hono on Bun, SQLite)
                       neither: both halves
                       Parts:
${PART_NAMES.map((p) => `                         ${p.padEnd(14)}${PARTS[p].description}${PARTS[p].needs ? ` (needs ${PARTS[p].needs?.join(", ")})` : ""}`).join("\n")}

Options:
  --target <runtime>   ${TARGETS.join(" | ")}   (default: cloudflare; platform api)
                       composed apps: ${RUNTIMES.join(" | ")} runs the API (default: bun;
                       deno and node use node:sqlite and node:http)
                       cloudflare: Worker entry + wrangler.jsonc
                       bun: Bun.serve entry + Dockerfile
                       deno: Deno.serve entry + Dockerfile (Deno 2)
                       node: node:http entry (Node 22.18+)
                       vercel: Vercel entry + vercel.json
  --mcp, --no-mcp      platform api and composed apps with an API: serve the
                       routes to agents at /mcp (the mcp part)
                       (default: asks when interactive, else --mcp)
  -t, --theme <name>   ${THEMES.join(" | ")}   (default: editorial; anything with a web UI)
  --pm <name>          ${PMS.join(" | ")}   (default: the one that ran this, else bun)
                       Sets the commands in CI, the README and below.
                       Tests (bun test) still need Bun; deno: not for platform cli
  --describe "<sentence>"  Pick platform (or the full starter) and theme from one
                       sentence, scaffold, write PLAN.md and AGENTS.md (web, api
                       and full; an explicit --platform or --theme wins)
  -h, --help

Examples:
  bun create-signet-app my-app --theme cinematic
  bun create-signet-app my-api --platform api --target bun
  bun create-signet-app my-app --starter full --theme finance
  bun create-signet-app my-app --with payments,notifications
  bun create-signet-app my-app --without admin,privacy
  bun create-signet-app my-api --api --with orgs
  bun create-signet-app my-cli --platform cli
  npm create signet-app my-app -- --starter full --pm npm
  bun create-signet-app my-app --describe "a team inbox with settings and pricing"
`)
      process.exit(0)
    } else if (!a.startsWith("-")) {
      name = a
    } else {
      throw new Error(`Unknown option "${a}"`)
    }
  }

  // On a terminal a missing name is asked for (askName); elsewhere it is an error.
  if (!name && !process.stdin.isTTY)
    throw new Error("Missing target directory.\nUsage: create-signet-app <directory>")
  const composing =
    composeFlags.starter ||
    composeFlags.ui ||
    composeFlags.api ||
    composeFlags.with.length ||
    composeFlags.without.length
  if (composing && templateGiven && templateGiven !== "full")
    throw new Error(
      `--platform ${templateGiven} is its own app; --starter, --with, --without, --ui and --api compose a web app and its API. Give one or the other.`,
    )
  if (composeFlags.ui && composeFlags.api)
    throw new Error("--ui and --api together are the default (both halves): drop them.")
  if (composing) template = "full"
  if (describe !== undefined) {
    if (composing && templateGiven !== "full")
      throw new Error(
        "--describe picks the platform or starter itself; drop --starter, --with, --without, --ui and --api.",
      )
    if (templateGiven && !DESCRIBE_TEMPLATES.includes(templateGiven))
      throw new Error("--describe applies to --template web, api and full only.")
    // The template and theme come from the sentence, so these are checked once they are known.
    return {
      name,
      theme,
      template,
      target: target ?? "cloudflare",
      targetGiven: target,
      mcp,
      pm: pm ?? detectPm(),
      composeFlags,
      describe: { sentence: describe, template: templateGiven, theme: themeGiven },
    }
  }
  // Nothing said what to build: asked on a terminal, else the web platform.
  const pick = !templateGiven && !composing
  // When the picker will run, --mcp / --no-mcp is checked against what it picks (main).
  checkCombo(template, theme, target, pick && process.stdin.isTTY ? undefined : mcp, composeFlags)
  return {
    name,
    theme,
    template,
    target: target ?? "cloudflare",
    targetGiven: target,
    mcp,
    pm: pm ?? detectPm(),
    composeFlags,
    themeGiven,
    pick,
  }
}

/** Flags that only fit some platforms. */
function checkCombo(
  template: Template,
  theme: Theme,
  target?: Target,
  mcp?: boolean,
  c?: ComposeFlags,
) {
  if (target && template !== "api" && template !== "full")
    throw new Error("--target applies to --platform api and composed apps only.")
  if (target && template === "full") {
    if (!(RUNTIMES as readonly string[]).includes(target))
      throw new Error(
        `A composed app's API runs on ${RUNTIMES.join(", ")}: --target ${target} is for --platform api.`,
      )
    if (c?.ui) throw new Error("--target picks the API's runtime: drop --ui, or --target.")
  }
  if (
    mcp !== undefined &&
    (template === "web" || template === "cli" || template === "extension" || template === "desktop")
  )
    throw new Error("--mcp / --no-mcp apply to --platform api and composed apps only.")
  if (theme !== "editorial" && (template === "api" || c?.api))
    throw new Error("--theme applies to apps with a web UI only.")
  if (!c) return
  const withMcp = c.with.includes("mcp")
  if ((withMcp || mcp) && c.ui) throw new Error("mcp serves the API's routes: drop --ui, or mcp.")
  if ((withMcp && mcp === false) || (c.without.includes("mcp") && mcp))
    throw new Error("--with/--without mcp and --mcp/--no-mcp disagree; give one.")
}

/** Replace placeholders in every text file under dir. */
async function substitute(dir: string, vars: Record<string, string>) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await substitute(full, vars)
      continue
    }
    if (entry.name.endsWith(".png")) continue // binary: utf8 would corrupt it
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

/** Ctrl+C at a prompt: say so and leave without scaffolding. */
function cancelled(): never {
  cancel("Cancelled.")
  process.exit(130)
}

/** A prompt's answer, or Ctrl+C's exit. */
function ask<T>(answer: T): Exclude<T, symbol> {
  if (isCancel(answer)) cancelled()
  return answer as Exclude<T, symbol>
}

/** The directory name, when it was not given; only asked on a terminal. */
async function askName(): Promise<string> {
  const name = ask(
    await text({
      message: "Project name?",
      placeholder: "my-app",
      defaultValue: "my-app",
      validate: (v) => nameError(v, process.cwd()),
    }),
  )
  return name.trim() || "my-app"
}

/**
 * The picker: what you are building; for web and api, a ready-made mix and
 * its features (ticked, to adjust); the theme where there is a web UI; MCP
 * where there is an API. Rows and the mapping to flags are in src/picker.ts.
 */
async function askWhat(themeGiven?: Theme, mcpGiven?: boolean) {
  const what = ask(
    await select<Platform>({
      message: "What are you building?",
      initialValue: "web",
      options: WHAT,
    }),
  )
  let choice = choose(what)
  let ticks: PartName[] = []
  if (what === "web" || what === "api") {
    const mix = ask(
      await select<Mix>({ message: "Start from", initialValue: "basics", options: mixRows(what) }),
    )
    ticks = ask(
      await multiselect<PartName>({
        message: "Features (change any, Enter to accept)",
        options: partRows(what),
        initialValues: ticked(mix),
        required: false,
      }),
    )
    choice = choose(what, mix, ticks)
  }
  // A flag that already answered a question keeps its value; it is not asked.
  const theme = await answer(hasUi(what), themeGiven, async () =>
    ask(
      await select<Theme>({
        message: "Theme",
        initialValue: "editorial",
        options: THEMES.map((t) => ({ value: t, label: THEME_LABELS[t] ?? t })),
      }),
    ),
  )
  const mcp = await answer(hasApi(choice), mcpGiven, askMcp)
  return { what, choice, ticks, theme, mcp }
}

/** "Let AI coding agents work with this app?", default yes; only asked on a terminal. */
async function askMcp(): Promise<boolean> {
  if (!process.stdin.isTTY) return true
  return ask(
    await confirm({
      message: "Let AI coding agents work with this app? (adds an MCP server)",
      initialValue: true,
    }),
  )
}

/** A platform's template, its --target files and MCP's overlay, as they always were. */
async function copyPlatform(platform: Platform, dest: string, target: Target, mcp: boolean) {
  const templateDir = resolve(import.meta.dirname, `../${TEMPLATE_DIRS[platform]}`)
  const targetsDir = join(templateDir, "_targets")
  const mcpDir = join(templateDir, "_mcp")
  await cp(templateDir, dest, {
    recursive: true,
    filter: (src) => src !== targetsDir && src !== mcpDir,
  })
  // Only the chosen runtime's files, laid over the shared ones; MCP's tests with MCP.
  if (platform === "api") {
    await cp(join(targetsDir, target), dest, { recursive: true })
    if (mcp && existsSync(mcpDir)) await cp(mcpDir, dest, { recursive: true })
    for (const f of ["src/app.ts", "src/env.ts"]) {
      const path = join(dest, f)
      await writeFile(path, applyMcp(await readFile(path, "utf8"), mcp))
    }
  }
}

/**
 * The parts and surfaces a composed app gets. The base set is the starter's
 * (`--template full` and `--without` alone mean the full starter), then
 * --with adds, --without takes away, and needs are added. MCP is asked for
 * when nothing said, as it always was.
 */
async function pickParts(c: ComposeFlags, mcpFlag: boolean | undefined) {
  const flagged = c.ui || c.api || c.with.length > 0 || c.without.length > 0
  const starter =
    c.starter ?? (!flagged || (!c.with.length && c.without.length) ? "full" : undefined)
  const apiStarter = starter !== undefined && "surface" in STARTERS[starter]
  if (apiStarter && c.ui) throw new Error(`--starter ${starter} is the API only: drop --ui.`)
  const web = !c.api && !apiStarter
  const api = !c.ui
  // A UI-only app takes the starter's parts that have a web half.
  const base = starter ? STARTERS[starter].parts.filter((p) => api || !PARTS[p].apiOnly) : []
  const mcp = c.with.includes("mcp")
    ? true
    : c.without.includes("mcp")
      ? false
      : api && (mcpFlag ?? (await askMcp()))
  const chosen = [...base.filter((p) => !c.without.includes(p)), ...c.with, ...(mcp ? ["mcp"] : [])]
  const { parts, added } = resolveParts([...new Set(chosen)], c.without)
  for (const p of parts) {
    if (PARTS[p].apiOnly && !api) throw new Error(`${p} needs the API: drop --ui, or ${p}.`)
    if (PARTS[p].webOnly && !web) throw new Error(`${p} is web only: drop --api, or ${p}.`)
  }
  return { parts, added, web, api, starter }
}

function composedMessage(
  appName: string,
  theme: Theme,
  steps: string,
  { parts, added, web, api }: Awaited<ReturnType<typeof pickParts>>,
): string {
  const what = web && api ? "web app + API" : web ? "web app (UI only)" : "API"
  const has = (p: PartName) => parts.includes(p)
  const lines = [
    `Created ${appName}: ${what}${web ? ` with the ${theme} theme` : ""}${has("mcp") ? ", MCP at /mcp" : ""}.`,
    `Parts: ${parts.length ? parts.join(", ") : "none"}${added.length ? ` (added ${added.map((a) => `${a.part} for ${a.for}`).join(", ")})` : ""}.`,
    "",
    steps,
    "",
  ]
  if (web && api)
    lines.push(
      has("auth")
        ? "Open the URL Vite prints and sign in with any phone number; in development\n  the code is printed in this terminal."
        : "Open the URL Vite prints.",
    )
  if (web && !api)
    lines.push(
      "Set VITE_API_URL (.env.local) to your API's origin; src/lib/api.ts says how to type it.",
    )
  if (!web && has("auth"))
    lines.push(
      "Sign in with POST /api/auth/otp, then /api/auth/verify; in development the\n  code is printed in this terminal.",
    )
  if (has("admin")) lines.push("Put your number in ADMIN_PHONES (.env) to see /admin.")
  lines.push(
    `README.md walks through the first day.${api ? " The API runs on Bun,\n  whichever package manager installs it." : ""}`,
  )
  return `\n  ${lines.join("\n  ").replace(/\n {2}\n/g, "\n\n")}\n`
}

async function main() {
  const parsed = parseArgs(process.argv)
  const { target, pm, ...flags } = parsed
  let { theme, template } = parsed
  // On a terminal, a missing name or a missing platform is asked for, in one frame.
  const asking = process.stdin.isTTY && (parsed.pick || !parsed.name)
  if (asking) intro("create-signet-app")
  const name = parsed.name ?? (await askName())
  const dest = resolve(process.cwd(), name)
  const appName = basename(dest)

  // Loaded only here: it pulls in signet-mcp's index, which a plain scaffold never needs.
  const described = parsed.describe
    ? await (await import("./describe.js")).describeApp(parsed.describe.sentence, {
        template: parsed.describe.template as "web" | "api" | "full" | undefined,
        theme: parsed.describe.theme,
      })
    : undefined
  if (described) {
    ;({ theme, template } = described)
    checkCombo(template, theme, parsed.targetGiven, flags.mcp)
  }
  const picking = parsed.pick && process.stdin.isTTY
  if (picking) {
    const { what, choice, ticks, theme: picked, mcp } = await askWhat(parsed.themeGiven, flags.mcp)
    template = choice.template
    const c = parsed.composeFlags
    c.starter = choice.starter
    c.api = choice.api ?? false
    c.with = choice.with ?? []
    if (picked) theme = picked
    // Set only when the picker asked (or kept the flag); a flag is never cleared.
    if (mcp !== undefined) flags.mcp = mcp
    // The flags' combinations, checked now that the platform is known (parseArgs left MCP to here).
    checkCombo(template, theme, parsed.targetGiven, flags.mcp, c)
    const runner = `${pm === "bun" ? "bunx" : "npx"} create-signet-app`
    note(
      [
        ...summary(what, choice, ticks, picked, mcp),
        "",
        "Same as:",
        command(runner, name, choice, picked, mcp),
      ].join("\n"),
      `Creating ${appName}`,
    )
  }
  if (parsed.pm === "deno" && template === "cli")
    throw new Error(
      "--platform cli compiles one binary with `bun build --compile`; use --pm bun, npm, pnpm or yarn.",
    )

  if (existsSync(dest) && (await readdir(dest)).length > 0) {
    throw new Error(`${dest} already exists and is not empty.`)
  }

  const composed = template === "full" ? await pickParts(parsed.composeFlags, flags.mcp) : undefined
  const mcp = composed
    ? composed.parts.includes("mcp")
    : template === "api" && (flags.mcp ?? (await askMcp()))
  await mkdir(dest, { recursive: true })
  const runtime = (parsed.targetGiven ?? "bun") as Runtime
  const made = composed ? await compose(dest, { ...composed, runtime }, BASE) : undefined
  if (!composed) await copyPlatform(template as Platform, dest, target, mcp)

  // npm strips a file literally named .gitignore from published packages, so
  // the template ships it as _gitignore and it is renamed on scaffold.
  // .github goes the same way: npm can drop dot-directories from a package, so
  // the CI workflow ships under _github.
  await rename(join(dest, "_gitignore"), join(dest, ".gitignore"))
  await rename(join(dest, "_github"), join(dest, ".github"))
  if (template === "api" && (target === "bun" || target === "deno"))
    await rename(join(dest, "_dockerignore"), join(dest, ".dockerignore"))
  // pnpm (10+) refuses to install until build scripts are reviewed; esbuild's
  // (vite, drizzle-kit, wrangler) and workerd's are the ones these templates
  // pull in. allowBuilds is pnpm 11+, onlyBuiltDependencies pnpm 10.
  if (pm === "pnpm")
    await writeFile(
      join(dest, "pnpm-workspace.yaml"),
      "allowBuilds:\n  esbuild: true\n  workerd: true\nonlyBuiltDependencies:\n  - esbuild\n  - workerd\n",
    )
  // Yarn's default Plug'n'Play has no node_modules, which Vite, tsc and
  // wrangler expect; a plain node_modules works with all of them.
  if (pm === "yarn") await writeFile(join(dest, ".yarnrc.yml"), "nodeLinker: node-modules\n")
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

  if (made?.env.length)
    // The API's secrets for this machine, fresh per app; gitignored. Bun loads
    // it on its own. Production sets these on the host instead.
    await writeFile(join(dest, ".env"), made.env.join("\n"))

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
      template === "api" ? { ...API_DEPS, ...(mcp ? MCP_DEPS : {}) } : { ...DEPS, ...I18N_DEPS },
    devDependencies:
      template === "api"
        ? { ...API_DEV_DEPS, ...API_TARGETS[target].devDeps }
        : { ...DEV_DEPS, ...PWA_DEV_DEPS },
    ...(template === "api" && API_TARGETS[target].engines
      ? { engines: API_TARGETS[target].engines }
      : {}),
  }
  if (made) Object.assign(pkg, made.pkg)
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
  const out = {
    name: appName,
    private: true,
    version: "0.1.0",
    type: "module",
    ...(pm === "yarn" ? { packageManager: YARN } : {}),
    ...(template === "desktop" ? DESKTOP_PKG : final),
    // npm 11 warns on unreviewed install scripts and will block them later.
    // esbuild (under Vite and wrangler) needs its postinstall to fetch its binary.
    ...(pm === "npm" && template !== "cli" ? { allowScripts: { esbuild: true } } : {}),
  }
  if (pm === "yarn" && out.dependencies?.["@dapplelight/signet-ui"])
    out.dependencies = sortDeps({ ...UI_PEERS, ...out.dependencies })
  await writeFile(
    join(dest, "package.json"),
    `${JSON.stringify(out, null, 2)}
`,
  )

  const { install, run } = PM[pm]
  if (described && parsed.describe) {
    const { renderAgents, renderPlan } = await import("./describe.js")
    const runner = { run, x: PM[pm].x }
    await writeFile(
      join(dest, "PLAN.md"),
      renderPlan(appName, parsed.describe.sentence, described, runner),
    )
    await writeFile(join(dest, "AGENTS.md"), renderAgents(appName, described, runner))
  }
  const steps = `cd ${name}\n  ${install}\n  ${run} dev`
  // Closes the picker's frame; the next steps below are printed as they always were.
  if (asking) outro(`Scaffolded ${appName}.`)
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
            : composed
              ? composedMessage(appName, theme, steps, composed)
              : `
  Created ${appName} with the ${theme} theme.

  ${steps}

  Switch themes by editing the @dapplelight/signet-tokens import in src/app.css.
`,
  )
  if (described) {
    const names = described.pages.map((p) => p.name)
    const more = names.length - 5
    console.log(
      names.length
        ? `  Planned ${names.length} page${names.length === 1 ? "" : "s"} in PLAN.md: ${names.slice(0, 5).join(", ")}${more > 0 ? ` and ${more} more` : ""}. Hand AGENTS.md to your coding agent.\n`
        : "  No pages matched; PLAN.md lists words to try.\n",
    )
  }
}

main().catch((err: unknown) => {
  console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
