/**
 * Senders for `createNotifier`, one per provider. Plain fetch, no SDKs, so
 * they run on Workers. Each was written from the provider's own API docs,
 * linked at the sender; anything those docs leave open is left out.
 *
 * A non-2xx answer throws a `NotifyError`: permanent for 4xx (except 408 and
 * 429), so the notifier stops; retryable otherwise. Response bodies are not
 * kept on the error: they can echo the message back.
 */

import type { SmsSender } from "../auth/otp.js"
import {
  type Channel,
  NotifyError,
  type Rendered,
  type RenderedSms,
  type Sender,
  type SendResult,
} from "./notifier.js"
import { createPusher, type PushSender, type PushSubscription } from "./push.js"
import { escapeMarkdown } from "./telegram.js"

type Fetch = typeof fetch

async function check(res: Response, provider: string): Promise<void> {
  if (res.ok) return
  const permanent =
    res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
  await res.body?.cancel().catch(() => {})
  throw new NotifyError(
    `${provider.toUpperCase()}_${res.status}`,
    `${provider} answered ${res.status}.`,
    permanent,
  )
}

// --- email -------------------------------------------------------------------

export type ResendSenderConfig = {
  apiKey: string
  /** "Acme <noreply@mail.acme.com>" */
  from: string
  replyTo?: string
  fetch?: Fetch
}

/**
 * Resend. https://resend.com/docs/api-reference/emails/send-email
 * Sends `Idempotency-Key` (the delivery id), so a retry after a timeout is not
 * a second email; Resend keeps keys 24 h.
 */
export function resendSender(config: ResendSenderConfig): Sender<"email"> {
  return {
    provider: "resend",
    async send(to, m, ctx) {
      const res = await (config.fetch ?? fetch)("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": ctx.idempotencyKey,
        },
        body: JSON.stringify({
          from: config.from,
          to: [to],
          subject: m.subject,
          html: m.html,
          text: m.text,
          ...(Object.keys(m.headers).length ? { headers: m.headers } : {}),
          ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        }),
      })
      await check(res, "resend")
      const { id } = (await res.json()) as { id: string }
      return { id, status: "sent" }
    },
  }
}

export type PostmarkSenderConfig = {
  serverToken: string
  from: string
  replyTo?: string
  /** Default "outbound" (Postmark's transactional stream). */
  messageStream?: string
  fetch?: Fetch
}

/**
 * Postmark. https://postmarkapp.com/developer/api/email-api
 * Postmark documents no idempotency header, so a retry after a timeout can
 * send twice; the notifier still never resends a delivery marked sent.
 */
export function postmarkSender(config: PostmarkSenderConfig): Sender<"email"> {
  return {
    provider: "postmark",
    async send(to, m) {
      const res = await (config.fetch ?? fetch)("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": config.serverToken,
        },
        body: JSON.stringify({
          From: config.from,
          To: to,
          Subject: m.subject,
          HtmlBody: m.html,
          TextBody: m.text,
          ...(config.replyTo ? { ReplyTo: config.replyTo } : {}),
          ...(config.messageStream ? { MessageStream: config.messageStream } : {}),
          ...(Object.keys(m.headers).length
            ? { Headers: Object.entries(m.headers).map(([Name, Value]) => ({ Name, Value })) }
            : {}),
        }),
      })
      await check(res, "postmark")
      const body = (await res.json()) as { MessageID: string; ErrorCode: number }
      if (body.ErrorCode !== 0)
        throw new NotifyError(`POSTMARK_${body.ErrorCode}`, "postmark refused the message.", true)
      return { id: body.MessageID, status: "sent" }
    },
  }
}

// --- sms ---------------------------------------------------------------------

/**
 * TRAI DLT: commercial SMS to Indian numbers must name a registered template
 * and header (sender id). Refused here rather than rejected by the operator.
 */
export function assertDlt(to: string, sms: RenderedSms): void {
  if (to.startsWith("+91") && (!sms.dltTemplateId || !sms.senderId))
    throw new NotifyError(
      "DLT_REQUIRED",
      "SMS to +91 needs a DLT template id and sender id on the template.",
      true,
    )
}

