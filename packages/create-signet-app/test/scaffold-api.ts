/**
 * Scaffolds the api template OUTSIDE the monorepo, once per --target.
 *
 * cloudflare (the default): installs from npm (signet-server from a local pack),
 * typechecks, lints, bundles with wrangler, and runs it under `wrangler dev` on
 * local workerd with the Durable Object from wrangler.jsonc.
 *
 * Running it is the point: workerd enforces what no typecheck sees — the
 * RateLimitCounter export, the binding, the migration, and that the entry
 * exports only handlers and classes.
 *
 * Web push on Workers is checked the same way: the copy (never the shipped
 * template) gets one extra route, PUSH_CHECK below, that calls
 * webCryptoPushSender and encryptAes128gcm inside workerd. This file then
 * checks the encrypted body against the RFC 8291 Appendix A test vector and the
 * VAPID JWT signature with its own Web Crypto. CI is the judge: builders have no
 * workerd. Delivery to a real push service (FCM, Mozilla autopush, Apple) is
 * NOT tested here: it stays a one-time manual check by the owner, and the goal
 * can close without it.
 *
 * bun and node: installs, typechecks, lints, then serves src/server.ts under
 * that runtime and checks the limit is keyed by the socket, not a client
 * header. vercel: installs, typechecks, lints, and calls the default export's
 * fetch in process (a real deploy needs a Vercel account).
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const DIR = join("/tmp", "__scaffold_api_test__")
const CI = ".github/workflows/ci.yml"

// RFC 8291 Appendix A: the subscriber's keys and the one body they must give.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
}

/**
 * The extra route, written into the scaffolded copy as src/push-check.ts. It runs
 * in workerd and returns what it computed; it checks nothing itself.
 */
const PUSH_CHECK = `import {
  b64urlDecode,
  b64urlEncode,
  encryptAes128gcm,
  webCryptoPushSender,
} from "@dapplelight/signet-server/notify/push"

const RFC = ${JSON.stringify(RFC)}
const ENDPOINT = "https://push.example.net/send/abc"

export async function pushCheck() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
  const publicKey = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)))
  const keys = { p256dh: RFC.uaPublic, auth: RFC.auth }

  // The real sender, with a fetch that records the request instead of sending it.
  let sent: { url: string; headers: Record<string, string>; body: Uint8Array } | undefined
  const send = webCryptoPushSender({
    vapid: { subject: "mailto:ops@example.com", publicKey, privateKey: jwk.d as string },
    fetch: (async (url: string, init: RequestInit) => {
      sent = { url, headers: init.headers as Record<string, string>, body: init.body as Uint8Array }
      return new Response(null, { status: 201 })
    }) as unknown as typeof fetch,
  })
  await send({ id: "1", endpoint: ENDPOINT, keys }, "hello")

  // The encryption with the RFC's fixed salt and server key.
  const vector = await encryptAes128gcm(new TextEncoder().encode(RFC.plaintext), keys, {
    salt: b64urlDecode(RFC.salt),
    serverKey: { publicKey: RFC.asPublic, privateKey: RFC.asPrivate },
  })
  return Response.json({
    vector: b64urlEncode(vector),
    vapidPublicKey: publicKey,
    endpoint: sent?.url,
    headers: sent?.headers,
    body: sent ? b64urlEncode(sent.body) : null,
  })
}
`

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

/**
 * Install, then swap in the LOCAL signet-server as a tarball (as scaffold.ts
 * does for the web template): the template may use what is not on npm yet.
 */
