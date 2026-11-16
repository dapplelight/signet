#!/usr/bin/env bun
/**
 * Fails when a package's export paths differ from what npm has for the same
 * version. A new subpath without a version bump never reaches npm, and apps
 * scaffolded from create-signet-app then import paths that do not exist.
 *
 *   bun run scripts/check-bumps.ts
 *
 * ponytail: compares export paths only; a new symbol inside an existing path
 * still slips through. Diff packed file hashes if that bites.
 */

const PKGS = ["config", "tokens", "lib", "db", "payments", "ui", "server", "ai"] as const
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

const keys = (e: unknown) => (e && typeof e === "object" ? Object.keys(e).sort() : [])

const stale: string[] = []
for (const p of PKGS) {
  const { name, version, exports } = await Bun.file(`${ROOT}/packages/${p}/package.json`).json()
  const res = await fetch(`https://registry.npmjs.org/${name}/${version}`)
  if (res.status === 404) continue // unreleased version: the bump already happened
  if (!res.ok) throw new Error(`${name}@${version}: registry returned ${res.status}`)
  const published = keys(((await res.json()) as { exports?: unknown }).exports)
  const local = keys(exports)
  const added = local.filter((k) => !published.includes(k))
  const removed = published.filter((k) => !local.includes(k))
  if (added.length || removed.length) {
    stale.push(
      `${name}@${version} is on npm with different exports` +
        (added.length ? `\n    added:   ${added.join(" ")}` : "") +
        (removed.length ? `\n    removed: ${removed.join(" ")}` : ""),
    )
  }
}

if (stale.length) {
  console.error(`${stale.join("\n")}\n\nBump these versions so the release publishes them.`)
  process.exit(1)
}
console.log(`Export paths match npm for every unbumped package.`)
