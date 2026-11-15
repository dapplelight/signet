/**
 * The registry: every signet-ui item an app can copy in, built from
 * packages/ui at build time (`bun run build` writes dist/registry.json).
 *
 * An item is one subpath of signet-ui's `exports` map (`./components/button`
 * is `button`, `./utils` is `utils`). Its files are the entry plus any
 * non-exported file it reaches by relative import; an exported module it
 * reaches is a dependency instead, so `add dialog` also adds `button` and
 * `utils` as items of their own that can be upgraded on their own.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, posix } from "node:path"

export type RegistryFile = {
  hash: string
  content: string
  /** Each relative import specifier in the file -> the registry path it resolves to. */
  imports: Record<string, string>
  /** "app": a backend module file, copied to the app's src/ as is, not to `dir`. */
  root?: "app"
}
export type RegistryItem = {
  /** Paths relative to signet-ui's src, e.g. components/ui/button.tsx. */
  files: string[]
  /** Other items this one imports. */
  deps: string[]
  /** npm packages the files import, with signet-ui's range for each. */
  peers: Record<string, string>
  /** Changes whenever any of `files` changes. */
  hash: string
  /** "app": a backend module (src/modules.ts); its files go under the app's src/. */
  root?: "app"
  /** Peers that are not on npm yet (`private: true` in the Signet repo). */
  private?: string[]
  /** Lines a backend module adds to src/app.ts, src/env.ts and .env.example. */
  wire?: Wire
}

export type Wire = {
  /** Import lines for src/app.ts, put after its last import. */
  imports?: string[]
  /** Route lines for the Hono chain in src/app.ts, put before `.onError(`. */
  routes?: string[]
  /** `KEY: zod schema,` lines for `envSchema` in src/env.ts. */
  env?: string[]
  /** Lines for .env.example; `#` lines are comments over the keys. */
  example?: string[]
}
export type Registry = {
  /** signet-ui's version when the registry was built. */
  version: string
  items: Record<string, RegistryItem>
  files: Record<string, RegistryFile>
}

export const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12)

/** `from "x"`, `import "x"`, `import("x")`. Group 3 is the specifier. */
export const IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]+)\2/g

const packageName = (spec: string) =>
  spec
    .split("/")
    .slice(0, spec.startsWith("@") ? 2 : 1)
    .join("/")

export function buildRegistry(uiDir: string): Registry {
  const pkg = JSON.parse(readFileSync(join(uiDir, "package.json"), "utf8")) as {
    version: string
    exports: Record<string, { import: string }>
    peerDependencies?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const src = join(uiDir, "src")

  /** `components/ui/button` or `./button.js` from a file -> `components/ui/button.tsx`. */
  const resolveFile = (noExt: string): string => {
    for (const c of [".tsx", ".ts", "/index.tsx", "/index.ts"])
      if (existsSync(join(src, noExt + c))) return noExt + c
    throw new Error(`registry: cannot resolve ${noExt} in signet-ui/src`)
  }

  const entries = new Map<string, string>() // file -> item name
  for (const [key, target] of Object.entries(pkg.exports)) {
    if (key === ".") continue
    const name = key.split("/").pop() as string
    const file = resolveFile(target.import.replace(/^\.\/dist\//, "").replace(/\.js$/, ""))
    for (const [f, n] of entries)
      if (n === name) throw new Error(`registry: two items named "${name}" (${f}, ${file})`)
    entries.set(file, name)
  }

  const files: Record<string, RegistryFile> = {}
  const bare = new Map<string, Set<string>>() // file -> npm packages
  const load = (path: string): RegistryFile => {
    const cached = files[path]
    if (cached) return cached
    const content = readFileSync(join(src, path), "utf8")
    const imports: Record<string, string> = {}
    const npm = new Set<string>()
    for (const m of content.matchAll(IMPORT)) {
      const spec = m[3] as string
      if (spec.startsWith(".")) {
        imports[spec] = resolveFile(
          posix.normalize(posix.join(dirname(path), spec)).replace(/\.js$/, ""),
        )
      } else if (!spec.startsWith("node:")) npm.add(packageName(spec))
    }
    bare.set(path, npm)
    const file = { hash: hash(content), content, imports }
    files[path] = file
    return file
  }

  const range = (name: string): [string, string] => {
    const r =
      pkg.peerDependencies?.[name] ?? pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]
    if (r) return [name, r]
    // A types-only import (`mdast`) is satisfied by its @types package.
    const types = pkg.devDependencies?.[`@types/${name}`]
    if (types) return [`@types/${name}`, types]
    throw new Error(`registry: signet-ui imports "${name}" but does not declare it`)
  }

  const items: Record<string, RegistryItem> = {}
  for (const [entry, name] of entries) {
    const own: string[] = []
    const deps = new Set<string>()
    const walk = (path: string) => {
      if (own.includes(path)) return
      own.push(path)
      for (const target of Object.values(load(path).imports)) {
        const dep = entries.get(target)
        if (dep && dep !== name) deps.add(dep)
        else walk(target)
      }
    }
    walk(entry)
    const peers = Object.fromEntries(
      [...new Set(own.flatMap((f) => [...(bare.get(f) ?? [])]))].sort().map(range),
    )
    items[name] = {
      files: own,
      deps: [...deps].sort(),
      peers,
      hash: hash(own.map((f) => `${f}:${files[f]?.hash}`).join("\n")),
    }
  }

  return { version: pkg.version, items, files }
}
