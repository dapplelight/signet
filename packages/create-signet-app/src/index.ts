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

const THEMES = ["editorial", "cinematic"] as const
type Theme = (typeof THEMES)[number]
const TEMPLATES = ["web", "api"] as const
type Template = (typeof TEMPLATES)[number]
const TARGETS = ["cloudflare", "bun", "node", "vercel"] as const
type Target = (typeof TARGETS)[number]

// The api template: a Hono Worker with Signet's request id, error envelope,
// validation and exact Durable Object rate limiting already wired.
const API_DEPS = {
  "@dapplelight/signet-server": "^0.4.0",
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
  "@dapplelight/signet-lib": "^0.3.0",
  "@dapplelight/signet-tokens": "^0.2.0",
  "@dapplelight/signet-ui": "^0.2.0",
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

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  let name: string | undefined
  let theme: Theme = "editorial"
  let template: Template = "web"
  let target: Target | undefined
  let mcp: boolean | undefined

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
    } else if (a === "--mcp" || a === "--no-mcp") {
      mcp = a === "--mcp"
    } else if (a === "--help" || a === "-h") {
      console.log(`
create-signet-app <directory> [options]

Options:
  --template <kind>    web | api   (default: web)
                       web: Vite + React + Signet UI
                       api: Hono Worker with the error envelope, request ids,
                            validation and Durable Object rate limiting
  --target <runtime>   ${TARGETS.join(" | ")}   (default: cloudflare; api only)
                       cloudflare: Worker entry + wrangler.jsonc
                       bun: Bun.serve entry + Dockerfile
                       node: node:http entry (Node 22.18+)
                       vercel: Vercel entry + vercel.json
  --mcp, --no-mcp      api only: serve the routes to agents at /mcp
                       (default: asks when interactive, else --mcp)
  -t, --theme <name>   ${THEMES.join(" | ")}   (default: editorial; web only)
  -h, --help

Examples:
  bun create-signet-app my-app --theme cinematic
  bun create-signet-app my-api --template api
  bun create-signet-app my-api --template api --target bun
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
  if (mcp !== undefined && template !== "api")
    throw new Error("--mcp / --no-mcp apply to --template api only.")
  return { name, theme, template, target: target ?? "cloudflare", mcp }
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
  const { name, theme, template, target, ...flags } = parseArgs(process.argv)
  const dest = resolve(process.cwd(), name)
  const appName = basename(dest)

  if (existsSync(dest) && (await readdir(dest)).length > 0) {
    throw new Error(`${dest} already exists and is not empty.`)
  }

  const mcp = template === "api" && (flags.mcp ?? (await askMcp()))
  const templateDir = resolve(
    import.meta.dirname,
    template === "api" ? "../template-api" : "../template",
  )
  await mkdir(dest, { recursive: true })
  const targetsDir = join(templateDir, "_targets")
  const mcpDir = join(templateDir, "_mcp")
  await cp(templateDir, dest, {
    recursive: true,
    filter: (src) => src !== targetsDir && src !== mcpDir,
  })
  // Only the chosen runtime's files, laid over the shared ones; MCP's tests with MCP.
  if (template === "api") {
    await cp(join(targetsDir, target), dest, { recursive: true })
    if (mcp) await cp(mcpDir, dest, { recursive: true })
    for (const f of ["src/app.ts", "src/env.ts"]) {
      const path = join(dest, f)
      await writeFile(path, applyMcp(await readFile(path, "utf8"), mcp))
    }
  }

  // npm strips a file literally named .gitignore from published packages, so
  // the template ships it as _gitignore and it is renamed on scaffold.
  // .github goes the same way: npm can drop dot-directories from a package, so
  // the CI workflow ships under _github.
  await rename(join(dest, "_gitignore"), join(dest, ".gitignore"))
  await rename(join(dest, "_github"), join(dest, ".github"))
  if (template === "api" && target === "bun")
    await rename(join(dest, "_dockerignore"), join(dest, ".dockerignore"))

  await substitute(dest, { __APP_NAME__: appName, __THEME__: theme })

  await writeFile(
    join(dest, "package.json"),
    `${JSON.stringify(
      {
        name: appName,
        private: true,
        version: "0.1.0",
        type: "module",
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
        dependencies: template === "api" ? { ...API_DEPS, ...(mcp ? MCP_DEPS : {}) } : DEPS,
        devDependencies:
          template === "api" ? { ...API_DEV_DEPS, ...API_TARGETS[target].devDeps } : DEV_DEPS,
        ...(template === "api" && API_TARGETS[target].engines
          ? { engines: API_TARGETS[target].engines }
          : {}),
      },
      null,
      2,
    )}\n`,
  )

  console.log(
    template === "api"
      ? `
  Created ${appName}, an API for ${target}${mcp ? ", with MCP at /mcp (MCP=off turns it off)" : ""}.

  cd ${name}
  bun install
  bun dev

  ${API_NEXT_STEPS[target]}
`
      : `
  Created ${appName} with the ${theme} theme.

  cd ${name}
  bun install
  bun dev

  Switch themes by editing the @dapplelight/signet-tokens import in src/app.css.
`,
  )
}

main().catch((err: unknown) => {
  console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
