/**
 * Backend modules: registry items with `root: "app"`. Their files come from
 * packages/cli/modules and go to the app's src/, so add, upgrade, diff, list,
 * the .signet/base copies and the 3-way merge apply to them unchanged.
 *
 * What a module adds on top is wiring: an import and a `.route(...)` line in
 * src/app.ts, keys in `envSchema` in src/env.ts, and entries in .env.example.
 * Each insertion is anchored and idempotent; when an anchor is missing the
 * line is handed back for the user to add by hand.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { hash, type Registry, type Wire } from "./registry.js"

type ModuleSpec = {
  /** Paths under packages/cli/modules, which are also paths under the app's src/. */
  files: string[]
  deps?: string[]
  /** npm packages the files import; versions come from the workspace at build time. */
  npm: string[]
  wire: Wire
}

export const MODULES: Record<string, ModuleSpec> = {
  auth: {
    files: ["server/auth.ts"],
    npm: ["@dapplelight/signet-server", "hono"],
    wire: {
      imports: ['import { authRoutes } from "./server/auth.ts"'],
      routes: ['.route("/api/sessions", authRoutes())'],
      env: ["SESSION_SECRET: z.string().min(32),"],
      example: ["# auth: 32+ random characters, e.g. openssl rand -hex 32", "SESSION_SECRET="],
    },
  },
  db: {
    files: ["server/db.ts", "server/schema.ts"],
    npm: ["@dapplelight/signet-db", "@dapplelight/signet-lib", "drizzle-orm"],
    wire: {},
  },
  admin: {
    files: ["server/admin.ts"],
    deps: ["auth", "db"],
    npm: ["@dapplelight/signet-db", "@dapplelight/signet-server", "hono"],
    wire: {
      imports: ['import { adminRoutes } from "./server/admin.ts"'],
      routes: ['.route("/api/admin", adminRoutes())'],
    },
  },
  payments: {
    files: ["server/payments.ts"],
    npm: ["@dapplelight/signet-payments", "hono"],
    wire: {
      imports: ['import { paymentsRoutes } from "./server/payments.ts"'],
      routes: ['.route("/webhooks", paymentsRoutes())'],
      env: [
        "RAZORPAY_KEY_ID: z.string().min(1),",
        "RAZORPAY_KEY_SECRET: z.string().min(1),",
        "RAZORPAY_WEBHOOK_SECRET: z.string().min(1),",
        "STRIPE_SECRET_KEY: z.string().min(1),",
        "STRIPE_WEBHOOK_SECRET: z.string().min(1),",
      ],
      example: [
        "# payments: from the Razorpay and Stripe dashboards",
        "RAZORPAY_KEY_ID=",
        "RAZORPAY_KEY_SECRET=",
        "RAZORPAY_WEBHOOK_SECRET=",
        "STRIPE_SECRET_KEY=",
        "STRIPE_WEBHOOK_SECRET=",
      ],
    },
  },
  notify: {
    files: ["server/notify.ts"],
    npm: ["@dapplelight/signet-server", "hono", "zod"],
    wire: {
      imports: ['import { notifyRoutes } from "./server/notify.ts"'],
      routes: ['.route("/api/notify", notifyRoutes())'],
      env: [
        "API_URL: z.string().url(),",
        "EMAIL_FROM: z.string().min(1),",
        "NOTIFY_SECRET: z.string().min(32),",
        "RESEND_API_KEY: z.string().min(1),",
        "RESEND_WEBHOOK_SECRET: z.string().min(1),",
      ],
      example: [
        "# notify: this API's public URL, the sender, 32+ random characters, Resend keys",
        "API_URL=http://localhost:8787",
        "EMAIL_FROM=",
        "NOTIFY_SECRET=",
        "RESEND_API_KEY=",
        "RESEND_WEBHOOK_SECRET=",
      ],
    },
  },
}

