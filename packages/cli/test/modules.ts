/**
 * Backend modules and codemods against apps made from create-signet-app's
 * api template: add every module twice under each package manager, an
 * anchor that is missing, edit then upgrade, a typecheck of the wired app
 * against the workspace packages, and the codemods in dry run and for real.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "../src/core.js"
import { hash, type Registry } from "../src/registry.js"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const PKG = new URL("..", import.meta.url).pathname
const PACKAGES = join(PKG, "..")
const CLI = join(PKG, "src/index.ts")
const reg = JSON.parse(readFileSync(join(PKG, "dist/registry.json"), "utf8")) as Registry
const TEMPLATE = join(PACKAGES, "create-signet-app/template-api")
const TMP = join(tmpdir(), "signet-cli-modules-test")
const MODULES = ["auth", "db", "payments", "notify", "admin"]

const cli = (root: string, ...args: string[]) => {
  const r = Bun.spawnSync(["bun", CLI, ...args, "--cwd", root])
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }
}
const read = (root: string, p: string) => readFileSync(join(root, p), "utf8")
const count = (s: string, sub: string) => s.split(sub).length - 1

/** An app from the api template (MCP on), with `lockfile` to pick its package manager. */
function apiApp(root: string, lockfile?: string): string {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, "src"), { recursive: true })
  for (const f of ["app.ts", "env.ts"])
    writeFileSync(
      join(root, "src", f),
      read(TEMPLATE, `src/${f}`).replace(/^[ \t]*\/\/ mcp:(begin|end)\n/gm, ""),
    )
  cpSync(join(TEMPLATE, "tsconfig.json"), join(root, "tsconfig.json"))
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "api",
      dependencies: { "@dapplelight/signet-server": "^0.4.0", hono: "^4.13.8", zod: "^4.6.5" },
    }),
  )
  if (lockfile) writeFileSync(join(root, lockfile), "")
  return root
}

/** A copy of the registry with one module file changed upstream. */
function bump(r: Registry, path: string, fn: (s: string) => string): Registry {
  const next = structuredClone(r)
  const f = next.files[path] as Registry["files"][string]
  f.content = fn(f.content)
  f.hash = hash(f.content)
  for (const item of Object.values(next.items))
    if (item.files.includes(path))
      item.hash = hash(item.files.map((p) => `${p}:${next.files[p]?.hash}`).join("\n"))
  next.version = "9.9.9"
  return next
}

