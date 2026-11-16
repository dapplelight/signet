// End to end: spawn the built `signet-mcp` bin under node and talk to it over
// stdio as Claude Code or Cursor would, through signet-server's MCP client (its
// fetch is bridged to the child's stdin and stdout). Then the same server over
// HTTP through signetMcpFetch, and with signet-db's agent tools for two users.
// Needs `bun run build:all`.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { resolveMcpServer } from "@dapplelight/signet-server/mcp"
import { createMcpClient, McpClientError } from "@dapplelight/signet-server/mcp/client"
import { createMcpHandler } from "@modelcontextprotocol/server"
import { agentTools } from "../../db/src/agent"
import { scoped } from "../../db/src/scoped"
import { backends } from "../../db/test/harness"
import { signetMcpFetch, signetMcpOptions } from "../src/index"

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
  console.log("  FAIL dist/bin.js is missing; run `bun run build:all` first")
  process.exit(1)
}

const child: ChildProcessWithoutNullStreams = spawn("node", [bin], {
  cwd: new URL("..", import.meta.url).pathname,
})
let stderr = ""
child.stderr.on("data", (d) => {
  stderr += d
})
const waiting = new Map<number, (msg: unknown) => void>()
const stray: string[] = []
let buf = ""
child.stdout.on("data", (chunk: Buffer) => {
  buf += chunk.toString("utf8")
  for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    if (!line.trim()) continue
    try {
      const msg = JSON.parse(line)
      if (msg.id !== undefined) waiting.get(msg.id)?.(msg)
    } catch {
      stray.push(line) // anything on stdout that is not JSON-RPC breaks a client
    }
  }
})
// The MCP client speaks fetch; a stdio server speaks lines. One request in, one line out.
const stdioFetch = async (req: Request): Promise<Response> => {
  const body = await req.text()
  const { id } = JSON.parse(body)
  child.stdin.write(`${body}\n`)
  if (id === undefined) return new Response(null, { status: 202 }) // a notification
  const msg = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`request ${id} timed out`)), 15_000)
    waiting.set(id, (m) => {
      clearTimeout(timer)
      resolve(m)
    })
  })
  return Response.json(msg)
}
const client = createMcpClient({ url: "http://stdio.invalid/mcp", fetch: stdioFetch })

// The client has no API for initialize, resources or prompts, so those go as bare JSON-RPC.
type Rpc = { result?: any; error?: { code: number; message: string } }
let rawId = 1_000_000
const raw = async (method: string, params?: unknown): Promise<Rpc> =>
  (
    await stdioFetch(
      new Request("http://stdio.invalid/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: rawId++, method, params }),
      }),
    )
  ).json()

/** A tools/call result, parsed. A JSON-RPC error (the SDK refusing the input) lands in `r.error`. */
const callOn = async (c: typeof client, name: string, args: Record<string, unknown> = {}) => {
  try {
    const r = await c.callTool(name, args)
    const text = r.content[0]?.text ?? ""
    let json: any
    try {
      json = JSON.parse(text)
    } catch {}
    return { r: r as any, text, json, isError: r.isError === true }
  } catch (e) {
    if (!(e instanceof McpClientError)) throw e
    return { r: { error: e } as any, text: e.message, json: undefined, isError: false }
  }
}
const call = (name: string, args: Record<string, unknown> = {}) => callOn(client, name, args)

const EXPECTED = [
  "search_docs",
  "read_doc",
  "list_exports",
  "get_export",
  "list_components",
  "get_component",
  "compose_component",
  "list_themes",
  "get_theme",
  "list_tokens",
  "check_theme",
  "build_theme",
  "scaffold_app",
  "scaffold_files",
  "check_app",
  "recipe",
  "migration",
]

