/**
 * Provider delivery webhooks: verify each with the provider's documented
 * signature scheme, then normalise to `DeliveryEvent`s for
 * `notifier.recordEvents`. Hard bounces, complaints and STOP suppress the
 * address on that channel.
 *
 * ```ts
 * app.post("/hooks/resend", (c) => resendWebhook(notifier, { secret: env.RESEND_WEBHOOK_SECRET })(c.req.raw))
 * app.post("/hooks/twilio", (c) => twilioWebhook(notifier, { authToken, url: "https://api.acme.in/hooks/twilio" })(c.req.raw))
 * app.on(["GET", "POST"], "/hooks/meta", (c) => metaWebhook(notifier, { appSecret, verifyToken })(c.req.raw))
 * ```
 *
 * Each handler answers 401 to a bad signature and 200 otherwise, so a
 * provider does not retry an event we chose to ignore. MSG91 and Postmark are
 * not here: neither documents a signature scheme.
 */

import { timingSafeEqual } from "../auth/session.js"
import type { DeliveryEvent, DeliveryStatus } from "./notifier.js"

type Recorder = {
  recordEvents(e: DeliveryEvent[]): Promise<number>
  openWhatsAppWindow?(phone: string): Promise<void>
}

const enc = new TextEncoder()

async function hmac(
  hash: "SHA-1" | "SHA-256",
  key: Uint8Array<ArrayBuffer>,
  data: string,
): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)))
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("")

// --- Resend (Svix) -----------------------------------------------------------

/**
 * Resend signs with Svix.
 * https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 * https://docs.svix.com/receiving/verifying-payloads/how-manual
 * Signed content `${svix-id}.${svix-timestamp}.${body}`, HMAC-SHA256 keyed by
 * the base64 part of the `whsec_` secret; `svix-signature` is a space
 * separated list of `v1,<base64>`. Svix leaves the tolerance to the receiver;
 * 5 minutes here.
 */
export async function verifyResendSignature(
  secret: string,
  headers: Headers,
  body: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): Promise<boolean> {
  const id = headers.get("svix-id")
  const ts = headers.get("svix-timestamp")
  const sigs = headers.get("svix-signature")
  if (!id || !ts || !sigs || !/^\d+$/.test(ts)) return false
  const now = Math.floor((opts.now ?? Date.now()) / 1000)
  if (Math.abs(now - Number(ts)) > (opts.toleranceSeconds ?? 300)) return false
  let key: Uint8Array<ArrayBuffer>
  try {
    key = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0))
  } catch {
    return false
  }
  const expected = b64(await hmac("SHA-256", key, `${id}.${ts}.${body}`))
  return sigs.split(" ").some((s) => s.startsWith("v1,") && timingSafeEqual(s.slice(3), expected))
}

/** Resend `email.*` events. https://resend.com/docs/dashboard/webhooks/event-types */
export function parseResendEvent(event: {
  type?: string
  created_at?: string
  data?: { email_id?: string; to?: string[]; bounce?: { type?: string } }
}): DeliveryEvent[] {
  const id = event.data?.email_id
  if (!id) return []
  const map: Record<string, DeliveryStatus> = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.opened": "opened",
    "email.bounced": "bounced",
    "email.failed": "failed",
    "email.complained": "failed",
    "email.suppressed": "failed",
  }
  const status = map[event.type ?? ""]
  if (!status) return []
  const out: DeliveryEvent = { provider: "resend", providerId: id, status }
  if (event.created_at) out.at = event.created_at
  const to = event.data?.to?.[0]
  const hard = event.type === "email.bounced" && event.data?.bounce?.type === "Permanent"
  if (to && (hard || event.type === "email.complained"))
    out.suppress = { channel: "email", address: to, reason: hard ? "hard_bounce" : "complaint" }
  return [out]
}

export function resendWebhook(n: Recorder, config: { secret: string; toleranceSeconds?: number }) {
  return async (req: Request): Promise<Response> => {
    const body = await req.text()
    if (!(await verifyResendSignature(config.secret, req.headers, body, config)))
      return new Response("bad signature", { status: 401 })
    let event: Parameters<typeof parseResendEvent>[0]
    try {
      event = JSON.parse(body)
    } catch {
      return new Response("bad json", { status: 400 })
    }
    await n.recordEvents(parseResendEvent(event))
    return new Response("ok")
  }
}

// --- Twilio ------------------------------------------------------------------

/**
 * Twilio's `X-Twilio-Signature`. https://www.twilio.com/docs/usage/security
 * The full URL Twilio called (query included; port kept for SMS callbacks),
 * then each POST parameter sorted by name (case-sensitive) appended as
 * name+value with no delimiters, HMAC-SHA1 keyed by the auth token, base64.
 */
export async function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false
  const names = [...new Set(params.keys())].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  let data = url
  for (const name of names) for (const v of params.getAll(name)) data += name + v
  return timingSafeEqual(signature, b64(await hmac("SHA-1", enc.encode(authToken), data)))
}

/**
 * A Twilio status callback (`MessageSid` + `MessageStatus`) or an inbound
 * message. STOP is an opt-out: `OptOutType=STOP` (Advanced Opt-Out), or a
 * body that is just a standard opt-out keyword.
 * https://www.twilio.com/docs/messaging/api/message-resource
 */
