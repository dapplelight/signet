/**
 * Scaffolds the api template OUTSIDE the monorepo, installs from npm,
 * typechecks, lints, bundles with wrangler, and runs it under `wrangler dev` on
 * local workerd with the Durable Object from wrangler.jsonc.
 *
 * Running it is the point: workerd enforces what no typecheck sees — the
 * RateLimitCounter export, the binding, the migration, and that the entry
 * exports only handlers and classes.
 */

import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const DIR = join("/tmp", "__scaffold_api_test__")
const CI = ".github/workflows/ci.yml"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

rmSync(DIR, { recursive: true, force: true })
// Kills the whole tree — the shim, node and every workerd — by its path, since
// they all run out of DIR. Safe to call twice.
const stopWrangler = async () => {
  await $`pkill -9 -f ${DIR}/node_modules`.nothrow().quiet()
  await Bun.sleep(300)
}
try {
  await $`bun run ${ROOT}/packages/create-signet-app/src/index.ts ${DIR} --template api`
    .cwd("/tmp")
    .quiet()
  const pkg = JSON.parse(readFileSync(join(DIR, "package.json"), "utf8"))
  ok(
    "api deps, not the web ones",
    !!pkg.dependencies["@dapplelight/signet-server"] && !pkg.dependencies.react,
  )
  const wrangler = readFileSync(join(DIR, "wrangler.jsonc"), "utf8")
  ok("app name substituted", wrangler.includes('"name": "__scaffold_api_test__"'))
  ok(
    "DO binding + migration present",
    wrangler.includes('"class_name": "RateLimitCounter"') &&
      wrangler.includes('"new_sqlite_classes": ["RateLimitCounter"]'),
  )

  ok("renames _github to a real .github/workflows/ci.yml", existsSync(join(DIR, CI)))
  ok("no _github left", !existsSync(join(DIR, "_github")))
  const ci = readFileSync(join(DIR, CI), "utf8")
  const ciScripts = [...ci.matchAll(/bun run ([\w:-]+)/g)].map((m) => m[1])
  ok(
    "CI runs lint, typecheck, test and a wrangler dry run, and each script exists",
    ["lint", "typecheck", "test", "deploy"].every((s) => ciScripts.includes(s)) &&
      ciScripts.every((s) => s in pkg.scripts) &&
      ci.includes("--dry-run"),
    ciScripts.join(","),
  )

  const envTs = readFileSync(join(DIR, "src/env.ts"), "utf8")
  const indexTs = readFileSync(join(DIR, "src/index.ts"), "utf8")
  ok(
    "env schema via createEnv includes APP_ENV",
    envTs.includes("createEnv(envSchema)") && envTs.includes("APP_ENV:"),
  )
  ok(
    "entry reads APP_ENV through the schema, not getRuntimeEnv",
    indexTs.includes("env.APP_ENV") && !indexTs.includes("getRuntimeEnv"),
  )

  await $`bun install`.cwd(DIR).quiet()
  ok("typechecks", (await $`bun run typecheck`.cwd(DIR).nothrow().quiet()).exitCode === 0)
  ok("lints clean", (await $`bun run lint`.cwd(DIR).nothrow().quiet()).exitCode === 0)
  const test = await $`bun run test`.cwd(DIR).nothrow().quiet()
  ok(
    "app tests pass (env schema)",
    test.exitCode === 0,
    (test.stdout.toString() + test.stderr.toString()).slice(-800),
  )
  const bundle = await $`bunx wrangler deploy --dry-run --outdir .out`.cwd(DIR).nothrow().quiet()
  ok("wrangler bundles it", bundle.exitCode === 0, bundle.stderr.toString().slice(0, 400))

  // wrangler's output goes to a file, not a pipe: the .bin/wrangler shim spawns
  // node, which spawns workerd, and killing the shim leaves those holding any
  // pipe open — the test then never exits (it once hung for over an hour after
  // every check had passed). The log is read after the fact.
  const LOG = join(DIR, "wrangler-dev.log")
  const failureOutput = async () => {
    await stopWrangler()
    return (
      await Bun.file(LOG)
        .text()
        .catch(() => "")
    )
      .trim()
      .slice(-800)
  }
  // `wrangler dev` — what a user runs — on local workerd with the Durable Object.
  const PORT = 8790 + Math.floor(Math.random() * 100)
  const base = `http://127.0.0.1:${PORT}`
  // Skip the server when the bundle already failed: wrangler dev would sit
  // there with a broken Worker and the test would wait on it.
  if (bundle.exitCode !== 0) throw new Error("bundle failed; not starting wrangler dev")
  // Not kept as a handle: stopWrangler() kills the whole tree by path, which a
  // handle to the .bin shim could not.
  Bun.spawn(
    [join(DIR, "node_modules/.bin/wrangler"), "dev", "--port", String(PORT), "--ip", "127.0.0.1"],
    {
      cwd: DIR,
      stdout: Bun.file(LOG),
      stderr: Bun.file(LOG),
    },
  )
  try {
    let up = false
    // First start downloads workerd, so allow 90s before giving up.
    for (let i = 0; i < 180 && !up; i++) {
      up = await fetch(`${base}/api/health`)
        .then((r) => r.ok)
        .catch(() => false)
      if (!up) await Bun.sleep(500)
    }
    ok("starts under wrangler dev", up, up ? "" : await failureOutput())
    if (up) {
      // One /api/* hit so far (the readiness probe that succeeded).
      const h = await fetch(`${base}/api/health`)
      ok("health 200 with a request id", h.status === 200 && !!h.headers.get("x-request-id"))
      const bad = await fetch(`${base}/api/echo`, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      })
      const body = (await bad.json()) as { code?: string; requestId?: string }
      ok(
        "validation error is the envelope",
        bad.status === 400 && body.code === "VALIDATION_FAILED" && !!body.requestId,
        JSON.stringify(body),
      )
      // 3 hits used; 60 more against max 60 -> 57 allowed, then limited.
      const statuses: number[] = []
      let last: Response | undefined
      for (let i = 0; i < 60; i++) {
        last = await fetch(`${base}/api/health`)
        statuses.push(last.status)
        if (i < 59) await last.text()
      }
      const allowed = statuses.filter((s) => s === 200).length
      ok(
        "exactly 60 allowed per window",
        allowed === 57,
        `${allowed} of the last 60 (3 used earlier)`,
      )
      const limited = (await last?.json()) as { code?: string }
      ok(
        "then 429 RATE_LIMITED with Retry-After",
        last?.status === 429 &&
          limited.code === "RATE_LIMITED" &&
          !!last?.headers.get("retry-after"),
      )
    }
  } finally {
    await stopWrangler()
  }
} catch (err) {
  ok("scaffold-api run completed", false, String(err))
} finally {
  await stopWrangler()
  rmSync(DIR, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