try {
  const init = await raw("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "0" },
  })
  ok("initialize: serverInfo is signet", init.result?.serverInfo?.name === "signet", init)
  ok(
    "initialize: instructions point at the tools",
    String(init.result?.instructions).includes("search_docs"),
  )

  const tools = await client.listTools()
  const names = tools.map((t) => t.name)
  ok("tools/list: every tool, in order", JSON.stringify(names) === JSON.stringify(EXPECTED), names)
  ok(
    "tools/list: every tool has a description, an object input schema and readOnlyHint",
    tools.every(
      (t) =>
        (t.description?.length ?? 0) > 40 &&
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

  const cc = await call("compose_component", { need: "a searchable command palette" })
  ok(
    "compose_component: a palette need finds command, with its recipe and parts",
    cc.json?.matches?.[0]?.name === "command" &&
      ["selection", "typeahead", "filter"].every((b) => cc.json.matches[0].recipe.includes(b)) &&
      cc.json.matches[0].parts.includes("CommandDialog") &&
      cc.json.matches[0].tokens.length > 0,
    cc.json?.matches,
  )
  ok(
    "compose_component: returns the behaviours and the build guide",
    ["useShortcut", "useControllableState", "matchScore"].every((n) =>
      cc.json?.behaviors?.some((b: any) => b.name === n),
    ) &&
      typeof cc.json?.guide === "string" &&
      cc.json.guide.includes("behaviors"),
    { behaviors: cc.json?.behaviors?.map((b: any) => b.name), guide: cc.json?.guide?.slice(0, 80) },
  )
  const cs = await call("compose_component", { need: "collapsible navigation sidebar" })
  ok(
    "compose_component: navigation need finds sidebar",
    cs.json?.matches?.[0]?.name === "sidebar",
    cs.json?.matches?.map((m: any) => m.name),
  )
  const steps = await call("compose_component", { need: "progress through numbered steps" })
  ok(
    "compose_component: steps need finds stepper",
    steps.json?.matches?.[0]?.name === "stepper",
    steps.json?.matches?.map((m: any) => m.name),
  )
  const none = await call("compose_component", { need: "zzzz qqqq" })
  ok(
    "compose_component: no match still returns the guide",
    none.json?.matches?.length === 0 && !!none.json.guide,
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

  const bt = await call("build_theme", { brand: "#facc15", base: "cinematic" })
  ok(
    "build_theme: CSS, contrast clean, pale brand adjusted",
    bt.json?.css?.includes('@import "@dapplelight/signet-tokens/cinematic.css"') &&
      bt.json.contrast.checked > 20 &&
      bt.json.contrast.failed.length === 0 &&
      bt.json.adjustments.some((a: { token: string }) => a.token === "--primary"),
    bt.json,
  )
  const btj = await call("build_theme", { brand: "#123456", format: "tokens" })
  ok("build_theme: tokens format is DTCG", btj.json?.tokens?.light?.primary?.$type === "color")
  const badBrand = await call("build_theme", { brand: "teal" })
  ok(
    "build_theme: a non-hex brand is refused",
    badBrand.isError || !!badBrand.r?.error,
    badBrand.text,
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
  const own = await call("recipe", { task: "copy a component into my app and own the code" })
  ok(
    "recipe: add-component-source is cut from the cli README and runs signet add / upgrade",
    own.json?.id === "add-component-source" &&
      own.json.steps.some((st: any) => st.markdown.includes("signet add dialog")) &&
      own.json.steps.some((st: any) => st.markdown.includes("signet upgrade")),
    own.json?.id,
  )
  const mod = await call("recipe", { task: "wire a backend module and a codemod" })
  ok(
    "recipe: add-backend-module is cut from the cli README and covers wiring and codemods",
    mod.json?.id === "add-backend-module" &&
      mod.json.steps.some((st: any) => st.markdown.includes("signet add auth payments")) &&
      mod.json.steps.some((st: any) => st.markdown.includes("generateText")),
    mod.json?.id,
  )
  const mcpr = await call("recipe", { task: "routes as tools with approval" })
  ok(
    "recipe: mcp-by-default is cut from the server README and covers appTools and approvals",
    mcpr.json?.id === "mcp-by-default" &&
      JSON.stringify(mcpr.json).includes("appTools") &&
      JSON.stringify(mcpr.json).includes("kvApprovals"),
    mcpr.json?.id,
  )
  const tr = await call("recipe", { task: "playwright visual regression with fake payments" })
  ok(
    "recipe: add-tests is cut from the signet-test README and covers fakes, themes and demo mode",
    tr.json?.id === "add-tests" &&
      ["fakeGateway", "expectAcrossThemes", "createDemo", "DevOverlay"].every((t) =>
        JSON.stringify(tr.json).includes(t),
      ) &&
      !tr.json.install.includes("@dapplelight/signet-test"),
    tr.json?.id,
  )
  const pub = await call("recipe", { task: "openapi docs and outbound webhooks" })
  ok(
    "recipe: publish-an-api is cut from the server, db and lib READMEs and covers spec, webhooks and caching",
    pub.json?.id === "publish-an-api" &&
      JSON.stringify(pub.json.steps.map((st: any) => st.title)) ===
        JSON.stringify([
          "OpenAPI from the validators",
          "Outbound webhooks",
          "Outbound webhooks",
          "Webhooks: Standard Webhooks signatures",
          "HTTP caching",
        ]) &&
      pub.json.steps[0].markdown.includes("serveOpenApi(app") &&
      pub.json.steps[2].markdown.includes("createWebhooks(db") &&
      pub.json.steps[3].markdown.includes("verifyWebhook(") &&
      pub.json.steps[4].markdown.includes("httpCache(") &&
      !pub.json.install.includes("@dapplelight/signet-db"),
    pub.json?.id,
  )
  const dbr = await call("recipe", { task: "add a database" })
  ok(
    "recipe: add-db is cut from the db README headings and installs signet-db",
    dbr.json?.id === "add-db" &&
      dbr.json.title === "Add a database (D1, SQLite, Postgres) with signet-db" &&
      JSON.stringify(dbr.json.steps.map((st: any) => st.title)) ===
        JSON.stringify([
          "Quick start",
          "Money",
          "Encrypted fields",
          "Per-user scope and soft delete",
          "Transactional outbox",
          "Idempotency keys",
          "AI answer cache",
          "Tools for AI agents",
          "Errors",
        ]) &&
      dbr.json.steps.some((st: any) => st.markdown.includes("agentTools(db")) &&
      dbr.json.install.includes("@dapplelight/signet-db"),
    dbr.json,
  )

  const mon = await call("recipe", { task: "remote paywall offerings and customer center" })
  ok(
    "recipe: add-monetisation is cut from the db and server READMEs and covers offerings, merge, Customer Center and routes",
    mon.json?.id === "add-monetisation" &&
      JSON.stringify(mon.json.steps.map((st: any) => st.title)) ===
        JSON.stringify([
          "Offerings and remote paywalls",
          "Customer timeline",
          "Identity merge",
          "Customer Center",
          "Pricing experiments",
          "Monetisation routes",
        ]) &&
      [
        "createOfferings(db",
        "customers.merge(",
        "requestRefund(",
        "createPricing(db",
        "monetisationRoutes(",
      ].every((t) => JSON.stringify(mon.json).includes(t)) &&
      !mon.json.install.includes("@dapplelight/signet-db"),
    mon.json?.id,
  )

  const abuse = await call("recipe", {
    task: "captcha and disposable email on sign up, ai spend cap",
  })
  ok(
    "recipe: add-abuse-protection is cut from the server and db READMEs and covers captcha, disposable email and spend caps",
    abuse.json?.id === "add-abuse-protection" &&
      JSON.stringify(abuse.json.steps.map((st: any) => st.title)) ===
        JSON.stringify(["Bot checks", "Disposable email", "AI spend caps", "AI spend routes"]) &&
      ["requireCaptcha(", "blockDisposableEmail(", "createAiSpend(db", "requireAiSpend("].every(
        (t) => JSON.stringify(abuse.json).includes(t),
      ) &&
      !abuse.json.install.includes("@dapplelight/signet-db"),
    abuse.json?.id,
  )

  const exr = await call("recipe", {
    task: "a/b test experiment with a status page and maintenance mode",
  })
  ok(
    "recipe: add-experiments is cut from the db and server READMEs and covers experiments, status and maintenance",
    exr.json?.id === "add-experiments" &&
      JSON.stringify(exr.json.steps.map((st: any) => st.title)) ===
        JSON.stringify([
          "Experiments",
          "Pricing experiments",
          "Status page and maintenance",
          "Experiment routes",
          "Status page and maintenance mode",
        ]) &&
      [
        "createExperiments(db",
        "ex.results(",
        "pricing.rollout(",
        "createStatus(db",
        "maintenanceMode(",
        "experimentAdminRoutes(",
      ].every((t) => JSON.stringify(exr.json).includes(t)) &&
      !exr.json.install.includes("@dapplelight/signet-db"),
    exr.json?.id,
  )

  const chr = await call("recipe", { task: "subscription charts: mrr, churn, trial conversion" })
  ok(
    "recipe: add-subscription-charts covers charts, offers, promotional grants and CONSUMPTION_REQUEST",
    chr.json?.id === "add-subscription-charts" &&
      JSON.stringify(chr.json.steps.map((st: any) => st.title)) ===
        JSON.stringify([
          "Subscription charts",
          "Offers",
          "Promotional entitlements",
          "Apple refund requests (CONSUMPTION_REQUEST)",
          "Monetisation routes",
        ]) &&
      [
        "createCharts(db",
        "withOffers(",
        "grantPromotional(",
        "consumptionInfo(",
        "/charts/csv",
      ].every((t) => JSON.stringify(chr.json).includes(t)) &&
      chr.json.verify.length === 4,
    chr.json?.id,
  )

  const fun = await call("recipe", { task: "web-to-app funnel redemption link and discount code" })
  ok(
    "recipe: add-funnels is cut from the db and server READMEs and covers checkout, discounts, redemption, analytics and routes",
    fun.json?.id === "add-funnels" &&
      JSON.stringify(fun.json.steps.map((st: any) => st.title)) ===
        JSON.stringify([
          "Funnels and checkout",
          "URL discounts",
          "Redemption",
          "Funnel analytics",
          "Funnel routes",
        ]) &&
      [
        "createFunnels(db",
        "funnels.applyEvent(",
        "funnels.redeem(",
        "funnelRoutes(",
        "payment_method_domains",
      ].every((t) => JSON.stringify(fun.json).includes(t)) &&
      !fun.json.install.includes("@dapplelight/signet-db"),
    fun.json?.id,
  )

  const wfr = await call("recipe", { task: "durable workflow with an approval step" })
  ok(
    "recipe: add-workflows is cut from the db and server READMEs and covers steps, runners and routes",
    wfr.json?.id === "add-workflows" &&
      ["defineWorkflow", "step.approval", "tick()", "workflowRoutes", "cron trigger"].every((t) =>
        JSON.stringify(wfr.json).includes(t),
      ) &&
      wfr.json.install.includes("@dapplelight/signet-db"),
    wfr.json?.id,
  )

  const col = await call("recipe", { task: "comments with @mentions and undo on records" })
  ok(
    "recipe: add-collab is cut from the db and server READMEs and covers comments, mentions, timeline, undo and routes",
    col.json?.id === "add-collab" &&
      [
        "createCollab",
        "collabTables",
        "parseMentions",
        "timeline(",
        "undo(",
        "collabRoutes",
        "notifyMentions",
      ].every((t) => JSON.stringify(col.json).includes(t)) &&
      !col.json.install.includes("@dapplelight/signet-db"),
    col.json?.id,
  )

  const rtr = await call("recipe", {
    task: "realtime presence and typing indicator over websockets",
  })
  ok(
    "recipe: add-realtime is cut from the server and ui READMEs and covers transports, tenancy, outbox and hooks",
    rtr.json?.id === "add-realtime" &&
      [
        "createRealtime",
        "bunRealtime",
        "attachRealtime",
        "realtimeRoom",
        "REALTIME_TOPIC",
        "useChannel",
        "AvatarStack",
      ].every((t) => JSON.stringify(rtr.json).includes(t)),
    rtr.json?.id,
  )

  const mg = await call("migration", { from: "0.3.0", to: "0.4.0", package: "server" })
  ok(
    "migration: server 0.3 -> 0.4 has breaking bullets",
    mg.json?.entries?.length > 0 &&
      mg.json.entries.some((e: any) => e.breaking.length > 0) &&
      mg.json.currentVersions["@dapplelight/signet-server"],
    mg.json?.entries?.map((e: any) => e.heading),
  )

  const resources = await raw("resources/list")
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
  const read = await raw("resources/read", { uri: "signet://docs/contract" })
  ok(
    "resources/read: CONTRACT.md as markdown",
    read.result?.contents?.[0]?.mimeType === "text/markdown" &&
      read.result.contents[0].text.includes("**78 required, 16 optional.**"),
    read,
  )
  const nope = await raw("resources/read", { uri: "signet://docs/nope" })
  ok("resources/read: an unknown doc is a JSON-RPC error", nope.error !== undefined, nope)

  const prompts = await raw("prompts/list")
  const pnames = prompts.result?.prompts?.map((p: any) => p.name) ?? []
  ok(
    "prompts/list: the three prompts",
    ["build-signet-app", "review-against-signet", "add-signet-feature"].every((p) =>
      pnames.includes(p),
    ),
    pnames,
  )
  const prompt = await raw("prompts/get", {
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
  const http = createMcpClient({ url: "http://localhost/mcp", fetch: signetMcpFetch() })
  const r = await callOn(http, "check_app", { path: "/" })
  ok(
    "http: signetMcpFetch answers tools/call",
    r.r.error === undefined && r.r.content?.length > 0,
    r.text,
  )
  ok(
    "http: check_app has no file-system access when hosted",
    r.text.includes("BAD_REQUEST") && r.text.includes("Pass files."),
    r.text,
  )
}

// --- signet-db: the agent tools for the caller, scoped, writes off by default ---
{
  const { db, S } = await backends[0]!.make({})
  const rowsOf = (user: string, ...labels: string[]) =>
    Promise.all(labels.map((label) => scoped(db, { userId: user }).insert(S.tags, { label })))
  const [[a1]] = await rowsOf("user-a", "alpha one", "alpha two")
  const [[b1]] = await rowsOf("user-b", "beta one")

  /** A client whose requests carry a verified token for `userId`, as `mountMcp` would give them. */
  const as = (
    options: ReturnType<typeof signetMcpOptions>,
    userId?: string,
    scopes: string[] = [],
  ) => {
    const context = userId ? { token: { claims: { sub: userId }, scopes } as never } : {}
    const handler = createMcpHandler(() => resolveMcpServer({ ...options, context }))
    return createMcpClient({ url: "http://localhost/mcp", fetch: (req) => handler.fetch(req) })
  }
  const dbOptions = (allowWrites?: boolean) =>
    signetMcpOptions({
      db: { db, agentTools, tables: [S.tags], ...(allowWrites ? { allowWrites } : {}) },
    })

  const reader = as(dbOptions(), "user-a")
  const listed = await reader.listTools()
  const listedNames = listed.map((t) => t.name)
  ok(
    "db: Signet's tools first, then the read tools, no write tools by default",
    JSON.stringify(listedNames) ===
      JSON.stringify([...EXPECTED, "tags_list", "tags_get", "tags_search"]),
    listedNames,
  )
  ok(
    "db: each read tool says what it does, its row cap, and is readOnlyHint",
    listed
      .filter((t) => t.name.startsWith("tags_"))
      .every(
        (t) => t.annotations?.readOnlyHint === true && /user's tags/.test(t.description ?? ""),
      ) &&
      listed.find((t) => t.name === "tags_list")?.description?.includes("At most 100 per call") ===
        true,
    listed.filter((t) => t.name.startsWith("tags_")),
  )

  const mine = await callOn(reader, "tags_list")
  ok(
    "db: a call as user A returns A's rows and never user B's",
    mine.json?.length === 2 && !mine.text.includes("beta"),
    mine.text,
  )
  const theirs = await callOn(reader, "tags_get", { id: b1!.id })
  ok("db: user A cannot get user B's row by id", theirs.json === null, theirs.text)
  const search = await callOn(reader, "tags_search", {
    column: "label",
    value: "",
    mode: "contains",
  })
  ok(
    "db: a contains-search as user A never matches B's rows",
    search.json?.length === 2,
    search.text,
  )
  const owned = await callOn(reader, "tags_get", { id: a1!.id })
  ok("db: user A gets A's own row", owned.json?.label === "alpha one", owned.text)

  const other = await callOn(as(dbOptions(), "user-b"), "tags_list")
  ok(
    "db: the same server as user B returns only B's rows",
    other.json?.length === 1 && other.text.includes("beta one") && !other.text.includes("alpha"),
    other.text,
  )

  const anonymous = await as(dbOptions()).listTools()
  ok(
    "db: with no caller identity there are no db tools at all",
    JSON.stringify(anonymous.map((t) => t.name)) === JSON.stringify(EXPECTED),
    anonymous.map((t) => t.name),
  )

  const writer = as(dbOptions(true), "user-a")
  const writeTools = (await writer.listTools()).filter((t) => /_(insert|update)$/.test(t.name))
  ok(
    "db: with allowWrites the insert and update tools appear, not read-only and not destructive",
    JSON.stringify(writeTools.map((t) => t.name)) ===
      JSON.stringify(["tags_insert", "tags_update"]) &&
      writeTools.every(
        (t) => t.annotations?.readOnlyHint === false && t.annotations?.destructiveHint === false,
      ),
    writeTools,
  )
  const dry = await callOn(writer, "tags_insert", { values: { label: "draft" }, dryRun: true })
  ok(
    "db: dryRun returns the would-be row and writes nothing",
    dry.json?.wouldInsert?.label === "draft" &&
      (await callOn(writer, "tags_list")).json.length === 2,
    dry.text,
  )
  const missingRow = await callOn(writer, "tags_update", { id: b1!.id, set: { label: "mine now" } })
  ok(
    "db: updating another user's row is a SignetDbError with its message unchanged",
    missingRow.isError &&
      missingRow.text.startsWith("NOT_FOUND: No tags row with id") &&
      missingRow.text.includes("for this user. Use tags_list or tags_search to find it."),
    missingRow.text,
  )

  const gated = signetMcpOptions({
    db: {
      db,
      agentTools,
      tables: [S.tags],
      allowWrites: true,
      scopes: { read: ["db:read"], write: ["db:write"] },
    },
  })
  const dbNames = async (scopes: string[]) =>
    (await as(gated, "user-a", scopes).listTools())
      .map((t) => t.name)
      .filter((n) => /^tags_/.test(n))
  ok(
    "db scopes: the tools stay listed whatever the token carries (calls are what is gated)",
    (await dbNames([])).length === 5,
    await dbNames([]),
  )
  const noScope = await callOn(as(gated, "user-a", ["docs"]), "tags_list")
  ok(
    "db scopes: a token without the read scope cannot run a read tool",
    noScope.isError && /scope/i.test(noScope.text),
    noScope.text,
  )
  const readOnlyToken = as(gated, "user-a", ["db:read"])
  ok(
    "db scopes: the read scope runs read tools",
    (await callOn(readOnlyToken, "tags_list")).json?.length === 2,
  )
  const noWrite = await callOn(readOnlyToken, "tags_insert", { values: { label: "x" } })
  ok(
    "db scopes: the read scope cannot run a write tool",
    noWrite.isError && /scope/i.test(noWrite.text),
    noWrite.text,
  )
  const both = as(gated, "user-a", ["db:read", "db:write"])
  ok(
    "db scopes: the write scope runs a write tool",
    (await callOn(both, "tags_insert", { values: { label: "x" }, dryRun: true })).json?.wouldInsert
      ?.label === "x",
  )

  const scopeSetup = (scopes: { read?: string[]; write?: string[] }, allowWrites: boolean) => {
    try {
      signetMcpOptions({ db: { db, agentTools, tables: [S.tags], allowWrites, scopes } })
      return ""
    } catch (e) {
      return (e as Error).message
    }
  }
  const halfGated = scopeSetup({ read: ["db:read"] }, true)
  ok(
    "db scopes: allowWrites with only read scopes throws instead of leaving writes open",
    halfGated.includes("db.scopes.write is required"),
    halfGated,
  )
  ok(
    "db scopes: an empty write list is rejected too",
    scopeSetup({ read: ["db:read"], write: [] }, true).includes("db.scopes.write"),
  )
  ok(
    "db scopes: only write scopes throws for the read tools",
    scopeSetup({ write: ["db:write"] }, true).includes("db.scopes.read is required"),
  )
  ok(
    "db scopes: without allowWrites, read alone is enough",
    scopeSetup({ read: ["db:read"] }, false) === "",
  )

  let setup = ""
  try {
    signetMcpOptions({ db: { db, agentTools, tables: [S.users] } })
  } catch (e) {
    setup = (e as Error).message
  }
  ok(
    "db: a table with no userId column fails when the options are built, not on a tool call",
    setup.includes("table users has no userId column"),
    setup,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
