/**
 * Notifications from signet-server (`./notify/notifier`): templates checked
 * against a zod schema, preferences, quiet hours, an in-app inbox, delivery
 * tracking and one-click unsubscribe. Added by `signet add notify`.
 *
 * Send with `notifier().notify(userId, "account.welcome", { name })`.
 * Fill in `recipients` from your users table, and point Resend's webhook at
 * /notify/resend. Notify is mounted outside /api so the template's CSRF
 * check does not block one-click unsubscribe POSTs from mail clients.
 */

import { memoryKv } from "@dapplelight/signet-server/adapters"
import { resendSender } from "@dapplelight/signet-server/notify/channels"
import {
  createNotifier,
  defineTemplates,
  kvNotifyStore,
} from "@dapplelight/signet-server/notify/notifier"
import { resendWebhook, unsubscribeRoute } from "@dapplelight/signet-server/notify/webhooks"
import { Hono } from "hono"
import { z } from "zod"
import { env } from "../env.ts"

export const templates = defineTemplates({
  "account.welcome": {
    category: "account",
    data: z.object({ name: z.string() }),
    en: {
      email: { subject: (d) => `Welcome, ${d.name}`, html: (d) => `<p>Welcome, ${d.name}.</p>` },
      inApp: { title: () => "Welcome", body: (d) => `Glad you are here, ${d.name}.` },
    },
  },
})

// memoryKv keeps the inbox and delivery records in this process only. Use
// cloudflareKv or upstashKv from @dapplelight/signet-server/adapters in production.
const store = kvNotifyStore(memoryKv())

const make = () =>
  createNotifier({
    templates,
    store,
    channels: { email: resendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }) },
    // { email, phone, locale, timezone } for the user, or null to skip them.
    recipients: async (_userId) => null,
    secret: env.NOTIFY_SECRET,
    unsubscribeUrl: `${env.API_URL}/notify/unsubscribe`,
  })
let made: ReturnType<typeof make> | undefined

/** Built on first use, when env is readable (never at import). */
export const notifier = () => {
  made ??= make()
  return made
}

export const notifyRoutes = () =>
  new Hono()
    .on(["GET", "POST"], "/unsubscribe", (c) => unsubscribeRoute(notifier())(c.req.raw))
    .post("/resend", (c) =>
      resendWebhook(notifier(), { secret: env.RESEND_WEBHOOK_SECRET })(c.req.raw),
    )
