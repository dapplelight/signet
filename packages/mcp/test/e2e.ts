// End to end: spawn the built `signet-mcp` bin under node and speak MCP over
// stdio by hand (newline-delimited JSON-RPC), as Claude Code or Cursor would.
// Then the same server over HTTP through signetMcpFetch. Needs `bun run build`.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { signetMcpFetch } from "../src/index"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c
    ? (pass++, console.log("  PASS", n))
    : (fail++,
      console.log(
        "  FAIL",
        n,
        typeof d === "string" ? d.slice(0, 600) : JSON.stringify(d).slice(0, 600),
      ))
}

const bin = new URL("../dist/bin.js", import.meta.url).pathname
if (!existsSync(bin)) {
  console.log("  FAIL dist/bin.js is missing; run `bun run build` first")
  process.exit(1)
}

type Rpc = { id?: number; result?: any; error?: { code: number; message: string } }
const child: ChildProcessWithoutNullStreams = spawn("node", [bin], {
  cwd: new URL("..", import.meta.url).pathname,
})
let stderr = ""
child.stderr.on("data", (d) => {
  stderr += d
})
const pending = new Map<number, (r: Rpc) => void>()
const stray: string[] = []
let buf = ""
child.stdout.on("data", (chunk: Buffer) => {
  buf += chunk.toString("utf8")
  for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    if (!line.trim()) continue
    let msg: Rpc
    try {
      msg = JSON.parse(line)
    } catch {
      stray.push(line) // anything on stdout that is not JSON-RPC breaks a client
      continue
    }
    if (msg.id !== undefined) pending.get(msg.id)?.(msg)
  }
})
let nextId = 1
const send = (method: string, params?: unknown) =>
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) })}\n`,
  )
const request = (method: string, params?: unknown): Promise<Rpc> => {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 15_000)
    pending.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`,
    )
  })
}
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await request("tools/call", { name, arguments: args })
  const text = r.result?.content?.[0]?.text ?? ""
  let json: any
  try {
    json = JSON.parse(text)
  } catch {}
  return { r, text, json, isError: r.result?.isError === true }
}

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "0" },
  })
  ok("initialize: serverInfo is signet", init.result?.serverInfo?.name === "signet", init)
  ok(
    "initialize: instructions point at the tools",
    String(init.result?.instructions).includes("search_docs"),
  )
  send("notifications/initialized")

  const listed = await request("tools/list")
  const names: string[] = listed.result?.tools?.map((t: { name: string }) => t.name) ?? []
  const EXPECTED = [
    "search_docs",
    "read_doc",
    "list_exports",
    "get_export",
    "list_components",
    "get_component",
    "list_themes",
    "get_theme",
    "list_tokens",
    "check_theme",
    "scaffold_app",
    "scaffold_files",
    "check_app",
    "recipe",
    "migration",
  ]
  ok("tools/list: every tool, in order", JSON.stringify(names) === JSON.stringify(EXPECTED), names)
  ok(
    "tools/list: every tool has a description, an object input schema and readOnlyHint",
    listed.result.tools.every(
      (t: any) =>
        t.description.length > 40 &&
        t.inputSchema?.type === "object" &&
        t.annotations?.readOnlyHint === true,
    ),
  )

  const s = await call("search_docs", { query: "csrf sameSite cookie" })
  ok(
    "search_docs: finds the CSRF section",
    s.json?.hits?.some(
      (h: any) => h.ref === "signet://docs/server#csrf-turn-it-on-with-samesite-none",
    ),
    s.json?.hits?.slice(0, 3),
  )

  const d = await call("read_doc", { name: "contract", section: "Required — color" })
  ok(
    "read_doc: returns a section of CONTRACT.md",
    d.text.startsWith("## Required — color") && d.text.includes("--color-background"),
    d.text,
  )

  const le = await call("list_exports", { package: "server" })
  ok(
    "list_exports: server lists /middleware/rate-limit with rateLimit",
    le.json?.packages?.[0]?.exports?.some(
      (e: any) =>
        e.path === "@dapplelight/signet-server/middleware/rate-limit" &&
        e.symbols.includes("rateLimit"),
    ),
  )

  const ge = await call("get_export", {
    path: "@dapplelight/signet-server/http/validate",
    symbol: "parseBody",
  })
  ok(
    "get_export: parseBody's real signature",
    ge.json?.signature ===
      "export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T>",
    ge.json,
  )
  const missing = await call("get_export", {
    path: "@dapplelight/signet-server/http",
    symbol: "nope",
  })
  ok(
    "get_export: an unknown symbol is an isError result naming the alternatives",
    missing.isError && missing.text.includes("NOT_FOUND"),
    missing.text,
  )

  const lc = await call("list_components")
  ok(
    "list_components: lists button and the domain trend-chip",
    lc.json?.components?.some((c: any) => c.name === "button") &&
      lc.json.components.some((c: any) => c.name === "trend-chip" && c.domain),
  )

  const gc = await call("get_component", { name: "Button" })
  ok(
    "get_component: Button's variants, defaults, tokens and example",
    gc.json?.cva?.[0]?.variants?.variant?.includes("destructive") &&
      gc.json.cva[0].defaults.variant === "default" &&
      gc.json.tokens.includes("--color-primary") &&
      gc.json.example.includes('from "@dapplelight/signet-ui/components/button"'),
    gc.json,
  )

  const lt = await call("list_themes")
  ok(
    "list_themes: editorial, cinematic, finance",
    ["editorial", "cinematic", "finance"].every((n) =>
      lt.json?.themes?.some((t: any) => t.name === n),
    ),
  )

  const gt = await call("get_theme", { name: "finance", include_css: true })
  ok(
    "get_theme: finance is an overlay of editorial, with its CSS",
    gt.json?.overlayOf === "editorial" && gt.json.css.includes("--money-credit"),
    gt.json,
  )

  const tk = await call("list_tokens", { kind: "required" })
  ok(
    "list_tokens: 78 required",
    tk.json?.tokens?.length === 78 && tk.json.counts.required === 78,
    tk.json?.counts,
  )

  const editorialCss = (await call("get_theme", { name: "editorial", include_css: true })).json.css
  const ct = await call("check_theme", { css: editorialCss })
  ok(
    "check_theme: editorial passes over the wire",
    ct.json?.ok === true && ct.json.contrast.checked > 20,
    ct.json,
  )

  const sa = await call("scaffold_app", { name: "my-api", template: "api" })
  ok(
    "scaffold_app: the exact command and file list",
    sa.json?.command === "bunx create-signet-app my-api --template api" &&
      sa.json.files.includes("wrangler.jsonc"),
    sa.json,
  )
  const bad = await call("scaffold_app", { name: "x; rm -rf /" })
  ok(
    "scaffold_app: a name that is not a plain directory name is refused",
    bad.isError || !!bad.r.error,
    bad.r,
  )

  const sf = await call("scaffold_files", { name: "my-app", template: "web", theme: "cinematic" })
  const css = sf.json?.files?.find((f: any) => f.path === "src/app.css")?.content ?? ""
  const pkg = JSON.parse(
    sf.json?.files?.find((f: any) => f.path === "package.json")?.content ?? "{}",
  )
  ok(
    "scaffold_files: the theme is filled in",
    css.includes('@import "@dapplelight/signet-tokens/cinematic.css"'),
    css,
  )
  ok(
    "scaffold_files: package.json is named and depends on signet-ui",
    pkg.name === "my-app" && "@dapplelight/signet-ui" in pkg.dependencies,
  )

  const ca = await call("check_app", { path: "../create-signet-app/template-api" })
  ok(
    "check_app: reads a directory from disk (stdio), template-api is clean",
    ca.json?.ok === true && ca.json.passed.includes("rate-limit-do"),
    ca.json,
  )
  const caf = await call("check_app", {
    files: {
      "src/index.ts":
        'import { Hono } from "hono"\nconst key = process.env.KEY\nexport default new Hono()\n',
    },
  })
  ok(
    "check_app: files with a module-scope env read get the finding and a fix",
    caf.json?.findings?.some((f: any) => f.check === "env-module-scope" && f.line === 2 && f.fix),
    caf.json,
  )

  const rc = await call("recipe", { task: "add rate limit" })
  ok(
    "recipe: rate limiting has an install line and the docs' own code",
    rc.json?.id === "add-rate-limit" &&
      rc.json.install.startsWith("bun add @dapplelight/signet-server") &&
      rc.json.steps.some((st: any) => st.markdown.includes("rateLimit(")),
    rc.json?.id,
  )
  const push = await call("recipe", { task: "web push notifications" })
  ok(
    "recipe: free text finds web push",
    push.json?.id === "add-web-push" && push.json.steps[0].markdown.includes("webCryptoPushSender"),
    push.json?.id,
  )

  const mg = await call("migration", { from: "0.3.0", to: "0.4.0", package: "server" })
  ok(
    "migration: server 0.3 -> 0.4 has breaking bullets",
    mg.json?.entries?.length > 0 &&
      mg.json.entries.some((e: any) => e.breaking.length > 0) &&
      mg.json.currentVersions["@dapplelight/signet-server"],
    mg.json?.entries?.map((e: any) => e.heading),
  )

  const resources = await request("resources/list")
  const uris: string[] = resources.result?.resources?.map((r: any) => r.uri) ?? []
  ok(
    "resources/list: every doc as signet://docs/<name>",
    [
      "signet",
      "api",
      "conventions",
      "contract",
      "migration",
      "changelog",
      "server",
      "ui",
      "tokens",
      "lib",
      "ai",
      "config",
      "create-signet-app",
      "mcp",
    ].every((n) => uris.includes(`signet://docs/${n}`)),
    uris,
  )
  const read = await request("resources/read", { uri: "signet://docs/contract" })
  ok(
    "resources/read: CONTRACT.md as markdown",
    read.result?.contents?.[0]?.mimeType === "text/markdown" &&
      read.result.contents[0].text.includes("**78 required, 16 optional.**"),
    read,
  )
  const nope = await request("resources/read", { uri: "signet://docs/nope" })
  ok("resources/read: an unknown doc is a JSON-RPC error", nope.error !== undefined, nope)

  const prompts = await request("prompts/list")
  const pnames = prompts.result?.prompts?.map((p: any) => p.name) ?? []
  ok(
    "prompts/list: the three prompts",
    ["build-signet-app", "review-against-signet", "add-signet-feature"].every((p) =>
      pnames.includes(p),
    ),
    pnames,
  )
  const prompt = await request("prompts/get", {
    name: "add-signet-feature",
    arguments: { feature: "rate limiting" },
  })
  ok(
    "prompts/get: renders with the argument",
    prompt.result?.messages?.[0]?.content?.text?.includes('recipe with "rate limiting"'),
    prompt,
  )

  ok("stdout carried only JSON-RPC", stray.length === 0, stray)
} catch (err) {
  ok("e2e ran", false, `${err}\n${stderr}`)
} finally {
  child.stdin.end()
}

// --- HTTP: the same server through signetMcpFetch (stateless, 2025-era client) ---
{
  const fetchHandler = signetMcpFetch()
  const res = await fetchHandler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "check_app", arguments: { path: "/" } },
      }),
    }),
  )
  const body = await res.text()
  ok(
    "http: signetMcpFetch answers tools/call",
    res.status === 200 && body.includes('"result"'),
    `${res.status} ${body}`,
  )
  ok(
    "http: check_app has no file-system access when hosted",
    body.includes("BAD_REQUEST") && body.includes("Pass files."),
    body,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
