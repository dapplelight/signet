// auth:begin
import { sessionRoutes } from "@dapplelight/signet-server/auth/hono"
// auth:end
// orgs:begin
import { maskPhone } from "@dapplelight/signet-server/auth/otp"
// orgs:end
import { errorHandler } from "@dapplelight/signet-server/http"
// admin:begin
import { adminRoutes } from "@dapplelight/signet-server/http/admin"
import { ApiException } from "@dapplelight/signet-server/http/errors"
// admin:end
// orgs:begin
import { orgRoutes, tenant } from "@dapplelight/signet-server/http/orgs"
// orgs:end
// mcp:begin
import { appTools } from "@dapplelight/signet-server/mcp"
import { mountMcp } from "@dapplelight/signet-server/mcp/hono"
// mcp:end
import { csrfMiddleware } from "@dapplelight/signet-server/middleware/csrf"
import { memoryStore, rateLimit } from "@dapplelight/signet-server/middleware/rate-limit"
import { requestId } from "@dapplelight/signet-server/middleware/request-id"
import { healthRoutes } from "@dapplelight/signet-server/observability/health"
import { createLogger } from "@dapplelight/signet-server/observability/logger"
import { requestLog } from "@dapplelight/signet-server/observability/request-log"
import { traceMiddleware } from "@dapplelight/signet-server/observability/trace"
// orgs:begin
import { inArray } from "drizzle-orm"
// orgs:end
import { Hono } from "hono"
// auth:begin
import { type User, users } from "./db/schema.ts" // @orgs
import type { User } from "./db/schema.ts" // @!orgs
// auth:end
import { env } from "./env.ts"
// auth:begin
import { accountRoutes } from "./routes/account.ts"
import { authRoutes, requireUser } from "./routes/auth.ts"
// auth:end
// payments:begin
import { billingRoutes, billingWebhooks } from "./routes/billing.ts"
// payments:end
// notifications:begin
import { notificationRoutes } from "./routes/notifications.ts"
// notifications:end
// privacy:begin
import { privacyRoutes } from "./routes/privacy.ts"
// privacy:end
import { createServices, type Deps, TRUST } from "./services.ts" // @auth
import { type Deps, TRUST } from "./services.ts" // @!auth

export type AppEnv = { Variables: { reqId: string; user: User } } // @auth
export type AppEnv = { Variables: { reqId: string } } // @!auth

// auth:begin
/** Paths that need a signed-in user. Everything else under /api is public. */
const SIGNED_IN = [
  "/api/account", // the user, profile and API keys
  "/api/notifications", // the inbox // @notifications
  "/api/privacy", // consent and data requests // @privacy
  "/api/billing", // plan and checkout // @payments
  "/api/admin", // the operator's admin API // @admin
]
// auth:end

/** Probes stay out of spans and logs. */
const HEALTH_PATHS = ["/health/live", "/health/ready"]

// orgs:begin
/** An invite link can be looked at before signing in; everything else under /api/orgs needs a user. */
const INVITE_PREVIEW = /^\/api\/orgs\/invites\/[^/]+$/
// orgs:end

/**
 * The API. server.ts serves it (and the built web app) under Bun; tests call
 * `createApp(deps).request(...)` with an in-memory database.
 */