async function installLocal(dir: string) {
  // Point the dependency at the tarball before the first install: a bumped
  // version is not on npm until the release runs.
  const tgz = (await $`npm pack ${ROOT}/packages/server`.cwd(dir).quiet()).text().trim()
  const pkgPath = join(dir, "package.json")
  const pkg = readFileSync(pkgPath, "utf8")
  writeFileSync(
    pkgPath,
    pkg.replace(/("@dapplelight\/signet-server": )"[^"]+"/, `$1"file:./${tgz}"`),
  )
  await $`bun install`.cwd(dir).quiet()
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

  ok(
    "cloudflare scaffolds only its own entry: no Bun, Node or Vercel files, no _targets",
    existsSync(join(DIR, "src/index.ts")) &&
      !existsSync(join(DIR, "src/server.ts")) &&
      !existsSync(join(DIR, "Dockerfile")) &&
      !existsSync(join(DIR, "vercel.json")) &&
      !existsSync(join(DIR, "index.ts")) &&
      !existsSync(join(DIR, "_targets")),
  )

  const envTs = readFileSync(join(DIR, "src/env.ts"), "utf8")
  const indexTs = readFileSync(join(DIR, "src/app.ts"), "utf8")
  ok(
    "env schema via createEnv includes APP_ENV",
    envTs.includes("createEnv(envSchema)") && envTs.includes("APP_ENV:"),
  )
  ok(
    "entry reads APP_ENV through the schema, not getRuntimeEnv",
    indexTs.includes("env.APP_ENV") && !indexTs.includes("getRuntimeEnv"),
  )

  ok(
    "MCP by default (no flag, no terminal): the dependency, the mount, the off switch, its tests",
    !!pkg.dependencies["@modelcontextprotocol/server"] &&
      indexTs.includes('mountMcp(app, "/mcp"') &&
      envTs.includes("MCP:") &&
      existsSync(join(DIR, "test/mcp.test.ts")) &&
      !indexTs.includes("mcp:begin") &&
      !existsSync(join(DIR, "_mcp")),
  )

  await installLocal(DIR)
  ok("typechecks", (await $`bun run typecheck`.cwd(DIR).nothrow().quiet()).exitCode === 0)
  ok("lints clean", (await $`bun run lint`.cwd(DIR).nothrow().quiet()).exitCode === 0)
  const test = await $`bun run test`.cwd(DIR).nothrow().quiet()
  ok(
    "app tests pass (env schema)",
    test.exitCode === 0,
    (test.stdout.toString() + test.stderr.toString()).slice(-800),
  )
  // The push route goes in only now: typecheck, lint and the app tests above ran
  // on the template as shipped.
  writeFileSync(join(DIR, "src/push-check.ts"), PUSH_CHECK)
  const appPath = join(DIR, "src/app.ts")
  const appSrc = readFileSync(appPath, "utf8")
  const patched = appSrc
    .replace(
      'import { env } from "./env.ts"',
      'import { env } from "./env.ts"\nimport { pushCheck } from "./push-check.ts"',
    )
    .replace(
      "    .onError(errorHandler({ isProduction }))",
      '    .get("/__push-check", pushCheck)\n    .onError(errorHandler({ isProduction }))',
    )
  ok(
    "push route patched into the copy",
    patched.includes("pushCheck)") && patched.includes("./push-check.ts"),
  )
  writeFileSync(appPath, patched)
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
      await checkPush(base)
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

/** Web push inside workerd: RFC 8291 vector, then the VAPID JWT the sender signed. */
async function checkPush(base: string) {
  const r = await fetch(`${base}/__push-check`)
  const out = (await r.json()) as {
    vector: string
    vapidPublicKey: string
    endpoint: string
    headers: Record<string, string>
    body: string
  }
  ok("push: route ran the sender in workerd", r.status === 200 && !!out.body, JSON.stringify(out))
  ok("push: RFC 8291 Appendix A body matches byte for byte", out.vector === RFC.body, out.vector)

  const b64 = (s: string) => Buffer.from(s, "base64url")
  const h = out.headers
  ok(
    "push: sender headers",
    out.endpoint === "https://push.example.net/send/abc" &&
      h["Content-Encoding"] === "aes128gcm" &&
      h["Content-Type"] === "application/octet-stream" &&
      h.TTL === "86400",
    JSON.stringify(h),
  )
  // salt 16 + record size 4 + key length 1 + key 65, then plaintext "hello" + 0x02 + 16 tag.
  const body = b64(out.body)
  ok(
    "push: sender body is one aes128gcm record",
    body.length === 86 + 5 + 1 + 16 && body.readUInt32BE(16) === 4096 && body[20] === 65,
    String(body.length),
  )

  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h.Authorization ?? "")
  ok("push: Authorization is vapid t=<jwt>, k=<key>", !!m && m[4] === out.vapidPublicKey)
  if (!m) return
  const [, head = "", claims = "", sig = "", k = ""] = m
  const pub = b64(k)
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33).toString("base64url"),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  )
  const signed = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    b64(sig),
    new TextEncoder().encode(`${head}.${claims}`),
  )
  ok("push: VAPID JWT signature verifies (ES256, raw r||s)", signed)
  const c = JSON.parse(b64(claims).toString()) as { aud?: string; sub?: string; exp?: number }
  const now = Date.now() / 1000
  ok(
    "push: VAPID claims (aud is the push origin, sub, exp within 24h)",
    JSON.parse(b64(head).toString()).alg === "ES256" &&
      c.aud === "https://push.example.net" &&
      c.sub === "mailto:ops@example.com" &&
      (c.exp ?? 0) > now &&
      (c.exp ?? 0) <= now + 86400,
    JSON.stringify(c),
  )
}

// --- the other targets ---

