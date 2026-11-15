#!/usr/bin/env bun
/**
 * Is the current version of every package actually installable?
 *
 * "Published" from bun, and even dist-tags on the registry, have both been true
 * while the tarball itself 404'd. npm now processes uploads asynchronously
 * ("Your package is being processed"), so a version can be accepted, listed in
 * metadata, and still not downloadable for minutes. Only fetching the tarball
 * proves installability.
 *
 * One pass, all packages in parallel, no waiting. Re-run it instead of polling.
 *
 *   bun run release:status    # exit 0 only if every tarball is fetchable
 */

const PKGS = ["config", "tokens", "lib", "ui", "server", "ai"] as const
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const REGISTRY = "https://registry.npmjs.org"

const status = (url: string, init?: RequestInit) =>
  fetch(url, { ...init, headers: { "cache-control": "no-cache" } })
    .then((r) => r.status)
    .catch(() => 0)

const rows = await Promise.all(
  PKGS.map(async (p) => {
    const { name, version } = await Bun.file(`${ROOT}/packages/${p}/package.json`).json()
    const short = name.replace("@dapplelight/", "")
    const [meta, tarball, latest] = await Promise.all([
      status(`${REGISTRY}/${name}/${version}`),
      status(`${REGISTRY}/${name}/-/${short}-${version}.tgz`, { method: "HEAD" }),
      fetch(`${REGISTRY}/-/package/${name}/dist-tags`)
        .then((r) => (r.ok ? r.json() : {}))
        .then((t: { latest?: string }) => t.latest ?? "?")
        .catch(() => "?"),
    ])
    return { name, version, meta, tarball, latest, ok: tarball === 200 }
  }),
)

for (const r of rows) {
  const state = r.ok
    ? "installable"
    : r.meta === 200
      ? "processing (listed, tarball 404)"
      : "not on npm (never uploaded, or still processing)"
  const tag = r.latest === r.version ? "" : `  latest=${r.latest}`
  console.log(`   ${r.name}@${r.version}  ${state}${tag}`)
}

const pending = rows.filter((r) => !r.ok)
if (pending.length) {
  // An unlisted version looks the same whether npm is processing it or it was
  // never uploaded (a local bump with no release). Say both, not just one.
  console.log(
    `\n${rows.length - pending.length}/${rows.length} installable. The rest are processing, or were never released.`,
  )
  console.log("Re-check with: bun run release:status")
  process.exit(1)
}
console.log(`\nAll ${rows.length} installable.`)
