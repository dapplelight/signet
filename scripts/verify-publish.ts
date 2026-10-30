#!/usr/bin/env bun

/**
 * Pack every publishable package, install the tarballs into a clean directory
 * OUTSIDE the monorepo, and import them with Node.
 *
 * This exists because three separate publish-breaking bugs got through
 * typechecking, 284 unit assertions and a manual review, and were only caught
 * by actually installing the thing:
 *
 *   1. npm ignores `publishConfig.exports` (a pnpm/bun extension), so the
 *      tarball shipped dist/ while exports pointed at src/.
 *   2. `workspace:^` is expanded by bun and pnpm but published literally by
 *      npm, giving consumers an uninstallable dependency.
 *   3. TypeScript does not add extensions, so emitted `from "./types"` is
 *      unresolvable under Node ESM. It typechecked because moduleResolution is
 *      "bundler", and bun resolved it fine.
 *
 * Run before every release.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { $ } from "bun"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const TMP = "/tmp/signet-verify-publish"
const PKGS = ["config", "lib", "tokens", "server", "ai", "ui"]

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
writeFileSync(
  `${TMP}/package.json`,
  JSON.stringify({ name: "verify", version: "1.0.0", type: "module" }),
)

await $`bun run build:all`.cwd(ROOT).quiet()

// The metadata check that 0.1.0 needed and did not have. `workspace:` reaching
// the registry makes a package uninstallable with npm, and it is invisible in
// the tarball listing — only the published package.json shows it.
for (const p of PKGS) {
  const pkg = await Bun.file(`${ROOT}/packages/${p}/package.json`).json()
  for (const section of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [dep, range] of Object.entries(pkg[section] ?? {})) {
      if (String(range).startsWith("workspace:")) {
        console.error(
          `\n  ${pkg.name}: ${section}.${dep} is "${range}".\n` +
            `  npm publishes workspace: literally, which makes the package uninstallable.\n` +
            `  Pin it to a real range before publishing.`,
        )
        process.exit(1)
      }
    }
  }
}

for (const p of PKGS) await $`npm pack ${ROOT}/packages/${p}`.cwd(TMP).quiet()
await $`sh -c 'npm install ./*.tgz'`.cwd(TMP).quiet()

// One copy of each Signet package. ai once listed lib as a dependency, and bun
// kept a nested old lib for it — two ApiError classes, so instanceof failed
// across them. Cross-package imports must be peer dependencies.
const nested = (
  await $`find node_modules/@dapplelight -path "*/node_modules/@dapplelight/*" -maxdepth 6 -name package.json`
    .cwd(TMP)
    .nothrow()
    .text()
).trim()
if (nested) {
  console.error(
    `\n  nested Signet packages (a duplicate copy):\n    ${nested.split("\n").join("\n    ")}`,
  )
  process.exit(1)
}

// The probe below imports a handful of entry points; this covers the rest.
// 0.1.5 shipped oauth-rs/* mapped to ./src/*.ts while `files` only ships dist/,
// so every oauth-rs import failed for consumers. The probe never touched it.
const missing: string[] = []
for (const p of PKGS) {
  const dir = `${TMP}/node_modules/@dapplelight/signet-${p}`
  const { exports = {}, bin = {} } = await Bun.file(`${dir}/package.json`).json()
  for (const [cmd, f] of Object.entries(bin as Record<string, string>)) {
    if (!(await Bun.file(`${dir}/${f}`).exists()))
      missing.push(`@dapplelight/signet-${p} bin ${cmd} -> ${f}`)
  }
  for (const [sub, target] of Object.entries(exports)) {
    const files =
      typeof target === "string" ? [target] : Object.values(target as Record<string, string>)
    for (const f of files) {
      // A wildcard target (config's ./tsconfig/*.json) must match something.
      const found = f.includes("*")
        ? (await Array.fromAsync(new Bun.Glob(f.replace(/^\.\//, "")).scan(dir))).length > 0
        : await Bun.file(`${dir}/${f}`).exists()
      if (!found) missing.push(`@dapplelight/signet-${p} ${sub} -> ${f}`)
    }
  }
}
if (missing.length) {
  console.error(
    `\n  exports point at files missing from the tarball:\n    ${missing.join("\n    ")}`,
  )
  process.exit(1)
}

// Node, not bun — bun is tolerant of extensionless imports and would hide #3.
const probe = `
import { createExtractor, fakeProvider } from "@dapplelight/signet-ai"
import { ApiError, createApiClient } from "@dapplelight/signet-lib/api"
import { createCompactCurrencyFormatter } from "@dapplelight/signet-lib/format"
import { issueSession, verifySession } from "@dapplelight/signet-server/auth/session"
import { createTokenVerifier } from "@dapplelight/signet-server/oauth-rs"
import { requireToken } from "@dapplelight/signet-server/oauth-rs/hono"
import { z } from "zod"

const ai = createExtractor({ providers: [fakeProvider({ ok: true })] })
const r = await ai.extract({ schema: z.object({ ok: z.boolean() }), input: "x", instructions: "y" })
if (r.value.ok !== true) throw new Error("extract failed")
if (createCompactCurrencyFormatter("INR","en-IN")(1200000) !== "₹12L") throw new Error("format failed")
const o = { cookieName: "c", secret: "s".repeat(32) }
if ((await verifySession(await issueSession(o, "u1"), o))?.sub !== "u1") throw new Error("session failed")
if (typeof ApiError !== "function" || typeof createApiClient !== "function") throw new Error("api failed")
if (typeof createTokenVerifier !== "function" || typeof requireToken !== "function") throw new Error("oauth-rs failed")
console.log("  all published entry points import and work under Node")
`
writeFileSync(`${TMP}/probe.mjs`, probe)
await $`npm install zod`.cwd(TMP).quiet()
await $`node probe.mjs`.cwd(TMP)

rmSync(TMP, { recursive: true, force: true })
console.log("\nPUBLISH VERIFICATION PASSED")