export function parseTwilioEvent(p: URLSearchParams): DeliveryEvent[] {
  const sid = p.get("MessageSid") ?? p.get("SmsSid") ?? ""
  const status = p.get("MessageStatus") ?? p.get("SmsStatus") ?? ""
  if (status === "received" || p.has("Body")) {
    const from = p.get("From")
    const keyword = (p.get("Body") ?? "").trim().toUpperCase()
    const optOut =
      p.get("OptOutType") === "STOP" ||
      ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(keyword)
    return optOut && from
      ? [
          {
            provider: "twilio",
            providerId: "",
            status: "delivered",
            suppress: { channel: "sms", address: from, reason: "stop" },
          },
        ]
      : []
  }
  const map: Record<string, DeliveryStatus> = {
    sent: "sent",
    delivered: "delivered",
    read: "opened",
    failed: "failed",
    undelivered: "failed",
  }
  const s = map[status]
  return sid && s ? [{ provider: "twilio", providerId: sid, status: s }] : []
}

export function twilioWebhook(n: Recorder, config: { authToken: string; url?: string }) {
  return async (req: Request): Promise<Response> => {
    const params = new URLSearchParams(await req.text())
    const ok = await verifyTwilioSignature(
      config.authToken,
      config.url ?? req.url,
      params,
      req.headers.get("x-twilio-signature"),
    )
    if (!ok) return new Response("bad signature", { status: 401 })
    await n.recordEvents(parseTwilioEvent(params))
    // Empty TwiML: no auto-reply.
    return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } })
  }
}

// --- Meta (WhatsApp Cloud API) -----------------------------------------------

/**
 * Meta's `X-Hub-Signature-256`: `sha256=` + hex HMAC-SHA256 of the raw body,
 * keyed by the app secret.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
 */
export async function verifyMetaSignature(
  appSecret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false
  return timingSafeEqual(header.slice(7), hex(await hmac("SHA-256", enc.encode(appSecret), body)))
}

type MetaPayload = {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id?: string; status?: string; timestamp?: string; recipient_id?: string }[]
        messages?: { from?: string; type?: string; text?: { body?: string } }[]
      }
    }[]
  }[]
}

/**
 * Status updates, plus the senders of inbound messages (each opens that
 * user's 24 h service window). An inbound "STOP" suppresses WhatsApp.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
 */
export function parseMetaEvent(payload: MetaPayload): {
  events: DeliveryEvent[]
  inbound: string[]
} {
  const map: Record<string, DeliveryStatus> = {
    sent: "sent",
    delivered: "delivered",
    read: "opened",
    failed: "failed",
  }
  const events: DeliveryEvent[] = []
  const inbound: string[] = []
  for (const entry of payload.entry ?? [])
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        const status = map[s.status ?? ""]
        if (!s.id || !status) continue
        const e: DeliveryEvent = { provider: "meta", providerId: s.id, status }
        if (s.timestamp && /^\d+$/.test(s.timestamp))
          e.at = new Date(Number(s.timestamp) * 1000).toISOString()
        events.push(e)
      }
      for (const m of change.value?.messages ?? []) {
        if (!m.from) continue
        const phone = `+${m.from.replace(/^\+/, "")}`
        inbound.push(phone)
        if (m.type === "text" && m.text?.body?.trim().toUpperCase() === "STOP")
          events.push({
            provider: "meta",
            providerId: "",
            status: "delivered",
            suppress: { channel: "whatsapp", address: phone, reason: "stop" },
          })
      }
    }
  return { events, inbound }
}

/** Handles Meta's GET verification handshake and signed POSTs. */
export function metaWebhook(n: Recorder, config: { appSecret: string; verifyToken: string }) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "GET") {
      const q = new URL(req.url).searchParams
      const ok =
        q.get("hub.mode") === "subscribe" &&
        timingSafeEqual(q.get("hub.verify_token") ?? "", config.verifyToken)
      return ok
        ? new Response(q.get("hub.challenge") ?? "")
        : new Response("forbidden", { status: 403 })
    }
    const body = await req.text()
    if (
      !(await verifyMetaSignature(config.appSecret, body, req.headers.get("x-hub-signature-256")))
    )
      return new Response("bad signature", { status: 401 })
    let payload: MetaPayload
    try {
      payload = JSON.parse(body)
    } catch {
      return new Response("bad json", { status: 400 })
    }
    const { events, inbound } = parseMetaEvent(payload)
    for (const phone of inbound) await n.openWhatsAppWindow?.(phone)
    await n.recordEvents(events)
    return new Response("ok")
  }
}

// --- unsubscribe -------------------------------------------------------------

/**
 * The `unsubscribeUrl` endpoint. POST (RFC 8058 one-click, body
 * `List-Unsubscribe=One-Click`) unsubscribes at once. GET only shows a
 * confirm button: mail scanners prefetch links, and a GET must not change
 * anything. https://www.rfc-editor.org/rfc/rfc8058
 */
export function unsubscribeRoute(n: { unsubscribe(token: string): Promise<boolean> }) {
  return async (req: Request): Promise<Response> => {
    const token = new URL(req.url).searchParams.get("token") ?? ""
    const html = (msg: string, status = 200) =>
      new Response(
        `<!doctype html><meta name="viewport" content="width=device-width"><p>${msg}</p>`,
        {
          status,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      )
    if (req.method === "POST")
      return (await n.unsubscribe(token))
        ? html("You are unsubscribed.")
        : html("This link is invalid or expired.", 400)
    const safe = token.replace(/[^A-Za-z0-9._-]/g, "")
    return html(
      `<form method="post" action="?token=${safe}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button>Unsubscribe</button></form>`,
    )
  }
}
