#!/usr/bin/env bun
// Checks scripts/bump.ts on a scratch repo: which packages a fragment names,
// one bump per package at the highest level asked, hand bumps and private
// packages left alone, unknown names refused.
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname
let fail = 0
const ok = (name: string, c: boolean) => {
  if (!c) fail++
  console.log(c ? "  PASS" : "  FAIL", name)
}

const tmp = mkdtempSync(join(tmpdir(), "signet-bump-"))
const pkg = (dir: string, name: string, version: string, priv = false) => {
  mkdirSync(join(tmp, "packages", dir), { recursive: true })
  writeFileSync(
    join(tmp, "packages", dir, "package.json"),
    `{\n  "name": "${name}",\n  "version": "${version}",\n${priv ? '  "private": true,\n' : ""}  "type": "module"\n}\n`,
  )
}
const version = (dir: string) =>
  JSON.parse(readFileSync(join(tmp, "packages", dir, "package.json"), "utf8")).version
const frag = (f: string, text: string) => writeFileSync(join(tmp, ".changes", f), text)
const run = (...args: string[]) =>
  spawnSync("bun", [join(ROOT, "scripts/bump.ts"), ...args], {
    env: {
      ...process.env,
      CHANGES_ROOT: tmp,
      BUMP_PUBLISHED: JSON.stringify({
        "@dapplelight/signet-db": ["0.2.0"],
        "@dapplelight/signet-ui": ["0.4.0"],
        "@dapplelight/signet-server": ["0.6.1"],
        "create-signet-app": ["0.5.0"],
        // signet-lib 0.4.3 is not listed: bumped by hand, waiting for release.
      }),
    },
    encoding: "utf8",
  })

try {
  pkg("db", "@dapplelight/signet-db", "0.2.0")
  pkg("ui", "@dapplelight/signet-ui", "0.4.0")
  pkg("server", "@dapplelight/signet-server", "0.6.1")
  pkg("lib", "@dapplelight/signet-lib", "0.4.3")
  pkg("create-signet-app", "create-signet-app", "0.5.0")
  pkg("test", "@dapplelight/signet-test", "0.0.1", true)
  pkg("config", "@dapplelight/signet-config", "0.3.0")
  mkdirSync(join(tmp, ".changes"))
  frag("README.md", "# not an entry\n")

  // bump.ts reads git history: a hand bump is a human's commit, not post-merge's.
  const git = (...args: string[]) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
      cwd: tmp,
      encoding: "utf8",
    })
  git("init", "-q")
  git("add", "-A")
  git("commit", "-q", "-m", "release: hand-set versions")
  // post-merge bumped config 0.3.0 -> 0.3.1; its release is still running, so 0.3.1 is not on npm.
  pkg("config", "@dapplelight/signet-config", "0.3.1")
  git("add", "-A")
  git("commit", "-q", "-m", "chore: release, fold changelog fragments, regenerate API.md [skip ci]")

  ok("no fragments bumps nothing", run().status === 0 && version("db") === "0.2.0")

  frag("a.md", "### signet-db: ledger\n\n- x\n")
  frag("b.md", "### db and signet-server: shared fix\n\n- y\n")
  frag("c.md", "### ui (minor), create-signet-app: new screen\n\n- z\n")
  frag("d.md", "### signet-ui: small fix\n\n- w\n")
  frag("e.md", "### signet-lib, signet-test, signet-config: tweak\n\n- v\n")

  ok("--check passes known names", run("--check").status === 0)
  ok("--check writes nothing", version("db") === "0.2.0")
  const r = run()
  ok("bump exits 0", r.status === 0)
  ok("two fragments for db bump it once", version("db") === "0.2.1")
  ok("'and' names both packages", version("server") === "0.6.2")
  ok("highest level wins: ui minor beats a later patch", version("ui") === "0.5.0")
  ok("unscoped create-signet-app bumps", version("create-signet-app") === "0.5.1")
  ok("a version not on npm yet is left as is", version("lib") === "0.4.3")
  ok(
    "a version post-merge just set, release still running, is bumped again",
    version("config") === "0.3.2",
  )
  ok("private packages are never bumped", version("test") === "0.0.1")
  ok(
    "only the version line changes",
    readFileSync(join(tmp, "packages/db/package.json"), "utf8") ===
      '{\n  "name": "@dapplelight/signet-db",\n  "version": "0.2.1",\n  "type": "module"\n}\n',
  )

  frag("f.md", "### Release notes: nothing\n\n- u\n")
  const bad = run("--check")
  ok("unknown package names fail --check", bad.status === 1 && bad.stderr.includes("Release notes"))
  rmSync(join(tmp, ".changes/f.md"))
  frag("g.md", "### all packages: shared bump\n\n- t\n")
  ok("all packages is a known name", run("--check").status === 0)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// release.yml must stay startable from post-merge, which bumps then dispatches.
const wf = readFileSync(join(ROOT, ".github/workflows/post-merge.yml"), "utf8")
ok(
  "post-merge runs bump before folding",
  wf.indexOf("scripts/bump.ts") < wf.indexOf("bun run changes"),
)
ok("post-merge starts release.yml", wf.includes("gh workflow run release.yml"))
ok(
  "release.yml can be dispatched",
  readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8").includes("workflow_dispatch"),
)

console.log(fail ? `\n${fail} failed` : "\nall passed")
process.exit(fail ? 1 : 0)
