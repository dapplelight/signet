import { type AdminContext, type Authorize, defineAdmin, roles } from "@dapplelight/signet-db/admin"
import { createEntitlements, definePlans } from "@dapplelight/signet-db/entitlements"
import { createGrowth } from "@dapplelight/signet-db/growth"
import { createPrivacy } from "@dapplelight/signet-db/privacy"
import { createPayments, sqlStore } from "@dapplelight/signet-payments"
import { razorpay } from "@dapplelight/signet-payments/razorpay"
import type { KeyValue } from "@dapplelight/signet-server/adapters"
import { kvRateLimitStore } from "@dapplelight/signet-server/adapters"
import { kvApiKeyStore } from "@dapplelight/signet-server/auth/api-keys"
import { devSmsSender, type SmsSender } from "@dapplelight/signet-server/auth/otp"
import { kvSessionStore } from "@dapplelight/signet-server/auth/sessions"
import {
  createNotifier,
  defineTemplates,
  kvNotifyStore,
} from "@dapplelight/signet-server/notify/notifier"
import { eq } from "drizzle-orm"
import { z } from "zod"
import type { Db } from "./db/index.ts"
import * as schema from "./db/schema.ts"
import { env } from "./env.ts"

/** The plans. Declare lowest first; `free` is what everyone starts on. */
export const plans = definePlans({
  free: { features: [], limits: { projects: 3 } },
  pro: { features: ["export", "priority-support"], limits: { projects: 100 } },
})
export type PlanId = keyof typeof plans

/** What the paywall shows for each plan. Prices in minor units (paise). */
export const PLAN_DISPLAY: Record<PlanId, { name: string; price: number; blurb: string }> = {
  free: { name: "Free", price: 0, blurb: "Three projects, to try it out" },
  pro: { name: "Pro", price: 49900, blurb: "A hundred projects, export, priority support" },
}

/** DPDP consent purposes the privacy screen lists. Bump NOTICE_VERSION when the notice text changes. */
export const PURPOSES = [
  {
    id: "product-email",
    label: "Product updates by email",
    description: "New features, once a month",
  },
  {
    id: "analytics",
    label: "Usage analytics",
    description: "Which screens you use, to improve them",
  },
] as const
export const NOTICE_VERSION = "2026-01-01"

/** In-app notification templates. Add email, SMS or WhatsApp variants per event as you need them. */
export const templates = defineTemplates({
  "account.welcome": {
    category: "account",
    data: z.object({ name: z.string() }),
    en: {
      inApp: {
        title: () => "Welcome",
        body: (d) => `Hi ${d.name}, your account is ready. Add your name in Account.`,
        link: () => "/account",
      },
    },
  },
  "billing.plan_changed": {
    category: "billing",
    data: z.object({ plan: z.string() }),
    en: {
      inApp: {
        title: () => "Plan changed",
        body: (d) => `You are now on ${d.plan}.`,
        link: () => "/billing",
      },
    },
  },
})

/**
 * Where the client IP comes from: server.ts overwrites x-forwarded-for with the
 * socket's address, so one hop. Behind your own proxy, see server.ts.
 */
export const TRUST = { forwardedHops: 1 } as const

/** Users' columns only an admin may set: who someone is, and what they may do. */
const ADMIN_ONLY_USER_COLUMNS = ["role", "phone"]
const byRole = roles()

/**
 * signet-db's DEFAULT_ROLES (admin: all; staff: all but delete; readonly:
 * look), except that only an admin writes a user's role or phone, so staff
 * cannot promote themselves or take over an account.
 */
const adminAuthorize: Authorize<AdminContext> = (ctx, check) =>
  check.table === "users" &&
  ctx.role !== "admin" &&
  Object.keys(check.input ?? {}).some((k) => ADMIN_ONLY_USER_COLUMNS.includes(k))
    ? false
    : byRole(ctx, check)

export type Deps = {
  db: Db
  /** Raw SQL with `?` placeholders, for signet-payments' store. */
  query: (sql: string, params: unknown[]) => Record<string, unknown>[]
  kv: KeyValue
  /** Sends one-time codes. Default: printed to the console, development only. */
  sms?: SmsSender
}

/** Everything the routes use, built once per process. */
export function createServices({ db, query, kv, sms }: Deps) {
  const orm = db.orm
  const sessions = {
    cookieName: "session",
    secret: env.SESSION_SECRET,
    store: kvSessionStore(kv),
  }
  const rateLimit = kvRateLimitStore(kv)
  const otp = {
    kv,
    secret: env.OTP_SECRET,
    // devSmsSender throws in staging and production: plug in a real sender
    // there, e.g. smsSenderFor(msg91Sms({ ... }), { ... }) from notify/channels.
    sender: sms ?? devSmsSender({ appEnv: env.APP_ENV }),
    rateLimit,
  }
  const notifier = createNotifier({
    channels: {},
    templates,
    store: kvNotifyStore(kv),
    recipients: async (id) => {
      const u = orm.select().from(schema.users).where(eq(schema.users.id, id)).get()
      return u ? { phone: u.phone, ...(u.email ? { email: u.email } : {}) } : null
    },
  })
  const entitlements = createEntitlements(db, {
    plans,
    default: "free",
    tables: schema,
    // Gateway plan ids → your plans, e.g. a Razorpay plan_id.
    billing: { plans: { plan_pro_monthly: "pro" } },
  })
  if (env.BILLING === "fake" && (env.APP_ENV === "production" || env.APP_ENV === "staging"))
    throw new Error(`BILLING=fake switches plans for free; not allowed in ${env.APP_ENV}.`)
  const payments = createPayments({
    gateways:
      env.BILLING === "razorpay" && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
        ? [
            razorpay({
              keyId: env.RAZORPAY_KEY_ID,
              keySecret: env.RAZORPAY_KEY_SECRET,
              ...(env.RAZORPAY_WEBHOOK_SECRET
                ? { webhookSecret: env.RAZORPAY_WEBHOOK_SECRET }
                : {}),
            }),
          ]
        : [],
    db: sqlStore({ query: async (s, p) => query(s, p) }, { dialect: "sqlite" }),
    // Each subscription event moves the subject's plan; link the subject at
    // checkout with the gateway's notes (see README, "Taking real payments").
    onEvent: async (event) => {
      await entitlements.applyBillingEvent(event)
    },
  })
  return {
    db,
    orm,
    kv,
    sessions,
    rateLimit,
    otp,
    apiKeys: kvApiKeyStore(kv),
    notifier,
    entitlements,
    payments,
    privacy: createPrivacy(db, {
      tables: schema,
      // What export covers and erasure deletes, children before parents.
      userTables: [schema.feedback, [schema.users, schema.users.id]],
      respondWithinMs: 30 * 86_400_000,
    }),
    growth: createGrowth(db, { tables: schema }),
    admin: defineAdmin(schema, {
      authorize: adminAuthorize,
      // Per table by SQL name: search, readonly, hidden columns, row actions.
      tables: { kv: false, idempotency_keys: false },
    }),
  }
}

export type Services = ReturnType<typeof createServices>
