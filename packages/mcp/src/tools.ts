/** The tools, resources and prompts, built on `@dapplelight/signet-server/mcp`. */

import {
  definePrompt,
  defineResource,
  defineTool,
  type McpPrompt,
  type McpResource,
  type McpTool,
  type ToolErrorInfo,
} from "@dapplelight/signet-server/mcp"
import { z } from "zod"
import { checkApp, checkTheme } from "./checks.js"
import {
  APP_NAME,
  doc,
  migration,
  packageKey,
  scaffoldCommand,
  scaffoldFiles,
  search,
  section,
  VERSION,
} from "./content.js"
import { INDEX } from "./generated/index.js"

/** A deliberate failure: its code and message reach the client (see `mapError`). */
export class SignetMcpError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
export const mapError = (err: unknown): ToolErrorInfo | undefined =>
  err instanceof SignetMcpError ? { code: err.code, message: err.message } : undefined

const notFound = (what: string, name: string, options: string[]) =>
  new SignetMcpError("NOT_FOUND", `No ${what} "${name}". Available: ${options.join(", ")}`)

const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const

const DOC_NAMES = () => INDEX.docs.map((d) => d.name)
const THEMES = INDEX.themes.map((t) => t.name)
const template = z
  .enum(["web", "api"])
  .default("web")
  .describe("web: Vite + React + Signet UI. api: Hono Worker.")
const scaffoldInput = z.object({
  name: z
    .string()
    .regex(APP_NAME, "lowercase letters, digits, '.', '_' and '-', starting with a letter or digit")
    .describe("Directory and package name, e.g. my-app"),
  template,
  theme: z
    .enum(INDEX.scaffold.themes as [string, ...string[]])
    .default("editorial")
    .describe("Theme for the web template; ignored for api"),
})

export type ToolOptions = {
  /**
   * Let `check_app` read a directory from the local file system. On for the
   * stdio bin (it runs as the user, on their machine); off for a hosted HTTP
   * endpoint, where a path would name the server's disk, not the caller's.
   */
  fs?: boolean
}

const SKIP_DIR = /^(?:node_modules|dist|build|coverage|\..+)$/
const READ_EXT = /\.(?:ts|tsx|js|jsx|mjs|json|jsonc|css|toml)$/
const MAX_FILES = 2000
const MAX_BYTES = 512 * 1024

async function readApp(root: string): Promise<Record<string, string>> {
  const { readdir, readFile, stat } = await import("node:fs/promises")
  const { join, relative, resolve } = await import("node:path")
  const base = resolve(root)
  if (!(await stat(base).catch(() => null))?.isDirectory())
    throw new SignetMcpError("NOT_FOUND", `${base} is not a directory.`)
  const files: Record<string, string> = {}
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (Object.keys(files).length >= MAX_FILES) return
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIR.test(e.name)) await walk(full)
      } else if (READ_EXT.test(e.name) && (await stat(full)).size <= MAX_BYTES) {
        files[relative(base, full).split("\\").join("/")] = await readFile(full, "utf8")
      }
    }
  }
  await walk(base)
  return files
}