export type TwilioSmsConfig = {
  accountSid: string
  /** API key SID (or the account SID for local testing). */
  username: string
  /** API key secret (or the auth token). */
  password: string
  /** A Twilio number in E.164, or use `messagingServiceSid`. India: your DLT sender id goes on the template. */
  from?: string
  messagingServiceSid?: string
  /** Twilio POSTs status changes here; verify with `twilioWebhook`. */
  statusCallback?: string
  fetch?: Fetch
}

/**
 * Twilio Programmable Messaging. https://www.twilio.com/docs/messaging/api/message-resource
 * The template's `senderId` becomes `From` when set (alphanumeric sender ids).
 */
export function twilioSms(config: TwilioSmsConfig): Sender<"sms"> {
  if (!config.from && !config.messagingServiceSid)
    throw new Error("twilioSms needs `from` or `messagingServiceSid`.")
  return {
    provider: "twilio",
    async send(to, m) {
      assertDlt(to, m)
      const form = new URLSearchParams({ To: to, Body: m.text })
      const from = m.senderId ?? config.from
      if (from) form.set("From", from)
      if (config.messagingServiceSid) form.set("MessagingServiceSid", config.messagingServiceSid)
      if (config.statusCallback) form.set("StatusCallback", config.statusCallback)
      const res = await (config.fetch ?? fetch)(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${config.username}:${config.password}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form,
        },
      )
      await check(res, "twilio")
      const { sid } = (await res.json()) as { sid: string; status: string }
      return { id: sid, status: "sent" }
    },
  }
}

export type Msg91SmsConfig = {
  authKey: string
  fetch?: Fetch
}

/**
 * MSG91 SMS via a flow. https://control.msg91.com/apidoc/textsms/send-sms-flow.php
 * The template's `providerTemplateId` is the flow id (the flow is bound to the
 * DLT template in the MSG91 panel), `senderId` the sender, `params` the flow
 * variables. MSG91's response carries a request id, used as the provider id.
 * MSG91 documents no signed delivery webhook, so there is no MSG91 webhook here.
 */
export function msg91Sms(config: Msg91SmsConfig): Sender<"sms"> {
  return {
    provider: "msg91",
    async send(to, m) {
      assertDlt(to, m)
      if (!m.providerTemplateId)
        throw new NotifyError("NO_FLOW_ID", "MSG91 needs the flow id as providerTemplateId.", true)
      const res = await (config.fetch ?? fetch)("https://control.msg91.com/api/v5/flow/", {
        method: "POST",
        headers: { authkey: config.authKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          flow_id: m.providerTemplateId,
          ...(m.senderId ? { sender: m.senderId } : {}),
          recipients: [{ mobiles: to.replace(/^\+/, ""), ...m.params }],
        }),
      })
      await check(res, "msg91")
      const body = (await res.json()) as { type: string; message: string }
      if (body.type !== "success")
        throw new NotifyError("MSG91_ERROR", "msg91 refused the message.", true)
      return { id: body.message, status: "sent" }
    },
  }
}

/**
 * auth's `SmsSender` over a notification SMS sender, so `requestPhoneOtp`
 * uses a real provider. `params` turns the message into template variables
 * (MSG91 flows); default none.
 */
export function smsSenderFor(
  sender: Sender<"sms">,
  template: Omit<RenderedSms, "text" | "params"> & {
    params?: (message: string) => Record<string, string>
  },
): SmsSender {
  return {
    async send(to, message) {
      const { params, ...rest } = template
      await sender.send(
        to,
        { ...rest, text: message, ...(params ? { params: params(message) } : {}) },
        { idempotencyKey: crypto.randomUUID() },
      )
    },
  }
}

// --- whatsapp ----------------------------------------------------------------

export type WhatsAppConfig = {
  accessToken: string
  phoneNumberId: string
  /** Graph API version, e.g. "v23.0". Required: Meta versions every call. */
  apiVersion: string
  /** Is the user's 24 h customer service window open? Default: always closed (templates only). */
  isWindowOpen?: (phone: string) => Promise<boolean>
  fetch?: Fetch
}

