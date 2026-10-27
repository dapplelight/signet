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

const THEMES = ["editorial", "cinematic"] as const
type Theme = (typeof THEMES)[number]
const TEMPLATES = ["web", "api"] as const
type Template = (typeof TEMPLATES)[number]

// The api template: a Hono Worker with Signet's request id, error envelope,
// validation and exact Durable Object rate limiting already wired.
const API_DEPS = {
  "@dapplelight/signet-server": "^0.3.0",
  hono: "^4.13.8",
  zod: "^4.6.5",
}

const API_DEV_DEPS = {
  "@biomejs/biome": "^2.5.14",
  "@types/bun": "^1.4.2",
  typescript: "^7.0.2",
  wrangler: "^4.136.3",
}

const DEPS = {
  // Real ranges, not workspace:* — the packages are published, so a scaffolded
  // app installs from npm and works anywhere. Inside this monorepo bun still
  // links the local copies, because the range matches the workspace version.
  "@dapplelight/signet-lib": "^0.2.0",
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
    } else if (a === "--help" || a === "-h") {
      console.log(`
create-signet-app <directory> [options]

Options:
  --template <kind>    web | api   (default: web)
                       web: Vite + React + Signet UI
                       api: Hono Worker with the error envelope, request ids,
                            validation and Durable Object rate limiting
  -t, --theme <name>   ${THEMES.join(" | ")}   (default: editorial; web only)
  -h, --help

Examples:
  bun create-signet-app my-app --theme cinematic
  bun create-signet-app my-api --template api
`)
      process.exit(0)
    } else if (!a.startsWith("-")) {
      name = a
    } else {
      throw new Error(`Unknown option "${a}"`)
    }
  }

  if (!name) throw new Error("Missing target directory.\nUsage: create-signet-app <directory>")
  return { name, theme, template }
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

async function main() {
  const { name, theme, template } = parseArgs(process.argv)
  const target = resolve(process.cwd(), name)
  const appName = basename(target)

  if (existsSync(target) && (await readdir(target)).length > 0) {
    throw new Error(`${target} already exists and is not empty.`)
  }

  const templateDir = resolve(
    import.meta.dirname,
    template === "api" ? "../template-api" : "../template",
  )
  await mkdir(target, { recursive: true })
  await cp(templateDir, target, { recursive: true })

  // npm strips a file literally named .gitignore from published packages, so
  // the template ships it as _gitignore and it is renamed on scaffold.
  // .github goes the same way: npm can drop dot-directories from a package, so
  // the CI workflow ships under _github.
  await rename(join(target, "_gitignore"), join(target, ".gitignore"))
  await rename(join(target, "_github"), join(target, ".github"))

  await substitute(target, { __APP_NAME__: appName, __THEME__: theme })

  await writeFile(
    join(target, "package.json"),
    `${JSON.stringify(
      {
        name: appName,
        private: true,
        version: "0.1.0",
        type: "module",
        scripts:
          template === "api"
            ? {
                dev: "wrangler dev",
                deploy: "wrangler deploy",
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
        dependencies: template === "api" ? API_DEPS : DEPS,
        devDependencies: template === "api" ? API_DEV_DEPS : DEV_DEPS,
      },
      null,
      2,
    )}\n`,
  )

  console.log(
    template === "api"
      ? `
  Created ${appName}, a Worker API.

  cd ${name}
  bun install
  bun dev

  Rate limiting is exact and per IP, backed by the RateLimitCounter Durable
  Object in wrangler.jsonc. Append migration tags; never edit a deployed one.
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