export function signetTools(options: ToolOptions = {}): McpTool[] {
  return [
    defineTool({
      name: "search_docs",
      description:
        "Search every Signet doc section, exported symbol, component and recipe by keywords. Start here when you do not know where something lives. Returns refs to pass to read_doc, get_export, get_component or recipe.",
      annotations: { title: "Search Signet", ...READ },
      input: z.object({
        query: z
          .string()
          .min(1)
          .describe("Keywords, e.g. 'rate limit durable object' or 'parseBody'"),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      handler: ({ query, limit }) => ({ query, hits: search(query, limit) }),
    }),

    defineTool({
      name: "read_doc",
      description:
        "Read a Signet doc (a package README, API, CONVENTIONS, CONTRACT, MIGRATION, CHANGELOG...) whole or one section. The same text as the signet://docs/<name> resource, for clients without resource support.",
      annotations: { title: "Read a doc", ...READ },
      input: z.object({
        name: z.string().describe(`One of: ${DOC_NAMES().join(", ")}`),
        section: z
          .string()
          .optional()
          .describe("A heading (or its slug) to return just that section, with its subsections"),
      }),
      handler: ({ name, section: heading }) => {
        const d = doc(name)
        if (!d) throw notFound("doc", name, DOC_NAMES())
        if (!heading) return d.text
        const text = section(d, heading)
        if (text === null)
          throw new SignetMcpError("NOT_FOUND", `"${name}" has no section "${heading}".`)
        return text
      },
    }),

    defineTool({
      name: "list_exports",
      description:
        "List every import path a Signet package exports, with each path's summary and symbol names. Omit package for all of them. Use get_export for a symbol's signature and doc comment.",
      annotations: { title: "List exports", ...READ },
      input: z.object({
        package: z
          .string()
          .optional()
          .describe("e.g. server, signet-server or @dapplelight/signet-server"),
      }),
      handler: ({ package: pkg }) => {
        const name = pkg ? `@dapplelight/${packageKey(pkg)}` : undefined
        const known = INDEX.packages.map((p) => p.name)
        if (name && !known.includes(name)) throw notFound("package", pkg as string, known)
        return {
          packages: INDEX.packages
            .filter((p) => !name || p.name === name)
            .map((p) => ({
              name: p.name,
              version: p.version,
              description: p.description,
              exports: INDEX.exports
                .filter((e) => e.package === p.name)
                .map((e) => ({
                  path: e.path,
                  summary: e.summary,
                  symbols: e.symbols.map((s) => s.name),
                })),
            })),
        }
      },
    }),

    defineTool({
      name: "get_export",
      description:
        "Get one exported symbol: its declaration signature, doc comment, kind and source file, plus every other import path that exports it.",
      annotations: { title: "Get an export", ...READ },
      input: z.object({
        path: z.string().describe("Exact import path, e.g. @dapplelight/signet-server/http"),
        symbol: z.string().describe("e.g. parseBody"),
      }),
      handler: ({ path, symbol }) => {
        const entry = INDEX.exports.find((e) => e.path === path)
        const elsewhere = INDEX.exports
          .filter((e) => e.symbols.some((s) => s.name === symbol))
          .map((e) => e.path)
        if (!entry)
          throw new SignetMcpError(
            "NOT_FOUND",
            `No import path "${path}".${elsewhere.length ? ` "${symbol}" is exported from: ${elsewhere.join(", ")}` : " list_exports shows them all."}`,
          )
        const info = entry.symbols.find((s) => s.name === symbol)
        if (!info)
          throw new SignetMcpError(
            "NOT_FOUND",
            `"${path}" does not export "${symbol}".${elsewhere.length ? ` Try: ${elsewhere.join(", ")}` : ` It exports: ${entry.symbols.map((s) => s.name).join(", ")}`}`,
          )
        return {
          path,
          summary: entry.summary,
          ...info,
          alsoExportedFrom: elsewhere.filter((p) => p !== path),
        }
      },
    }),

    defineTool({
      name: "list_components",
      description:
        "List the @dapplelight/signet-ui components with their import paths and exported names.",
      annotations: { title: "List components", ...READ },
      handler: () => ({
        install: "bun add @dapplelight/signet-ui @dapplelight/signet-tokens",
        components: INDEX.components.map((c) => ({
          name: c.name,
          importPath: c.importPath,
          exports: c.exports,
          ...(c.domain ? { domain: true } : {}),
        })),
      }),
    }),

    defineTool({
      name: "get_component",
      description:
        "Get one component: its props (parameter list and Props types from the source), cva variants and defaults, a usage example, and which theme-contract variables its classes read.",
      annotations: { title: "Get a component", ...READ },
      input: z.object({ name: z.string().describe("e.g. button, data-table, Button") }),
      handler: ({ name }) => {
        const key = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
        const c =
          INDEX.components.find((c) => c.name === key) ??
          INDEX.components.find((c) => c.exports.includes(name))
        if (!c)
          throw notFound(
            "component",
            name,
            INDEX.components.map((c) => c.name),
          )
        return c
      },
    }),

    defineTool({
      name: "list_themes",
      description: "List the shipped themes and how to import one.",
      annotations: { title: "List themes", ...READ },
      handler: () => ({
        themes: INDEX.themes.map(({ css: _, ...t }) => t),
        use: '@import "tailwindcss";\n@import "@dapplelight/signet-tokens/<theme>.css";\n@import "@dapplelight/signet-tokens/base.css";\n@source "../node_modules/@dapplelight/signet-ui/dist";',
      }),
    }),

    defineTool({
      name: "get_theme",
      description:
        "Get one theme: import path, description, the theme it extends, and its CSS when include_css is true (copy it to start your own theme).",
      annotations: { title: "Get a theme", ...READ },
      input: z.object({
        name: z.string().describe(`One of: ${THEMES.join(", ")}`),
        include_css: z.boolean().default(false),
      }),
      handler: ({ name, include_css }) => {
        const t = INDEX.themes.find((t) => t.name === name.replace(/\.css$/, ""))
        if (!t) throw notFound("theme", name, THEMES)
        const { css, ...rest } = t
        return { ...rest, ...(include_css ? { css } : {}) }
      },
    }),

    defineTool({
      name: "list_tokens",
      description: `List the theme contract's variables (${INDEX.contractCounts.required} required, ${INDEX.contractCounts.optional} optional) with their group. A theme is valid when it defines every required one.`,
      annotations: { title: "List contract tokens", ...READ },
      input: z.object({ kind: z.enum(["required", "optional", "domain"]).optional() }),
      handler: ({ kind }) => ({
        counts: INDEX.contractCounts,
        tokens: INDEX.tokens.filter((t) => !kind || t.kind === kind),
      }),
    }),

    defineTool({
      name: "check_theme",
      description:
        "Validate a theme's CSS against CONTRACT.md: every required variable defined, optional slots wired in both modes, Tailwind's stock palette untouched, no @source, and WCAG contrast for the text, ring and input pairs (light and dark) as the tokens package's own test checks them. Returns findings with fixes.",
      annotations: { title: "Check a theme", ...READ },
      input: z.object({ css: z.string().min(1).describe("The theme file's full CSS") }),
      handler: ({ css }) => checkTheme(css),
    }),

    defineTool({
      name: "scaffold_app",
      description:
        "Get the exact create-signet-app command for a new web app or Worker API, the files it will create, and the next steps. Use scaffold_files instead if you cannot run a shell.",
      annotations: { title: "Plan a new app", ...READ },
      input: scaffoldInput,
      handler: ({ name, template, theme }) => ({
        command: scaffoldCommand(name, template, theme),
        next: [`cd ${name}`, "bun install", "bun dev"],
        files: scaffoldFiles(name, template, theme).map((f) => f.path),
        notes:
          template === "api"
            ? "Hono Worker with request ids, the error envelope, validation, CSRF and exact Durable Object rate limiting. Append wrangler migration tags; never edit a deployed one."
            : `Vite + React 19 + Tailwind v4 with the ${theme} theme, TanStack Router and Query, sonner. Switch themes in src/app.css.`,
      }),
    }),

    defineTool({
      name: "scaffold_files",
      description:
        "Return every file create-signet-app would write (path and full contents, package.json included), for an agent that writes files itself. Write them under a new directory named after the app, then run bun install.",
      annotations: { title: "Scaffold files", ...READ },
      input: scaffoldInput,
      handler: ({ name, template, theme }) => ({
        root: name,
        files: scaffoldFiles(name, template, theme),
      }),
    }),

    defineTool({
      name: "check_app",
      description: `Check an app against Signet's conventions: no env read at module scope in server modules, rate limiting wired with a trust setting, signet-doctor's Durable Object binding/migration/export checks, CSRF, the error handler, the env schema against wrangler vars, Tailwind @source for the components, and (in the Signet repo) no domain vocabulary in base packages. Pass files (path -> contents, relative to the app root)${options.fs ? " or a local directory path" : ""}. Returns findings with fixes.`,
      annotations: { title: "Check an app", ...READ },
      input: z.object({
        ...(options.fs
          ? {
              path: z
                .string()
                .optional()
                .describe(
                  "App root on this machine, absolute or relative to the server's working directory",
                ),
            }
          : {}),
        files: z
          .record(z.string(), z.string())
          .optional()
          .describe('e.g. { "src/index.ts": "...", "wrangler.jsonc": "..." }'),
      }),
      handler: async (input) => {
        const path = (input as { path?: string }).path // in the schema only when fs is on
        if (input.files) return checkApp(input.files)
        if (options.fs && path) return checkApp(await readApp(path))
        throw new SignetMcpError("BAD_REQUEST", `Pass files${options.fs ? " or path" : ""}.`)
      },
    }),

    defineTool({
      name: "recipe",
      description: `Step-by-step, code-included recipe for a common job, assembled from the Signet docs: what to install, the doc sections in order, and how to verify. Tasks: ${INDEX.recipes.map((r) => r.id).join(", ")}. Free text works too.`,
      annotations: { title: "Get a recipe", ...READ },
      input: z.object({
        task: z.string().min(1).describe("A recipe id or a description, e.g. 'add rate limit'"),
      }),
      handler: ({ task }) => {
        const q = task.toLowerCase().replace(/[_\s]+/g, "-")
        const words = task
          .toLowerCase()
          .split(/[^\w]+/)
          .filter((w) => w.length > 2 && w !== "add")
        const r =
          INDEX.recipes.find((r) => r.id === q || r.id === `add-${q}`) ??
          INDEX.recipes
            .map((r) => ({
              r,
              score:
                r.keywords.filter((k) => task.toLowerCase().includes(k)).length * 2 +
                words.filter((w) =>
                  `${r.id} ${r.title} ${r.keywords.join(" ")}`.toLowerCase().includes(w),
                ).length,
            }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)[0]?.r
        if (!r)
          throw notFound(
            "recipe for",
            task,
            INDEX.recipes.map((r) => r.id),
          )
        return { ...r, install: `bun add ${r.install.join(" ")}` }
      },
    }),

    defineTool({
      name: "migration",
      description:
        "What changed between two versions, from CHANGELOG.md (with the breaking and migration bullets pulled out) plus any 'Migrating from' section in the package's README. Gives current versions too.",
      annotations: { title: "Migration notes", ...READ },
      input: z.object({
        from: z.string().regex(VERSION).describe("The version you are on, e.g. 0.3.0"),
        to: z
          .string()
          .regex(new RegExp(`${VERSION.source}|^unreleased$`))
          .default("unreleased")
          .describe("Target version, or 'unreleased' for everything after from"),
        package: z.string().optional().describe("e.g. server; omit for every package"),
      }),
      handler: ({ from, to, package: pkg }) => migration(from, to, pkg),
    }),
  ]
}

export function signetResources(): McpResource[] {
  return [
    defineResource({
      name: "docs",
      title: "Signet docs",
      description:
        "Every Signet doc: package READMEs, API, CONVENTIONS, CONTRACT, MIGRATION, CHANGELOG.",
      template: "signet://docs/{name}",
      mimeType: "text/markdown",
      list: () =>
        INDEX.docs.map((d) => ({
          uri: `signet://docs/${d.name}`,
          name: d.name,
          title: d.title,
          description: d.path,
          mimeType: "text/markdown",
        })),
      read: ({ variables }) => doc(variables.name ?? "")?.text ?? null,
    }),
  ]
}

export function signetPrompts(): McpPrompt[] {
  return [
    definePrompt({
      name: "build-signet-app",
      title: "Build a Signet app",
      description: "Plan and build a new app on Signet, end to end.",
      args: z.object({
        idea: z.string().describe("What the app does"),
        template: z.string().optional().describe("web or api (default web)"),
      }),
      render: ({ idea, template = "web" }) =>
        [
          `Build this on Signet: ${idea}`,
          "",
          "Work through the signet MCP tools, not memory:",
          `1. scaffold_app with template "${template}" (and a theme from list_themes for web). Run the command, or write scaffold_files if you have no shell.`,
          "2. For each feature, call recipe (e.g. add-auth, add-rate-limit, add-csrf, add-error-envelope, add-api-client) and follow its steps and code.",
          "3. For UI, list_components then get_component for props, variants and an example. Style only through theme tokens; never hard-code colours.",
          "4. Before writing an import, confirm the path and signature with get_export (or search_docs).",
          "5. Finish with check_app on the project and fix every error it reports, then run bun run lint, bun run typecheck and bun run test.",
          "",
          "Conventions: TypeScript strict, Vite + React, Tailwind v4, Hono on Workers, Drizzle, TanStack Form + zod, sonner, Biome. Server modules take config and never read env at module scope.",
        ].join("\n"),
    }),
    definePrompt({
      name: "review-against-signet",
      title: "Review against Signet",
      description: "Review an app or a change against Signet's conventions and contracts.",
      args: z.object({ target: z.string().optional().describe("A path, a PR, or what to review") }),
      render: ({ target }) =>
        [
          `Review ${target ?? "this app"} against Signet.`,
          "",
          "1. Run check_app on it and report every finding, ranked, with its fix.",
          "2. Run check_theme on any theme CSS it defines.",
          "3. Read signet://docs/conventions (or read_doc conventions) and flag code that rebuilds what Signet ships: a hand-rolled fetch wrapper, error envelope, rate limiter, env loader, toast, form error mapping. Name the Signet export that replaces it (search_docs, get_export).",
          "4. Check imports against list_exports: every path must exist exactly as written.",
          "5. If it pins older Signet versions, run migration from its version to see what it is missing.",
          "Report findings only; do not change code unless asked.",
        ].join("\n"),
    }),
    definePrompt({
      name: "add-signet-feature",
      title: "Add a Signet feature",
      description:
        "Add one feature (auth, rate limit, CSRF, push, AI extraction, analytics, MCP tools...) to an existing app the Signet way.",
      args: z.object({
        feature: z.string().describe("e.g. rate limiting, web push, AI extraction"),
        app: z.string().optional().describe("Path or name of the app"),
      }),
      render: ({ feature, app }) =>
        [
          `Add ${feature} to ${app ?? "this app"} using Signet.`,
          "",
          `1. Call recipe with "${feature}". Install what it lists and follow its steps in order, adapting the code to this app.`,
          "2. Verify every import with get_export before writing it.",
          "3. Wire config through the createEnv schema; never read env at module scope.",
          "4. Run check_app and fix what it reports, then the recipe's verify steps, then bun run lint, typecheck and test.",
        ].join("\n"),
    }),
  ]
}

export const INSTRUCTIONS = `Signet is a TypeScript kit for web apps and their APIs: token-driven React components, CSS-variable themes, a Hono/Workers server kit, a client lib and structured AI calls. These tools answer from the Signet repo itself, indexed when this server was built.

Start with search_docs when unsure. Before writing an import, confirm it with get_export. New app: scaffold_app (or scaffold_files without a shell). A feature: recipe. UI: list_components, get_component. Themes: list_themes, get_theme, check_theme. Before finishing: check_app. Upgrading: migration. Docs are resources at signet://docs/<name> and through read_doc.`