/**
 * Meta WhatsApp Cloud API.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
 * Free text only inside the customer service window, a template otherwise;
 * with neither possible the send is refused. Opt-in is checked by the notifier.
 */
export function whatsappSender(config: WhatsAppConfig): Sender<"whatsapp"> {
  return {
    provider: "meta",
    async send(to, m) {
      const open = m.text && config.isWindowOpen ? await config.isWindowOpen(to) : false
      let message: Record<string, unknown>
      if (open && m.text) message = { type: "text", text: { preview_url: false, body: m.text } }
      else if (m.template)
        message = {
          type: "template",
          template: {
            name: m.template.name,
            language: { code: m.template.language },
            ...(m.template.params.length
              ? {
                  components: [
                    {
                      type: "body",
                      parameters: m.template.params.map((text) => ({ type: "text", text })),
                    },
                  ],
                }
              : {}),
          },
        }
      else
        throw new NotifyError(
          "WINDOW_CLOSED",
          "No template and the service window is closed.",
          true,
        )
      const res = await (config.fetch ?? fetch)(
        `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to.replace(/^\+/, ""),
            ...message,
          }),
        },
      )
      await check(res, "meta")
      const body = (await res.json()) as { messages?: { id: string }[] }
      const id = body.messages?.[0]?.id
      if (!id) throw new NotifyError("META_NO_ID", "meta returned no message id.")
      return { id, status: "sent" }
    },
  }
}

// --- push, telegram ----------------------------------------------------------

/** Web push to every subscription of the user (`to` is the user id), pruning dead ones. */
export function pushSender(config: {
  send: PushSender
  subscriptions: (userId: string) => Promise<PushSubscription[]>
  removeSubscription: (id: string) => Promise<void>
}): Sender<"push"> {
  const pusher = createPusher({ send: config.send, removeSubscription: config.removeSubscription })
  return {
    provider: "webpush",
    async send(userId, m) {
      const subs = await config.subscriptions(userId)
      if (!subs.length) throw new NotifyError("NO_SUBSCRIPTIONS", "No push subscriptions.", true)
      const sent = await pusher.sendTo(subs, {
        title: m.title,
        message: m.body,
        ...(m.url ? { url: m.url } : {}),
      })
      if (!sent) throw new NotifyError("PUSH_FAILED", "No push subscription accepted the message.")
      return { id: crypto.randomUUID(), status: "sent" }
    },
  }
}

/** Telegram Bot API to a user's own chat (`to` = chat id). https://core.telegram.org/bots/api#sendmessage */
export function telegramSender(config: { botToken: string; fetch?: Fetch }): Sender<"telegram"> {
  return {
    provider: "telegram",
    async send(chatId, m) {
      const res = await (config.fetch ?? fetch)(
        `https://api.telegram.org/bot${config.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `*${escapeMarkdown(m.title)}*\n${escapeMarkdown(m.body)}`,
            parse_mode: "MarkdownV2",
          }),
        },
      )
      await check(res, "telegram")
      const body = (await res.json()) as { result?: { message_id?: number } }
      return { id: `${chatId}:${body.result?.message_id ?? ""}`, status: "sent" }
    },
  }
}

// --- dev ---------------------------------------------------------------------

/**
 * Prints each message instead of sending it, for local development only (that
 * is the one place a body or code is written out). Throws when `appEnv` is
 * production or staging, like `devSmsSender`.
 */
export function devSender<C extends Exclude<Channel, "inApp">>(
  channel: C,
  opts: { appEnv?: string; log?: (line: string) => void } = {},
): Sender<C> {
  const appEnv = opts.appEnv ?? "local"
  if (appEnv === "production" || appEnv === "staging")
    throw new Error(`SECURITY: devSender prints messages; not allowed in ${appEnv}.`)
  const log = opts.log ?? console.log
  return {
    provider: "dev",
    async send(to, rendered: Rendered[C]): Promise<SendResult> {
      const shown =
        channel === "email"
          ? { ...(rendered as Rendered["email"]), html: "[html omitted]" }
          : rendered
      log(`[dev ${channel}] to ${to}: ${JSON.stringify(shown)}`)
      return { id: crypto.randomUUID(), status: "sent" }
    },
  }
}
