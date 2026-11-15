import { sessionRoutes } from "@dapplelight/signet-server/auth/hono"
import { maskPhone } from "@dapplelight/signet-server/auth/otp"
import { errorHandler } from "@dapplelight/signet-server/http"
import { adminRoutes } from "@dapplelight/signet-server/http/admin"
import { ApiException } from "@dapplelight/signet-server/http/errors"
import { orgRoutes, tenant } from "@dapplelight/signet-server/http/orgs"
// mcp:begin
import { appTools } from "@dapplelight/signet-server/mcp"
import { mountMcp } from "@dapplelight/signet-server/mcp/hono"
// mcp:end
import { csrfMiddleware } from "@dapplelight/signet-server/middleware/csrf"
import { memoryStore, rateLimit } from "@dapplelight/signet-server/middleware/rate-limit"
import { requestId } from "@dapplelight/signet-server/middleware/request-id"
import { inArray } from "drizzle-orm"
import { Hono } from "hono"
import { type User, users } from "./db/schema.ts"
import { env } from "./env.ts"
import { accountRoutes } from "./routes/account.ts"
import { authRoutes, requireUser } from "./routes/auth.ts"
import { billingRoutes, billingWebhooks } from "./routes/billing.ts"
import { notificationRoutes } from "./routes/notifications.ts"
import { privacyRoutes } from "./routes/privacy.ts"
import { createServices, type Deps, TRUST } from "./services.ts"

export type AppEnv = { Variables: { reqId: string; user: User } }

/** Paths that need a signed-in user. Everything else under /api is public. */
const SIGNED_IN = [
  "/api/account",
  "/api/notifications",
  "/api/privacy",
  "/api/billing",
  "/api/admin",
]

/** An invite link can be looked at before signing in; everything else under /api/orgs needs a user. */
const INVITE_PREVIEW = /^\/api\/orgs\/invites\/[^/]+$/

/**
 * The API. server.ts serves it (and the built web app) under Bun; tests call
 * `createApp(deps).request(...)` with an in-memory database.
 */
export function createApp(deps: Deps) {
  const s = createServices(deps)
  const base = new Hono<AppEnv>()
    .use("*", requestId())
    // Blocks cross-site form posts riding the session cookie. The web app is
    // served from this same origin, so nothing else needs trusting.
    .use("/api/*", csrfMiddleware())
    .use("/api/*", rateLimit<AppEnv>({ store: memoryStore(), trust: TRUST, max: 300 }))
  for (const path of SIGNED_IN) base.use(`${path}/*`, requireUser(s))
  const gate = requireUser(s)
  base.use("/api/orgs/*", (c, next) =>
    c.req.method === "GET" && INVITE_PREVIEW.test(c.req.path) ? next() : gate(c, next),
  )
  // Which org a request is for: the custom domain, a subdomain of
  // ORG_ROOT_DOMAIN, the x-org header, or the cookie the switcher sets. It
  // grants nothing: /api/orgs checks membership on every call.
  base.use("/api/*", tenant({ orgs: s.orgs, rootDomain: env.ORG_ROOT_DOMAIN }))

  const app = base
    .get("/api/health", (c) => c.json({ ok: true }))
    .route("/api/auth", authRoutes(s))
    .route("/api/sessions", sessionRoutes(s.sessions))
    .route("/api/account", accountRoutes(s))
    .route("/api/notifications", notificationRoutes(s))
    .route("/api/privacy", privacyRoutes(s))
    .route("/api/billing", billingRoutes(s))
    .route("/api/webhooks", billingWebhooks(s))
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
    .onError(errorHandler({ isProduction }))

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