export function createApp(deps: Deps) {
  const s = createServices(deps) // @auth
  const base = new Hono<AppEnv>().use("*", requestId())
  // Off unless server.ts passes `observability` (OBSERVABILITY=on): then a span
  // and a JSON log line pair per request, both carrying the trace id, and
  // /health/live and /health/ready below. Without an OpenTelemetry SDK the
  // spans are no-ops; Signet adds no exporter (see the observability guide).
  const obs = deps.observability
  if (obs) {
    const log = createLogger({
      level: obs.level ?? "info",
      base: { service: obs.serviceName },
      mixin: obs.mixin,
    })
    base.use("*", traceMiddleware({ serviceName: obs.serviceName, skipPaths: HEALTH_PATHS }))
    base.use("*", requestLog({ logger: log, skipPaths: HEALTH_PATHS, slowMs: 1000 }))
  }
  // Blocks cross-site form posts riding the session cookie. The web app is
  // served from this same origin, so nothing else needs trusting.
  base.use("/api/*", csrfMiddleware())
  base.use("/api/*", rateLimit<AppEnv>({ store: memoryStore(), trust: TRUST, max: 300 }))
  // auth:begin
  for (const path of SIGNED_IN) base.use(`${path}/*`, requireUser(s))
  // auth:end
  // orgs:begin
  const gate = requireUser(s)
  base.use("/api/orgs/*", (c, next) =>
    c.req.method === "GET" && INVITE_PREVIEW.test(c.req.path) ? next() : gate(c, next),
  )
  // Which org a request is for: the custom domain, a subdomain of
  // ORG_ROOT_DOMAIN, the x-org header, or the cookie the switcher sets. It
  // grants nothing: /api/orgs checks membership on every call.
  base.use("/api/*", tenant({ orgs: s.orgs, rootDomain: env.ORG_ROOT_DOMAIN }))
  // orgs:end

  const app = base
    .get("/api/health", (c) => c.json({ ok: true }))
    // auth:begin
    .route("/api/auth", authRoutes(s))
    .route("/api/sessions", sessionRoutes(s.sessions))
    .route("/api/account", accountRoutes(s))
    // auth:end
    // notifications:begin
    .route("/api/notifications", notificationRoutes(s))
    // notifications:end
    // privacy:begin
    .route("/api/privacy", privacyRoutes(s))
    // privacy:end
    // payments:begin
    .route("/api/billing", billingRoutes(s))
    .route("/api/webhooks", billingWebhooks(s))
    // payments:end
    // orgs:begin
    // Orgs: switch, settings, members, invites (signet-server orgRoutes).
    // Guard your own org routes the same way: orgGuards({ orgs: s.orgs, userId })
    // .requirePermission("projects:write"), then scoped(s.db, { orgId: currentTenant(c).id }).
    .route(
      "/api/orgs",
      orgRoutes({
        orgs: s.orgs,
        userId: (c) => (c.get("user" as never) as User | undefined)?.id,
        cookieOptions: s.orgCookie,
        // Members are shown by name, else a masked phone.
        users: async (ids) =>
          Object.fromEntries(
            s.orm
              .select()
              .from(users)
              .where(inArray(users.id, ids))
              .all()
              .map((u) => [u.id, { name: u.name ?? maskPhone(u.phone) }]),
          ),
      }),
    )
    // orgs:end
    // admin:begin
    // The operator's admin API over every org (signet-db defineAdmin, config
    // in services.ts): platform roles readonly, staff and admin (ADMIN_PHONES)
    // only; everyone else gets 403. Org owners manage their org under /org.
    .route(
      "/api/admin",
      adminRoutes(s.admin, {
        db: () => s.db,
        ctx: (c) => {
          const user = c.get("user" as never) as User
          if (user.role === "user") throw new ApiException(403, "Admins only.", "FORBIDDEN")
          return { actor: { type: "user" as const, id: user.id }, role: user.role }
        },
      }),
    )
    // admin:end
    .onError(errorHandler({ isProduction }))

  if (obs) {
    // Ready means the database answers. Add a check per dependency you add.
    app.route(
      "/health",
      healthRoutes({
        checks: {
          db: async () => {
            deps.query("select 1", [])
            return true
          },
        },
      }),
    )
  }

  // mcp:begin
  // MCP: every route validated with zValidator is a tool at /mcp that runs
  // as the caller (their cookie or API key goes with it). GET routes are read
  // tools; anything else asks the person first. Turn it off with MCP=off.
  mountMcp(app, "/mcp", {
    name: "__APP_NAME__",
    version: "0.1.0",
    middleware: [async (c, next) => (env.MCP === "off" ? c.notFound() : next())],
    tools: appTools(app),
  })
  // mcp:end
  return app
}

/** For the typed client in src/lib/api.ts: import it with `import type`. */
export type AppType = ReturnType<typeof createApp>

// Fails closed: an env that does not validate counts as production, so a 500
// hides its message instead of leaking it.
function isProduction(): boolean {
  try {
    return env.APP_ENV === "production"
  } catch {
    return true
  }
}