/** Poll until `url` answers 200, up to ~10s. */
async function waitUp(url: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
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

/** Serve `cmd` in `dir` and check 60 hits from "different" forwarded IPs share one bucket. */
async function servesAndLimits(name: string, cmd: string[], dir: string) {
  const port = 8890 + Math.floor(Math.random() * 100)
  const proc = Bun.spawn(cmd, {
    cwd: dir,
    env: { ...process.env, PORT: String(port) },
    stdout: "ignore",
    stderr: "ignore",
  })
  try {
    const up = await waitUp(`http://127.0.0.1:${port}/api/health`)
    const echo = up
      ? await fetch(`http://127.0.0.1:${port}/api/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "hi" }),
        }).then((r) => r.json() as Promise<{ message?: string }>)
      : {}
    ok(`${name}: POST body reaches the app`, echo.message === "hi", JSON.stringify(echo))
    // Two hits used (probe + echo). A client-set x-forwarded-for must not pick its own bucket.
    const statuses: number[] = []
    for (let i = 0; up && i < 59; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { "x-forwarded-for": `203.0.113.${i}` },
      })
      statuses.push(res.status)
    }
    ok(
      `${name}: limits at 60 per socket address`,
      up && statuses.filter((s) => s === 200).length === 58 && statuses.at(-1) === 429,
      statuses.join(","),
    )
  } finally {
    proc.kill()
  }
}

const OWN_FILES: Record<string, string[]> = {
  bun: ["src/server.ts", "Dockerfile", ".dockerignore"],
  deno: ["src/server.ts", "Dockerfile", ".dockerignore"],
  node: ["src/server.ts"],
  vercel: ["index.ts", "vercel.json"],
}
const OTHER_FILES = ["src/index.ts", "wrangler.jsonc", "Dockerfile", "vercel.json", "index.ts"]

for (const target of ["bun", "deno", "node", "vercel"]) {
  const dir = join("/tmp", `__scaffold_api_${target}__`)
  rmSync(dir, { recursive: true, force: true })
  try {
    // bun is the --no-mcp app: it must still typecheck, lint, test and serve.
    const mcp = target === "bun" ? "--no-mcp" : "--mcp"
    await $`bun run ${ROOT}/packages/create-signet-app/src/index.ts ${dir} --template api --target ${target} ${mcp}`
      .cwd("/tmp")
      .quiet()
    const own = OWN_FILES[target] ?? []
    ok(
      `${target}: scaffolds its own files and no other target's`,
      own.every((f) => existsSync(join(dir, f))) &&
        OTHER_FILES.filter((f) => !own.includes(f)).every((f) => !existsSync(join(dir, f))) &&
        !existsSync(join(dir, "_targets")),
    )
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    const appTs = readFileSync(join(dir, "src/app.ts"), "utf8")
    const envTs = readFileSync(join(dir, "src/env.ts"), "utf8")
    if (mcp === "--no-mcp")
      ok(
        `${target} --no-mcp: no MCP dependency, file, import or mention`,
        !pkg.dependencies["@modelcontextprotocol/server"] &&
          !existsSync(join(dir, "test/mcp.test.ts")) &&
          !existsSync(join(dir, "test/mcp-off.test.ts")) &&
          !/mcp/i.test(appTs) &&
          !/mcp/i.test(envTs),
      )
    else
      ok(
        `${target} --mcp: the dependency and the mount`,
        !!pkg.dependencies["@modelcontextprotocol/server"] && appTs.includes("appTools(app)"),
      )
    const ci = readFileSync(join(dir, CI), "utf8")
    const ciScripts = [...ci.matchAll(/bun run ([\w:-]+)/g)].map((m) => m[1])
    ok(
      `${target}: no wrangler, and CI only calls scripts that exist`,
      !pkg.devDependencies.wrangler &&
        !ci.includes("--dry-run") &&
        ciScripts.every((s) => s in pkg.scripts),
      ciScripts.join(","),
    )
    if (target === "bun")
      ok(
        "bun: Dockerfile ships with the app name",
        readFileSync(join(dir, "Dockerfile"), "utf8").includes(
          "docker build -t __scaffold_api_bun__",
        ),
      )

    await installLocal(dir)
    const tc = await $`bun run typecheck`.cwd(dir).nothrow().quiet()
    ok(`${target}: typechecks`, tc.exitCode === 0, tc.stdout.toString().slice(-600))
    ok(`${target}: lints clean`, (await $`bun run lint`.cwd(dir).nothrow().quiet()).exitCode === 0)
    ok(
      `${target}: app tests pass`,
      (await $`bun run test`.cwd(dir).nothrow().quiet()).exitCode === 0,
    )

    if (target === "bun") await servesAndLimits("bun", ["bun", "src/server.ts"], dir)
    // Needs Node 22.18+ on PATH: the file runs as is, by type stripping.
    if (target === "node") await servesAndLimits("node", ["node", "src/server.ts"], dir)
    // Needs Deno 2 on PATH.
    if (target === "deno")
      await servesAndLimits("deno", ["deno", "run", "-A", "src/server.ts"], dir)
    if (target === "vercel") {
      const out = await $`bun -e ${`const app = (await import("./index.ts")).default
const h = await app.fetch(new Request("http://x/api/health", { headers: { "x-forwarded-for": "198.51.100.7" } }))
const bad = await app.fetch(new Request("http://x/api/echo", { method: "POST", body: "{}", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" } }))
console.log(JSON.stringify({ health: h.status, rid: !!h.headers.get("x-request-id"), bad: bad.status, code: (await bad.json()).code }))`}`
        .cwd(dir)
        .nothrow()
        .quiet()
      const r = JSON.parse(out.stdout.toString().trim() || "{}")
      ok(
        "vercel: the default export serves the app (health 200 with a request id, envelope on 400)",
        r.health === 200 && r.rid && r.bad === 400 && r.code === "VALIDATION_FAILED",
        out.stdout.toString() + out.stderr.toString().slice(-400),
      )
    }
  } catch (err) {
    ok(`${target}: scaffold run completed`, false, String(err))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