type Pkg = {
  name: string
  version: string
  private?: boolean
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/** Add every module to `reg`, reading files from `modulesDir` and versions from `packagesDir`. */
export function addModules(reg: Registry, modulesDir: string, packagesDir: string): void {
  const pkgs = readdirSync(packagesDir)
    .map((d) => join(packagesDir, d, "package.json"))
    .filter(existsSync)
    .map((p) => JSON.parse(readFileSync(p, "utf8")) as Pkg)
  const range = (name: string): [string, string, boolean] => {
    const own = pkgs.find((p) => p.name === name)
    if (own) return [name, `^${own.version}`, !!own.private]
    for (const p of pkgs) {
      const r = p.peerDependencies?.[name] ?? p.dependencies?.[name]
      if (r) return [name, r, false]
    }
    throw new Error(`modules: no workspace package declares "${name}"`)
  }
  for (const [name, spec] of Object.entries(MODULES)) {
    if (reg.items[name]) throw new Error(`modules: "${name}" is also a signet-ui item`)
    for (const f of spec.files) {
      const content = readFileSync(join(modulesDir, f), "utf8")
      reg.files[f] = { hash: hash(content), content, imports: {}, root: "app" }
    }
    const npm = spec.npm.map(range)
    reg.items[name] = {
      files: spec.files,
      deps: spec.deps ?? [],
      peers: Object.fromEntries(npm.map(([n, r]) => [n, r])),
      hash: hash(spec.files.map((f) => `${f}:${reg.files[f]?.hash}`).join("\n")),
      root: "app",
      private: npm.filter(([, , p]) => p).map(([n]) => n),
      wire: spec.wire,
    }
  }
}

export type WireResult = {
  /** "file: line" for each line written. */
  added: string[]
  /** What to add by hand, where an anchor was missing. */
  manual: string[]
}

const has = (text: string, line: string) => text.split("\n").some((l) => l.trim() === line.trim())
const keyOf = (line: string) => /^\s*([A-Z0-9_]+)\s*[:=]/.exec(line)?.[1]

/** Make the insertions for `wire` in the app at `root`. Running it twice changes nothing. */
export function wire(root: string, w: Wire): WireResult {
  const res: WireResult = { added: [], manual: [] }
  const edit = (
    rel: string,
    lines: string[] | undefined,
    insert: (text: string[], line: string) => boolean,
    present: (text: string, line: string) => boolean,
    hint: string,
  ) => {
    if (!lines?.length) return
    const p = join(root, rel)
    const text = existsSync(p) ? readFileSync(p, "utf8") : undefined
    const out = text?.split("\n")
    let changed = false
    for (const line of lines) {
      if (text !== undefined && present(out?.join("\n") ?? "", line)) continue
      if (out && insert(out, line)) {
        changed = true
        res.added.push(`${rel}: ${line.trim()}`)
      } else res.manual.push(`${rel} (${hint}): ${line.trim()}`)
    }
    if (changed && out) writeFileSync(p, out.join("\n"))
  }

  // After the last import line (single or the closing line of a multi-line one).
  edit(
    "src/app.ts",
    w.imports,
    (out, line) => {
      const rev = [...out]
        .reverse()
        .findIndex((l) => /^(import\s.*|\}) from\s+["'][^"']+["']/.test(l))
      if (rev < 0) return false
      const last = out.length - 1 - rev
      out.splice(last + 1, 0, line)
      return true
    },
    has,
    "after the imports",
  )
  // Into the Hono chain, just before `.onError(`, at its indent.
  edit(
    "src/app.ts",
    w.routes,
    (out, line) => {
      const at = out.findIndex((l) => /^\s*\.onError\(/.test(l))
      if (at < 0) return false
      out.splice(at, 0, `${/^\s*/.exec(out[at] as string)?.[0]}${line}`)
      return true
    },
    has,
    "in the app's route chain",
  )
  // Into `envSchema = z.object({ ... })`, before its closing `})`.
  edit(
    "src/env.ts",
    w.env,
    (out, line) => {
      const open = out.findIndex((l) => /envSchema\s*=\s*z\.object\(\{\s*$/.test(l))
      const close = open < 0 ? -1 : out.findIndex((l, i) => i > open && /^\}\)/.test(l))
      if (close < 0) return false
      out.splice(close, 0, `  ${line}`)
      return true
    },
    (text, line) => new RegExp(`^\\s*${keyOf(line)}\\s*:`, "m").test(text),
    "inside envSchema",
  )

  // .env.example needs no anchor: missing keys are appended, under their comments.
  if (w.example?.length) {
    const p = join(root, ".env.example")
    const text = existsSync(p) ? readFileSync(p, "utf8") : ""
    const missing = w.example.filter((l) => {
      const k = keyOf(l)
      return k && !new RegExp(`^${k}=`, "m").test(text)
    })
    if (missing.length) {
      const block = [...w.example.filter((l) => l.startsWith("#")), ...missing]
      const sep = text && !text.endsWith("\n") ? "\n\n" : text ? "\n" : ""
      writeFileSync(p, `${text}${sep}${block.join("\n")}\n`)
      for (const l of missing) res.added.push(`.env.example: ${l}`)
    }
  }
  return res
}

export type PackageManager = "bun" | "pnpm" | "npm"

/** From the app's lockfile; bun when there is none. */
export function packageManager(root: string): PackageManager {
  if (["bun.lock", "bun.lockb"].some((f) => existsSync(join(root, f)))) return "bun"
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(root, "package-lock.json"))) return "npm"
  return "bun"
}

export const addCommand = (pm: PackageManager, specs: string[]) => [
  pm,
  pm === "npm" ? "install" : "add",
  ...specs,
]
