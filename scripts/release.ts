#!/usr/bin/env bun
/**
 * Publish every package, in dependency order.
 *
 * `bun publish` publishes the package in the current directory and has no
 * --workspaces equivalent, and the repo root is `private: true` (deliberately —
 * the monorepo itself is not a package), so running it at the root fails with
 * "attempted to publish a private package".
 *
 * Order matters: a package whose dependency is not yet on the registry will
 * install-fail for the first consumer who tries it.
 *
 *   bun run release              # publish
 *   bun run release --dry-run    # pack only, publish nothing
 *   bun run release --otp 123456 # skip the interactive 2FA prompt
 *
 * Publish output is NOT suppressed: bun asks for the one-time password on
 * stdout, and hiding it leaves the release hanging on a prompt you cannot see.
 */

import { $ } from "bun"

// config, tokens and lib depend on nothing local; ui needs tokens; ai needs lib.
// config is first: it is files only, and consumers install it before anything.
const ORDER = ["config", "tokens", "lib", "ui", "server", "ai"] as const

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const otpIndex = args.indexOf("--otp")
const otp = otpIndex >= 0 ? args[otpIndex + 1] : undefined

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

console.log(dryRun ? "DRY RUN — nothing will be published\n" : "Publishing to npm\n")

// Never publish an unverified build: all three publish bugs so far shipped
// clean typechecks and passing unit tests.
// npm answers an expired or missing login with a 404 on publish ("does not
// exist in this registry"), which reads like a missing package. Ask first.
// The login has expired within hours of `npm login` twice already.
// In GitHub Actions the credential is npm Trusted Publishing: an OIDC token
// GitHub mints per run, exchanged by `npm publish` itself. There is no login
// for whoami to find, and no 2FA prompt.
const inCI = process.env.GITHUB_ACTIONS === "true"

if (!dryRun && !inCI) {
  const who = await $`npm whoami`.nothrow().quiet()
  if (who.exitCode !== 0) {
    console.error(
      "Not logged in to npm (the login has expired). Run `npm login`, then release again.",
    )
    process.exit(1)
  }
  console.log(`Publishing as ${who.stdout.toString().trim()}\n`)
}

if (!dryRun) {
  console.log("Verifying the packaged output first...")
  await $`bun run verify:publish`.cwd(ROOT)
  console.log("")
}

const done: string[] = []
const skipped: string[] = []
const staged: string[] = []
for (const pkg of ORDER) {
  const dir = `${ROOT}/packages/${pkg}`
  const { name, version } = await Bun.file(`${dir}/package.json`).json()
  // Versions are independent, so most releases leave most packages unchanged.
  // Ask the registry first rather than building, packing and prompting for
  // 2FA only to be refused. A 404 here is not proof (npm lists a fresh upload
  // late), so the 403 handling below stays as the backstop.
  const listed = await fetch(`https://registry.npmjs.org/${name}/${version}`)
    .then((r) => r.ok)
    .catch(() => false)
  if (listed && !dryRun) {
    console.log(`   ${name}@${version} already on npm — skipping`)
    skipped.push(name)
    continue
  }
  console.log(`\n── ${name}@${version} ──`)
  try {
    const flags = [
      "--access",
      "public",
      ...(dryRun ? ["--dry-run"] : []),
      ...(otp ? ["--otp", otp] : []),
    ]
    // NOT .quiet(): bun prompts for the 2FA one-time password on stdout, and
    // suppressing it leaves the release hanging on an invisible prompt.
    // CI uses npm, not bun: Trusted Publishing's OIDC exchange lives in
    // `npm publish` (npm >= 11.5.1). No --provenance: npm only attests
    // builds from public repositories, and this one is private.
    if (inCI) await $`npm publish ${flags}`.cwd(dir)
    else await $`bun publish ${flags}`.cwd(dir)
    console.log(`   ${name} published`)
    done.push(name)
  } catch (err) {
    const stderrText = (err as { stderr?: Buffer }).stderr?.toString() ?? ""

    // 403: the version is genuinely live. Re-running after a partial release
    // should not look like a new failure.
    if (/cannot publish over the previously published versions/i.test(stderrText)) {
      console.log(`   ${name} already published at this version — skipping`)
      skipped.push(name)
      continue
    }

    // 409 "previously staged": npm holds a partial upload from an interrupted
    // run. It is NOT live yet, but the stage usually completes on its own
    // within a minute or two — so this is a retry, not a failure, and never a
    // silent skip. Treating it as published would report success for a version
    // nobody can install.
    if (/cannot publish over previously staged version/i.test(stderrText)) {
      console.error(`   ${name} has a STAGED upload from an earlier run.`)
      console.error(`   It is not live yet. Wait a minute and re-run — the stage usually`)
      console.error(`   resolves itself. Check with: npm view ${name} versions`)
      staged.push(name)
      continue
    }
    console.error(`   ${name} FAILED`)
    const stderr = (err as { stderr?: Buffer }).stderr?.toString()
    if (stderr) console.error(stderr)
    if (done.length) {
      console.error(`\nAlready published: ${done.join(", ")}`)
      console.error(
        "Those are live. Fix the failure and re-run; published versions will be skipped as duplicates.",
      )
    }
    process.exit(1)
  }
}

if (staged.length) {
  console.error(`\n${staged.length} package(s) left staged and NOT live: ${staged.join(", ")}`)
  console.error("Re-run in a minute, then verify with: npm view <name> versions")
  process.exit(1)
}
console.log(
  `\n${dryRun ? "Would upload" : "Uploaded"} ${done.length}: ${done.join(", ") || "nothing"}.`,
)
if (skipped.length) console.log(`Skipped ${skipped.length}, already on npm: ${skipped.join(", ")}.`)

// Uploaded is not installable: npm processes versions asynchronously. One
// parallel check, no polling — a slow npm should not hold the terminal for
// minutes or turn a successful upload into a failed release.
if (!dryRun && done.length) {
  console.log("\nChecking the registry...")
  const check = await $`bun run ${ROOT}/scripts/release-status.ts`.nothrow()
  if (check.exitCode !== 0) console.log("Not live yet is normal for a few minutes after upload.")
}