rmSync(TMP, { recursive: true, force: true })
try {
  // ---- registry
  ok(
    "registry: modules are app-root items with npm versions from the workspace",
    MODULES.every((n) => reg.items[n]?.root === "app") &&
      reg.items.auth?.peers["@dapplelight/signet-server"] ===
        `^${JSON.parse(read(PACKAGES, "server/package.json")).version}` &&
      JSON.stringify(reg.items.admin?.deps) === JSON.stringify(["auth", "db"]) &&
      reg.items.db?.private?.includes("@dapplelight/signet-db") === true &&
      !reg.items.payments?.private?.length,
    reg.items.admin,
  )

  // ---- add every module, twice, under each package manager
  const pms: [string, string | undefined, string][] = [
    ["bun", "bun.lock", "bun add "],
    ["pnpm", "pnpm-lock.yaml", "pnpm add "],
    ["npm", "package-lock.json", "npm install "],
    ["none", undefined, "bun add "],
  ]
  for (const [name, lock, cmd] of pms) {
    const a = apiApp(join(TMP, `pm-${name}`), lock)
    const r1 = cli(a, "add", ...MODULES, "--no-install")
    const snapshot = ["src/app.ts", "src/env.ts", ".env.example"].map((p) => read(a, p))
    const r2 = cli(a, "add", ...MODULES, "--no-install")
    const app = read(a, "src/app.ts")
    const env = read(a, "src/env.ts")
    const example = read(a, ".env.example")
    ok(
      `add (${name}): exits 0 and writes every module under src/server`,
      r1.code === 0 &&
        r2.code === 0 &&
        ["auth", "db", "schema", "payments", "notify", "admin"].every((f) =>
          existsSync(join(a, `src/server/${f}.ts`)),
        ),
      r1.out,
    )
    ok(
      `add (${name}): prints the install for its package manager, public packages only`,
      r1.out.includes(cmd) &&
        r1.out.includes("@dapplelight/signet-payments@^") &&
        r1.out.includes("drizzle-orm@") &&
        !r1.out.includes("signet-db@") &&
        !r1.out.includes("@dapplelight/signet-server@") &&
        r1.out.includes("@dapplelight/signet-db: not on npm yet, link it from a Signet checkout"),
      r1.out,
    )
    ok(
      `add (${name}): routes, imports, env keys and .env.example entries go in once`,
      [
        '.route("/api/sessions", authRoutes())',
        '.route("/api/admin", adminRoutes())',
        '.route("/webhooks", paymentsRoutes())',
        '.route("/notify", notifyRoutes())',
        'import { authRoutes } from "./server/auth.ts"',
      ].every((l) => count(app, l) === 1) &&
        app.indexOf('.route("/api/sessions"') < app.indexOf(".onError(") &&
        ["SESSION_SECRET:", "STRIPE_SECRET_KEY:", "NOTIFY_SECRET:"].every(
          (k) => count(env, k) === 1,
        ) &&
        env.indexOf("SESSION_SECRET:") < env.indexOf("export type Env") &&
        ["SESSION_SECRET=", "RAZORPAY_KEY_ID=", "RESEND_API_KEY="].every(
          (k) => count(example, k) === 1,
        ),
      { app, env, example },
    )
    ok(
      `add (${name}): the second add changes nothing`,
      ["src/app.ts", "src/env.ts", ".env.example"].every((p, i) => read(a, p) === snapshot[i]) &&
        !r2.out.includes("wired "),
      r2.out,
    )
  }

  // ---- a missing anchor: the lines are printed, nothing is guessed
  const bare = apiApp(join(TMP, "bare"), "bun.lock")
  writeFileSync(join(bare, "src/app.ts"), "export const app = 1\n")
  const rb = cli(bare, "add", "auth", "--no-install")
  ok(
    "add: without an anchor the line is printed to add by hand",
    rb.code === 0 &&
      rb.out.includes("Add these by hand") &&
      rb.out.includes('.route("/api/sessions", authRoutes())') &&
      read(bare, "src/app.ts") === "export const app = 1\n" &&
      read(bare, "src/env.ts").includes("SESSION_SECRET:"),
    rb.out,
  )

  // ---- edit, then upgrade: the 3-way merge applies to module files too
  const u = apiApp(join(TMP, "upgrade"), "bun.lock")
  cli(u, "add", "auth", "--no-install")
  const authPath = join(u, "src/server/auth.ts")
  writeFileSync(authPath, `// app: our tweak\n${readFileSync(authPath, "utf8")}`)
  const up = bump(reg, "server/auth.ts", (s) => `${s}\n// upstream: new helper\n`)
  writeFileSync(join(TMP, "up.json"), JSON.stringify(up))
  const dry = cli(u, "upgrade", "--dry-run", "--registry", join(TMP, "up.json"))
  ok(
    "upgrade --dry-run: reports the merge of an edited module file, writes nothing",
    dry.code === 0 &&
      dry.out.includes("merged      server/auth.ts") &&
      !read(u, "src/server/auth.ts").includes("upstream: new helper"),
    dry.out,
  )
  const ru = cli(u, "upgrade", "--registry", join(TMP, "up.json"))
  const merged = read(u, "src/server/auth.ts")
  ok(
    "upgrade: keeps the app edit, brings upstream's, and leaves the wiring as it was",
    ru.code === 0 &&
      merged.includes("// app: our tweak") &&
      merged.includes("// upstream: new helper") &&
      loadConfig(u).items.auth?.version === "9.9.9" &&
      count(read(u, "src/app.ts"), '.route("/api/sessions"') === 1,
    ru.out,
  )

  // ---- the wired app typechecks against the workspace packages (their dist)
  const tc = apiApp(join(PKG, ".typecheck-modules"), "bun.lock")
  cli(tc, "add", ...MODULES, "--no-install")
  mkdirSync(join(tc, "node_modules/@dapplelight"), { recursive: true })
  const links: [string, string][] = [
    ["@dapplelight/signet-server", "server"],
    ["@dapplelight/signet-db", "db"],
    ["@dapplelight/signet-payments", "payments"],
    ["@dapplelight/signet-lib", "lib"],
    ["hono", "server/node_modules/hono"],
    ["zod", "server/node_modules/zod"],
    ["drizzle-orm", "db/node_modules/drizzle-orm"],
  ]
  for (const [name, target] of links)
    symlinkSync(join(PACKAGES, target), join(tc, "node_modules", name))
  const tsc = Bun.spawnSync(["bun", join(PKG, "node_modules/.bin/tsc"), "-p", tc])
  rmSync(tc, { recursive: true, force: true })
  ok(
    "typecheck: the api template with every module wired compiles (env keys, routes, imports)",
    tsc.exitCode === 0,
    tsc.stdout.toString().slice(0, 3000),
  )

  // ---- codemods
  const cm = join(PKG, ".codemod-app")
  rmSync(cm, { recursive: true, force: true })
  mkdirSync(join(cm, "src"), { recursive: true })
  mkdirSync(join(cm, "node_modules"))
  symlinkSync(join(PKG, "node_modules/typescript"), join(cm, "node_modules/typescript"))
  writeFileSync(
    join(cm, "package.json"),
    JSON.stringify({
      name: "cm",
      dependencies: {
        "@dapplelight/signet-ai": "^0.4.0",
        "@dapplelight/signet-db": "^0.1.0",
        "@dapplelight/signet-server": "^0.5.0",
        ai: "^6.0.0",
        zod: "^4.0.0",
      },
    }),
  )
  const extract = `import { generateObject, type LanguageModel } from "ai"
import { z } from "zod"

const schema = z.object({ name: z.string() })
const note = "generateObject({ schema }) in a string stays"

export async function one(model: LanguageModel) {
  const result = await generateObject({ model, schema, prompt: "a name" })
  return result.object.name
}

export async function two(model: LanguageModel) {
  // generateObject({ schema }) in a comment stays
  const { object } = await generateObject({
    model,
    schema: z.object({ tags: z.array(z.string()) }),
    prompt: \`tags for \${note}\`,
  })
  return object.tags
}
`
  writeFileSync(join(cm, "src/extract.ts"), extract)
  const billing = `export async function grant(ent: { setPlan(s: string, p: string): Promise<unknown> }) {
  await ent.setPlan("org_1", "pro")
}
declare function registerIngest(app: unknown, path: string, opts: object): void
registerIngest({}, "/a", { sink: null })
registerIngest({}, "/b", { sink: null, userId: () => "u" })
`
  writeFileSync(join(cm, "src/billing.ts"), billing)

  const d = cli(cm, "upgrade", "--dry-run")
  ok(
    "codemods --dry-run: prints diffs and notes, writes nothing",
    d.code === 0 &&
      d.out.includes(
        "+  const result = await generateText({ model, output: Output.object({ schema }), prompt",
      ) &&
      d.out.includes('+    "ai": "^7.0.0"') &&
      d.out.includes("src/billing.ts:2: setPlan") &&
      d.out.includes("src/billing.ts:5: TODO a client-sent userId") &&
      !d.out.includes("src/billing.ts:6:") &&
      read(cm, "src/extract.ts") === extract &&
      !loadConfig(cm).codemods,
    d.out,
  )
  const ap = cli(cm, "upgrade")
  const rewritten = read(cm, "src/extract.ts")
  ok(
    "codemods: generateObject becomes generateText with Output.object and result.output",
    ap.code === 0 &&
      rewritten.includes('import { generateText, Output, type LanguageModel } from "ai"') &&
      rewritten.includes(
        'await generateText({ model, output: Output.object({ schema }), prompt: "a name" })',
      ) &&
      rewritten.includes("return result.output.name") &&
      rewritten.includes(
        "output: Output.object({ schema: z.object({ tags: z.array(z.string()) }) }),",
      ) &&
      rewritten.includes("const { output: object } = await generateText({") &&
      rewritten.includes('"generateObject({ schema }) in a string stays"') &&
      rewritten.includes("// generateObject({ schema }) in a comment stays") &&
      JSON.parse(read(cm, "package.json")).dependencies.ai === "^7.0.0",
    rewritten + ap.out,
  )
  ok(
    "codemods: recorded in signet.json and not run again",
    loadConfig(cm).codemods?.length === 3 && !cli(cm, "upgrade").out.includes("Codemod:"),
  )
  // The rewritten file compiles against AI SDK 7 (the workspace's ai).
  writeFileSync(
    join(cm, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
      files: ["src/extract.ts"],
    }),
  )
  const tsc2 = Bun.spawnSync(["bun", join(PKG, "node_modules/.bin/tsc"), "-p", cm])
  ok(
    "codemods: the rewritten file typechecks against ai 7",
    tsc2.exitCode === 0,
    tsc2.stdout.toString().slice(0, 2000),
  )
  rmSync(cm, { recursive: true, force: true })

  const nots = join(TMP, "no-ts")
  mkdirSync(nots, { recursive: true })
  writeFileSync(
    join(nots, "package.json"),
    JSON.stringify({ dependencies: { "@dapplelight/signet-ai": "^0.4.0" } }),
  )
  const nt = cli(nots, "upgrade")
  ok(
    "codemods: without typescript in the app they are reported, not failed",
    nt.code === 0 && nt.out.includes("Codemods not run") && nt.out.includes("typescript"),
    nt.out,
  )
} finally {
  rmSync(TMP, { recursive: true, force: true })
  rmSync(join(PKG, ".typecheck-modules"), { recursive: true, force: true })
  rmSync(join(PKG, ".codemod-app"), { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
