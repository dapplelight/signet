import { createEnv } from "@dapplelight/signet-server/env"
import { z } from "zod"

// Every var and secret the API reads, declared once. Read them as `env.KEY`,
// never from process.env directly. Bun loads the env file on its own;
// create-signet-app wrote one with fresh secrets. It is gitignored, so set
// these on your host too.
export const envSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  /** The SQLite file. ":memory:" for a throwaway database. */
  DATABASE_PATH: z.string().default("data/app.db"),
  // auth:begin
  /** Signs session cookies. 32+ random characters, different per environment. */
  SESSION_SECRET: z.string().min(32),
  /** Keys the stored one-time-code hashes. 32+ random characters. */
  OTP_SECRET: z.string().min(32),
  /** Comma-separated phone numbers (E.164) that get the admin role on sign-in. */
  ADMIN_PHONES: z.string().default(""),
  // auth:end
  // payments:begin
  /**
   * "fake": Upgrade switches the plan at once and no money moves. Refused in
   * staging and production. "razorpay": webhooks through signet-payments
   * (see README).
   */
  BILLING: z.enum(["fake", "razorpay"]).default("fake"),
  // payments:end
  // orgs:begin
  /**
   * Your app's own domain, e.g. "app.example.com": then acme.app.example.com
   * opens the org with slug "acme". Hosts outside it are looked up as an
   * org's custom domain (Org settings). Unset, the org comes from the
   * x-org header or the switch cookie, which is all local development needs.
   */
  ORG_ROOT_DOMAIN: z.string().optional(),
  // orgs:end
  /**
   * "on": JSON request logs, a span per request and /health/live and
   * /health/ready (server.ts). Off by default. See observability in app.ts.
   */
  OBSERVABILITY: z.enum(["on", "off"]).default("off"),
  // payments:begin
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // payments:end
  // ai:begin
  /**
   * AI spend caps in cost units (1,000,000 = one US dollar): per user per UTC
   * day, and for the whole app per month. A cap stored in ai_spend_caps wins.
   */
  AI_CAP_USER_DAY: z.coerce.number().int().min(0).default(200_000),
  AI_CAP_GLOBAL_MONTH: z.coerce.number().int().min(0).default(50_000_000),
  // ai:end
  // mcp:begin
  /** The MCP endpoint at /mcp (api/app.ts). "off" answers it with a 404. */
  MCP: z.enum(["on", "off"]).default("on"),
  // mcp:end
})

export type Env = z.infer<typeof envSchema>

/** Validated on first read, not at import. */
export const env = createEnv(envSchema)
