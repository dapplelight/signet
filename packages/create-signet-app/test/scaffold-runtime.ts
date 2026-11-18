/**
 * The composed app on each API runtime: for every --target (bun, deno, node)
 * whose runtime is on this machine, the full starter with MCP is scaffolded,
 * installed (Signet's packages from local packs), its tests run (bun test,
 * on the target's own database driver) and the web app built; then `start`
 * serves it: /api/health answers, an MCP tools/list call lists the routes,
 * and the built page is served. A runtime not installed is skipped with a note.
 *
 *   bun run test/scaffold-runtime.ts [bun|deno|node]
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const CLI = `${ROOT}/packages/create-signet-app/src/index.ts`
const PACKAGES = ["lib", "tokens", "ui", "server", "db", "payments"]
const TMP = join("/tmp", "__scaffold_runtime__")
const RUNTIMES = ["bun", "deno", "node"] as const

const only = process.argv[2]
let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const out = (r: { stdout: Buffer; stderr: Buffer }) =>
  (r.stdout.toString() + r.stderr.toString()).slice(-2000)

rmSync(TMP, { recursive: true, force: true })
const PACKS = join(TMP, "packs")
mkdirSync(PACKS, { recursive: true })
await Promise.all(PACKAGES.map((p) => $`npm pack ${ROOT}/packages/${p}`.cwd(PACKS).quiet()))
const packs: Record<string, string> = Object.fromEntries(
  readdirSync(PACKS).map((f) => [
    `@dapplelight/${f.replace(/^dapplelight-/, "").replace(/-\d+\.\d+\.\d+\.tgz$/, "")}`,
    `file:${join(PACKS, f)}`,
  ]),
)

async function waitUp(url: string): Promise<boolean> {
  for (let i = 0; i < 80; i++) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return true
    await Bun.sleep(250)
  }
  return false
}

// Both halves (the server also serves the built page), and the API alone.
const CASES = (runtime: string) =>
  [
    [runtime, ["--starter", "full"]],
    [`${runtime} --api`, ["--api", "--starter", "full"]],
  ] as const

for (const [label, args] of RUNTIMES.flatMap(CASES)) {
  const runtime = label.split(" ")[0] as string
  const web = !label.endsWith("--api")
  if (only && only !== runtime) continue
  if ((await $`${runtime} --version`.nothrow().quiet()).exitCode !== 0) {
    console.log(`\n${label}: ${runtime} not installed here, skipped`)
    continue
  }
  console.log(`\n${label}`)
  const dir = join(TMP, label.replace(/\W+/g, "_"))
  try {
    const made = await $`bun run ${CLI} ${dir} ${args} --mcp --target ${runtime}`
      .cwd(TMP)
      .nothrow()
      .quiet()
    ok(`${label}: scaffolds`, made.exitCode === 0, out(made))
    if (made.exitCode !== 0) continue
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    ok(
      `${runtime}: start runs on ${runtime}`,
      pkg.scripts.start.startsWith(runtime) && pkg.scripts.dev.startsWith(runtime),
      pkg.scripts.start,
    )
    const server = readFileSync(join(dir, "api/server.ts"), "utf8")
    ok(
      `${runtime}: ${runtime === "bun" ? "Bun.serve and bun:sqlite" : "node:http and node:sqlite, no Bun"}`,
      runtime === "bun"
        ? server.includes("Bun.serve")
        : !/Bun\.|bun:sqlite/.test(server + readFileSync(join(dir, "api/db/open.ts"), "utf8")),
    )
    for (const name of Object.keys(pkg.dependencies))
      if (packs[name]) pkg.dependencies[name] = packs[name]
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`)
    const install = await $`bun install`.cwd(dir).nothrow().quiet()
    ok(`${label}: installs`, install.exitCode === 0, out(install))
    if (install.exitCode !== 0) continue
    for (const script of web ? ["typecheck", "test", "build"] : ["typecheck", "test"]) {
      const r = await $`bun run ${script}`.cwd(dir).nothrow().quiet()
      ok(`${label}: ${script}`, r.exitCode === 0, out(r))
    }

    const port = 8700 + Math.floor(Math.random() * 200)
    const proc = Bun.spawn(["sh", "-c", pkg.scripts.start], {
      cwd: dir,
      env: { ...process.env, PORT: String(port) },
      stdout: "pipe",
      stderr: "pipe",
    })
    try {
      const base = `http://127.0.0.1:${port}`
      const up = await waitUp(`${base}/api/health`)
      ok(`${label}: serves /api/health`, up)
      if (!up) {
        proc.kill()
        console.log((await new Response(proc.stderr).text()).slice(-1500))
        continue
      }
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      })
      const text = await res.text()
      const json = text.startsWith("{")
        ? text
        : (
            text
              .split("\n")
              .filter((l) => l.startsWith("data: "))
              .pop() ?? ""
          ).slice(6)
      const tools = json ? (JSON.parse(json).result?.tools ?? []) : []
      ok(`${label}: MCP tools/list over HTTP`, tools.length > 0, text.slice(0, 300))
      const page = await fetch(`${base}/`)
      const html = await page.text()
      if (web) ok(`${label}: serves the built page`, page.ok && html.includes('<div id="root"'))
      else ok(`${label}: no page, only the API`, page.status === 404)
    } finally {
      proc.kill()
      await proc.exited
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
