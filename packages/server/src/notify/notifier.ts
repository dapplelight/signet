/**
 * Notifications: one `notify(userId, "event.key", data)` call fans out to
 * email, SMS, WhatsApp, push, Telegram and an in-app inbox, after templates,
 * preferences, quiet hours, suppression, opt-in and rate limits have had their
 * say. Sending never blocks the request: it goes through `defer`, or a job
 * when `notifyJob(notifier)` is registered with `createJobs`.
 *
 * ```ts
 * const templates = defineTemplates({
 *   "order.shipped": {
 *     category: "orders",
 *     data: z.object({ orderId: z.string(), url: z.string().url() }),
 *     en: {
 *       email: { subject: (d) => `Order ${d.orderId} shipped`, html: (d) => `<p>It is on its way.</p>` },
 *       push: { title: () => "Shipped", body: (d) => `Order ${d.orderId}`, url: (d) => d.url },
 *       inApp: { title: () => "Shipped", body: (d) => `Order ${d.orderId}`, link: (d) => d.url },
 *     },
 *   },
 * })
 * const notifier = createNotifier({ channels: { email: resendSender({ apiKey, from }) },
 *   templates, store: kvNotifyStore(kv), defer: waitUntilDefer(ctx), recipients, secret })
 * await notifier.notify(userId, "order.shipped", { orderId, url })
 * ```
 *
 * Bodies and codes are never logged: `onEvent` gets ids, channels and
 * statuses only. A message body is kept in the store only until it is sent.
 */

import type { z } from "zod"
import { type Defer, type KeyValue, processDefer } from "../adapters/index.js"
import { hmacSha256, timingSafeEqual } from "../auth/session.js"
import { defineJob, type Job, type RetryPolicy, retryDelay } from "../jobs/jobs.js"
import type { RateLimitStore } from "../middleware/rate-limit.js"

// --- types -------------------------------------------------------------------

export type Channel = "email" | "sms" | "whatsapp" | "push" | "telegram" | "inApp"
export const CHANNELS: readonly Channel[] = [
  "email",
  "sms",
  "whatsapp",
  "push",
  "telegram",
  "inApp",
]

export type Priority = "normal" | "urgent"

export type DeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "bounced"
  | "opened"
  | "skipped"

export type RenderedEmail = {
  subject: string
  html: string
  text: string
  headers: Record<string, string>
}
/**
 * One SMS. Sends to Indian numbers (+91) are refused without `dltTemplateId`
 * and `senderId` (TRAI DLT). `providerTemplateId` is the provider's own id for
 * the registered template (MSG91's flow id); `params` its variables.
 */
export type RenderedSms = {
  text: string
  dltTemplateId?: string
  senderId?: string
  providerTemplateId?: string
  params?: Record<string, string>
}
/** A WhatsApp template (required outside the 24 h customer service window) and/or free text (inside it). */
export type RenderedWhatsApp = {
  template?: { name: string; language: string; params: string[] }
  text?: string
}
export type RenderedPush = { title: string; body: string; url?: string }
export type RenderedTelegram = { title: string; body: string }
export type RenderedInApp = { title: string; body: string; link?: string }

export type Rendered = {
  email: RenderedEmail
  sms: RenderedSms
  whatsapp: RenderedWhatsApp
  push: RenderedPush
  telegram: RenderedTelegram
  inApp: RenderedInApp
}

export type SendResult = { id: string; status: DeliveryStatus }

/**
 * Sends one rendered message. `to` is the channel's address (email, E.164
 * phone, chat id; the user id for push and in-app). Throw a `NotifyError` with
 * `permanent: true` for a failure a retry cannot fix; any other throw retries.
 */
export type Sender<C extends Channel = Channel> = {
  /** The provider name webhooks report under, e.g. "resend". */
  provider: string
  send(to: string, rendered: Rendered[C], ctx: { idempotencyKey: string }): Promise<SendResult>
}

export class NotifyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly permanent = false,
  ) {
    super(message)
    this.name = "NotifyError"
  }
}

// --- templates ---------------------------------------------------------------

type Fn<D> = (data: D) => string

export type EmailVariant<D> = {
  subject: Fn<D>
  /** Inner HTML. Wrapped in the themed layout. */
  html: Fn<D>
  /** Plain text. Default: derived from `html`. */
  text?: Fn<D>
  /** Optional button under the content. */
  action?: { label: Fn<D>; url: Fn<D> }
}
export type SmsVariant<D> = {
  text: Fn<D>
  dltTemplateId?: string
  senderId?: string
  providerTemplateId?: string
  params?: (data: D) => Record<string, string>
}
export type WhatsAppVariant<D> = {
  /** Approved template name and language code (e.g. "en", "en_US"); params fill {{1}}, {{2}}… */
  template?: { name: string; language: string; params?: (data: D) => string[] }
  /** Free text, used only while the user's customer service window is open. */
  text?: Fn<D>
}
export type PushVariant<D> = { title: Fn<D>; body: Fn<D>; url?: Fn<D> }
export type TelegramVariant<D> = { title: Fn<D>; body: Fn<D> }
export type InAppVariant<D> = { title: Fn<D>; body: Fn<D>; link?: Fn<D> }

export type Variants<D> = {
  email?: EmailVariant<D>
  sms?: SmsVariant<D>
  whatsapp?: WhatsAppVariant<D>
  push?: PushVariant<D>
  telegram?: TelegramVariant<D>
  inApp?: InAppVariant<D>
}

export type TemplateDef<S extends z.ZodType = z.ZodType> = {
  /** Preference category, e.g. "orders". `security`, `otp` and `billing` are required by default. */
  category: string
  data: S
  /** English: the fallback for any locale or channel a locale leaves out. */
  en: Variants<z.output<S>>
  /** Other locales by key, e.g. `{ hi: {...} }`. */
  locales?: Record<string, Variants<z.output<S>>>
}

// biome-ignore lint/suspicious/noExplicitAny: templates with different schemas share one map
export type Templates = Record<string, TemplateDef<any>>

/** Identity at runtime; types each template's variants from its own `data` schema. */
export function defineTemplates<S extends Record<string, z.ZodType>>(
  t: {
    [K in keyof S]: TemplateDef<S[K]>
  },
): { [K in keyof S]: TemplateDef<S[K]> } {
  return t
}

const variantsFor = (t: TemplateDef, locale: string, channel: Channel) =>
  t.locales?.[locale]?.[channel] ?? t.en[channel]

type DataOf<T extends Templates, K extends keyof T> = z.input<T[K]["data"]>

// --- email layout ------------------------------------------------------------

/**
 * Colours for the email layout. Named after the tokens CONTRACT variables they
 * mirror; email clients ignore CSS variables, so values are inlined.
 */
export type EmailTheme = {
  background: string
  foreground: string
  card: string
  primary: string
  primaryFg: string
  mutedFg: string
  border: string
  radius: string
  fontSans: string
}

/** signet-tokens' editorial theme, light mode. */
export const DEFAULT_EMAIL_THEME: EmailTheme = {
  background: "#faf9f7",
  foreground: "#1a1814",
  card: "#f2f0ec",
  primary: "#12833c",
  primaryFg: "#ffffff",
  mutedFg: "#6d665e",
  border: "#d8d4cc",
  radius: "8px",
  fontSans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
}

export const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  )

/** Plain text from HTML: links kept as "text (url)", tags dropped, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(
      /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, url, label) => `${label} (${url})`,
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** The themed HTML shell: one card, optional button, optional unsubscribe footer. Inline styles only. */
export function emailLayout(
  content: string,
  opts: {
    theme?: EmailTheme
    action?: { label: string; url: string }
    unsubscribeUrl?: string
    footer?: string
  } = {},
): string {
  const t = opts.theme ?? DEFAULT_EMAIL_THEME
  const button = opts.action
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(opts.action.url)}" style="display:inline-block;background:${t.primary};color:${t.primaryFg};padding:10px 18px;border-radius:${t.radius};text-decoration:none;font-weight:600">${escapeHtml(opts.action.label)}</a></p>`
    : ""
  const foot = [
    opts.footer ? escapeHtml(opts.footer) : "",
    opts.unsubscribeUrl
      ? `<a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:${t.mutedFg}">Unsubscribe</a>`
      : "",
  ]
    .filter(Boolean)
    .join(" · ")
  return `<!doctype html><html><body style="margin:0;padding:24px;background:${t.background};color:${t.foreground};font-family:${t.fontSans};font-size:15px;line-height:1.5"><div style="max-width:560px;margin:0 auto;background:${t.card};border:1px solid ${t.border};border-radius:${t.radius};padding:24px">${content}${button}</div>${foot ? `<p style="max-width:560px;margin:16px auto 0;color:${t.mutedFg};font-size:12px;text-align:center">${foot}</p>` : ""}</body></html>`
}

// --- preferences -------------------------------------------------------------

export type QuietHours = {
  /** "22:00", local to `timezone`. */
  start: string
  /** "08:00". May be before `start` (overnight). */
  end: string
  /** IANA zone. Default the notifier's `timezone` (Asia/Kolkata). */
  timezone?: string
}

export type Prefs = {
  /** category → channel → allowed. Absent means allowed. */
  channels: Record<string, Partial<Record<Channel, boolean>>>
  quietHours?: QuietHours | null
}

/** Minutes until quiet hours end, or 0 when `at` is outside them. */
export function quietMinutesLeft(q: QuietHours, at: Date, defaultTz = "Asia/Kolkata"): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: q.timezone ?? defaultTz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const now = get("hour") * 60 + get("minute")
  const toMin = (s: string) => {
    const [h = 0, m = 0] = s.split(":").map(Number)
    return h * 60 + m
  }
  const start = toMin(q.start)
  const end = toMin(q.end)
  if (start === end) return 0
  const inside = start < end ? now >= start && now < end : now >= start || now < end
  if (!inside) return 0
  return (end - now + 1440) % 1440 || 1440
}

// --- store -------------------------------------------------------------------

export type InboxItem = {
  id: string
  event: string
  category: string
  title: string
  body: string
  link?: string
  createdAt: string
  readAt?: string
  archivedAt?: string
}

export type Delivery = {
  id: string
  userId: string
  event: string
  category: string
  channel: Channel
  /** Address, masked. The full one is not kept on the record. */
  to: string
  status: DeliveryStatus
  provider?: string
  providerId?: string
  /** A failure or skip reason code, never a body. */
  reason?: string
  attempts: number
  createdAt: string
  updatedAt: string
}

export type OptIn = { channel: Channel; at: string; source?: string }

/** Everything notifications persist. `kvNotifyStore` is the default. */
export type NotifyStore = {
  getPrefs(userId: string): Promise<Prefs | null>
  setPrefs(userId: string, prefs: Prefs): Promise<void>
  /** False when `id` already exists: the idempotency check. */
  createDelivery(d: Delivery): Promise<boolean>
  getDelivery(id: string): Promise<Delivery | null>
  updateDelivery(id: string, patch: Partial<Delivery>): Promise<void>
  listDeliveries(userId: string): Promise<Delivery[]>
  /** The message to send, kept until it is sent. Holds the body (and any code), so it expires. */
  putPayload(id: string, payload: unknown, ttlSeconds: number): Promise<void>
  getPayload(id: string): Promise<unknown | null>
  deletePayload(id: string): Promise<void>
  linkProvider(provider: string, providerId: string, deliveryId: string): Promise<void>
  findByProvider(provider: string, providerId: string): Promise<string | null>
  suppress(channel: Channel, address: string, reason: string): Promise<void>
  isSuppressed(channel: Channel, address: string): Promise<boolean>
  setOptIn(userId: string, optIn: OptIn | null, channel: Channel): Promise<void>
  getOptIn(userId: string, channel: Channel): Promise<OptIn | null>
  /** WhatsApp customer service window: opened by an inbound message, 24 h. */
  openWindow(phone: string, seconds: number): Promise<void>
  isWindowOpen(phone: string): Promise<boolean>
  addInbox(userId: string, item: InboxItem): Promise<void>
  listInbox(userId: string): Promise<InboxItem[]>
  saveInbox(userId: string, items: InboxItem[]): Promise<void>
  /** Delete everything kept for `userId` (prefs, inbox, deliveries, opt-ins). */
  deleteUser(userId: string): Promise<void>
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * The store over any `KeyValue`. Suppressions are keyed by a SHA-256 of the
 * address, so they survive `deleteUser` without keeping the address.
 * ponytail: per-user lists (inbox, delivery ids) are read-modify-write JSON
 * arrays capped at `maxItems`; two writes at the same instant can drop one
 * entry. Use a table-backed store if that matters.
 */
export function kvNotifyStore(
  kv: KeyValue,
  opts: { prefix?: string; maxItems?: number; historyTtlSeconds?: number } = {},
): NotifyStore {
  const p = opts.prefix ?? "signet-notify"
  const max = opts.maxItems ?? 200
  const historyTtl = opts.historyTtlSeconds ?? 90 * 86400
  const json = async <T>(key: string): Promise<T | null> => {
    const raw = await kv.get(key)
    return raw ? (JSON.parse(raw) as T) : null
  }
  const put = (key: string, v: unknown, ttlSeconds?: number) =>
    kv.set(key, JSON.stringify(v), ttlSeconds ? { ttlSeconds } : undefined)
  const ids = (u: string) => `${p}:dl:${u}`
  return {
    getPrefs: (u) => json<Prefs>(`${p}:prefs:${u}`),
    setPrefs: (u, prefs) => put(`${p}:prefs:${u}`, prefs),
    async createDelivery(d) {
      const key = `${p}:d:${d.id}`
      if (kv.incr) {
        if ((await kv.incr(`${p}:claim:${d.id}`, historyTtl)) !== 1) return false
      } else if (await kv.get(key)) return false
      await put(key, d, historyTtl)
      const list = (await json<string[]>(ids(d.userId))) ?? []
      await put(ids(d.userId), [d.id, ...list].slice(0, max), historyTtl)
      return true
    },
    getDelivery: (id) => json<Delivery>(`${p}:d:${id}`),
    async updateDelivery(id, patch) {
      const d = await json<Delivery>(`${p}:d:${id}`)
      if (d) await put(`${p}:d:${id}`, { ...d, ...patch }, historyTtl)
    },
    async listDeliveries(u) {
      const list = (await json<string[]>(ids(u))) ?? []
      const all = await Promise.all(list.map((id) => json<Delivery>(`${p}:d:${id}`)))
      return all.filter((d): d is Delivery => d !== null)
    },
    putPayload: (id, payload, ttl) => put(`${p}:pl:${id}`, payload, ttl),
    getPayload: (id) => json(`${p}:pl:${id}`),
    deletePayload: (id) => kv.delete(`${p}:pl:${id}`),
    linkProvider: (prov, pid, id) =>
      kv.set(`${p}:pv:${prov}:${pid}`, id, { ttlSeconds: historyTtl }),
    findByProvider: (prov, pid) => kv.get(`${p}:pv:${prov}:${pid}`),
    async suppress(ch, address, reason) {
      await put(`${p}:sup:${ch}:${await sha256Hex(address.toLowerCase())}`, {
        reason,
        at: new Date().toISOString(),
      })
    },
    async isSuppressed(ch, address) {
      return !!(await kv.get(`${p}:sup:${ch}:${await sha256Hex(address.toLowerCase())}`))
    },
    async setOptIn(u, optIn, ch) {
      if (optIn) await put(`${p}:opt:${u}:${ch}`, optIn)
      else await kv.delete(`${p}:opt:${u}:${ch}`)
    },
    getOptIn: (u, ch) => json<OptIn>(`${p}:opt:${u}:${ch}`),
    async openWindow(phone, seconds) {
      await kv.set(`${p}:win:${await sha256Hex(phone)}`, "1", { ttlSeconds: seconds })
    },
    async isWindowOpen(phone) {
      return !!(await kv.get(`${p}:win:${await sha256Hex(phone)}`))
    },
    async addInbox(u, item) {
      const list = (await json<InboxItem[]>(`${p}:in:${u}`)) ?? []
      await put(`${p}:in:${u}`, [item, ...list].slice(0, max))
    },
    listInbox: async (u) => (await json<InboxItem[]>(`${p}:in:${u}`)) ?? [],
    saveInbox: (u, items) => put(`${p}:in:${u}`, items),
    async deleteUser(u) {
      const list = (await json<string[]>(ids(u))) ?? []
      await Promise.all([
        ...list.flatMap((id) => [kv.delete(`${p}:d:${id}`), kv.delete(`${p}:pl:${id}`)]),
        kv.delete(ids(u)),
        kv.delete(`${p}:prefs:${u}`),
        kv.delete(`${p}:in:${u}`),
        ...CHANNELS.map((ch) => kv.delete(`${p}:opt:${u}:${ch}`)),
      ])
    },
  }
}

// --- notifier ----------------------------------------------------------------

/** Where to reach a user. Return only what you have; a channel with no address is skipped. */
export type Recipient = {
  email?: string
  phone?: string
  /** WhatsApp number, E.164. Default `phone`. */
  whatsapp?: string
  telegramChatId?: string
  /** Template locale, e.g. "hi". Default "en". */
  locale?: string
  /** Quiet hours zone when the user's prefs give none. */
  timezone?: string
}

export type Senders = { [C in Channel]?: Sender<C> }

export type DeliveryEvent = {
  provider: string
  providerId: string
  status: DeliveryStatus
  /** Set for hard bounces, complaints and STOP: the address is suppressed. */
  suppress?: { channel: Channel; address: string; reason: string }
  at?: string
}

export type NotifierOptions<T extends Templates> = {
  /** Senders by channel. In-app needs none: it writes to the store. */
  channels: Senders
  templates: T
  store: NotifyStore
  /** Who to send to. */
  recipients: (userId: string) => Promise<Recipient | null>
  /** Runs sends after the response. Default `processDefer()` (Node/Bun). On Workers pass `waitUntilDefer(ctx)`. */
  defer?: Defer
  /**
   * Hands a delivery to your job queue instead of `defer`; set by
   * `notifyJob(notifier)` when you register that job. With it, retries use
   * the job's backoff and survive restarts.
   */
  enqueue?: (deliveryId: string, delaySeconds?: number) => Promise<unknown>
  /** Signs unsubscribe tokens. 32+ characters. Required for email unsubscribe links. */
  secret?: string
  /** One-click unsubscribe endpoint; the token is appended as `?token=`. */
  unsubscribeUrl?: string
  /** Categories nobody can turn off. Default security, otp, billing. */
  required?: readonly string[]
  /** Default quiet hours for users with none. Default none. */
  quietHours?: QuietHours | null
  /** Default "Asia/Kolkata". */
  timezone?: string
  /** Per-user per-channel cap. Default 30 per hour per channel. Off without `rateLimitStore`. */
  rateLimit?: { max: number; windowSeconds: number }
  rateLimitStore?: RateLimitStore
  /** In-process retries when there is no `enqueue`. Default 3 attempts, 2 s doubling. */
  retry?: Partial<RetryPolicy>
  emailTheme?: EmailTheme
  emailFooter?: string
  /** How long a queued body is kept. Default 2 days. */
  payloadTtlSeconds?: number
  /** Ids, channels, statuses and reason codes only. Never bodies or codes. */
  onEvent?: (event: string, data: Record<string, unknown>) => void
  /** Test seam. */
  now?: () => number
}

export type NotifyOptions = {
  /** Only these channels (still subject to prefs). Default every channel the template has. */
  channels?: Channel[]
  /** `urgent` bypasses quiet hours. */
  priority?: Priority
  /** Same key, same notification: a second call sends nothing. Default random. */
  idempotencyKey?: string
}

export type NotifyResult = {
  channel: Channel
  deliveryId?: string
  status: DeliveryStatus
  reason?: string
}

type Payload = { channel: Channel; to: string; rendered: unknown; inbox?: InboxItem }

export function maskAddress(a: string): string {
  const at = a.indexOf("@")
  if (at > 0) return `${a[0]}***${a.slice(at)}`
  return a.length <= 7 ? "****" : `${a.slice(0, 3)}${"*".repeat(a.length - 7)}${a.slice(-4)}`
}

const DEFAULT_REQUIRED = ["security", "otp", "billing"]

export type Notifier<T extends Templates> = ReturnType<typeof createNotifier<T>>

export function createNotifier<T extends Templates>(o: NotifierOptions<T>) {
  const { store } = o
  const now = o.now ?? Date.now
  const required = new Set(o.required ?? DEFAULT_REQUIRED)
  const defer = o.defer ?? processDefer()
  const policy: RetryPolicy = { attempts: 3, backoff: "exponential", baseSeconds: 2, ...o.retry }
  const emit = (e: string, d: Record<string, unknown>) => {
    try {
      o.onEvent?.(e, d)
    } catch {}
  }
  const iso = () => new Date(now()).toISOString()

  const allowed = (prefs: Prefs | null, category: string, channel: Channel) =>
    required.has(category) || prefs?.channels[category]?.[channel] !== false

  const addressFor = (r: Recipient, channel: Channel, userId: string): string | undefined =>
    ({
      email: r.email,
      sms: r.phone,
      whatsapp: r.whatsapp ?? r.phone,
      telegram: r.telegramChatId,
      push: userId,
      inApp: userId,
    })[channel]

  // --- unsubscribe tokens: base64url(userId \n category).hmac ---
  const b64 = (s: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(s)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  const unb64 = (s: string) =>
    new TextDecoder().decode(
      Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
    )
  async function unsubscribeToken(userId: string, category: string): Promise<string> {
    if (!o.secret)
      throw new NotifyError("NO_SECRET", "createNotifier({ secret }) signs unsubscribe links.")
    const body = b64(`${userId}\n${category}`)
    return `${body}.${await hmacSha256(o.secret, `unsub:${body}`)}`
  }

  function render(
    event: string,
    channel: Channel,
    data: unknown,
    locale: string,
    extra: { unsubscribeUrl?: string },
  ): unknown {
    const v = variantsFor(o.templates[event] as TemplateDef, locale, channel)
    if (!v) return null
    switch (channel) {
      case "email": {
        const e = v as EmailVariant<unknown>
        const inner = e.html(data)
        const action = e.action
          ? { label: e.action.label(data), url: e.action.url(data) }
          : undefined
        const headers: Record<string, string> = {}
        if (extra.unsubscribeUrl) {
          // RFC 8058: an HTTPS URI plus List-Unsubscribe-Post makes it one-click.
          headers["List-Unsubscribe"] = `<${extra.unsubscribeUrl}>`
          headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
        }
        const text = e.text
          ? e.text(data)
          : htmlToText(
              `${inner}${action ? `<p><a href="${action.url}">${action.label}</a></p>` : ""}`,
            )
        return {
          subject: e.subject(data),
          html: emailLayout(inner, {
            ...(o.emailTheme ? { theme: o.emailTheme } : {}),
            ...(action ? { action } : {}),
            ...(extra.unsubscribeUrl ? { unsubscribeUrl: extra.unsubscribeUrl } : {}),
            ...(o.emailFooter ? { footer: o.emailFooter } : {}),
          }),
          text: extra.unsubscribeUrl ? `${text}\n\nUnsubscribe: ${extra.unsubscribeUrl}` : text,
          headers,
        } satisfies RenderedEmail
      }
      case "sms": {
        const s = v as SmsVariant<unknown>
        return {
          text: s.text(data),
          ...(s.dltTemplateId ? { dltTemplateId: s.dltTemplateId } : {}),
          ...(s.senderId ? { senderId: s.senderId } : {}),
          ...(s.providerTemplateId ? { providerTemplateId: s.providerTemplateId } : {}),
          ...(s.params ? { params: s.params(data) } : {}),
        } satisfies RenderedSms
      }
      case "whatsapp": {
        const w = v as WhatsAppVariant<unknown>
        return {
          ...(w.template
            ? {
                template: {
                  name: w.template.name,
                  language: w.template.language,
                  params: w.template.params?.(data) ?? [],
                },
              }
            : {}),
          ...(w.text ? { text: w.text(data) } : {}),
        } satisfies RenderedWhatsApp
      }
      case "push":
      case "inApp": {
        const p = v as PushVariant<unknown> & InAppVariant<unknown>
        const link = (channel === "push" ? p.url : p.link)?.(data)
        return {
          title: p.title(data),
          body: p.body(data),
          ...(link ? { [channel === "push" ? "url" : "link"]: link } : {}),
        }
      }
      case "telegram": {
        const g = v as TelegramVariant<unknown>
        return { title: g.title(data), body: g.body(data) } satisfies RenderedTelegram
      }
    }
  }

  async function finish(id: string, patch: Partial<Delivery>) {
    await store.updateDelivery(id, { ...patch, updatedAt: iso() })
    emit(`notify.${patch.status}`, { id, ...(patch.reason ? { reason: patch.reason } : {}) })
  }

  /**
   * Send one queued delivery. Throws on a retryable failure (so a job retries
   * it); a permanent failure is recorded and returns. Safe to call twice: a
   * delivery already past `queued` is left alone.
   */
  async function deliver(deliveryId: string): Promise<DeliveryStatus> {
    const d = await store.getDelivery(deliveryId)
    if (!d) return "failed"
    if (d.status !== "queued") return d.status
    const payload = (await store.getPayload(deliveryId)) as Payload | null
    if (!payload) {
      await finish(deliveryId, { status: "failed", reason: "PAYLOAD_EXPIRED" })
      return "failed"
    }
    const attempts = d.attempts + 1
    await store.updateDelivery(deliveryId, { attempts, updatedAt: iso() })
    try {
      let result: SendResult
      if (payload.channel === "inApp") {
        await store.addInbox(d.userId, payload.inbox as InboxItem)
        result = { id: (payload.inbox as InboxItem).id, status: "delivered" }
      } else {
        const sender = o.channels[payload.channel] as Sender | undefined
        if (!sender) throw new NotifyError("NO_SENDER", `No sender for ${payload.channel}.`, true)
        result = await sender.send(payload.to, payload.rendered as never, {
          idempotencyKey: deliveryId,
        })
        await store.linkProvider(sender.provider, result.id, deliveryId)
      }
      await store.deletePayload(deliveryId)
      await finish(deliveryId, {
        status: result.status,
        providerId: result.id,
        ...(payload.channel === "inApp" ? {} : { provider: o.channels[payload.channel]?.provider }),
      })
      return result.status
    } catch (err) {
      const permanent = err instanceof NotifyError && err.permanent
      const code = err instanceof NotifyError ? err.code : "SEND_FAILED"
      if (permanent) {
        await store.deletePayload(deliveryId)
        await finish(deliveryId, { status: "failed", reason: code })
        return "failed"
      }
      emit("notify.retry", { id: deliveryId, attempt: attempts, reason: code })
      throw err
    }
  }

  /** In-process retries for the `defer` path. */
  async function deliverWithRetry(id: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await deliver(id)
        return
      } catch (err) {
        if (attempt >= policy.attempts) {
          await store.deletePayload(id)
          await finish(id, {
            status: "failed",
            reason: err instanceof NotifyError ? err.code : "SEND_FAILED",
          })
          return
        }
        await new Promise((r) => setTimeout(r, retryDelay(policy, attempt) * 1000))
      }
    }
  }

  let enqueue = o.enqueue

  async function notify<K extends keyof T & string>(
    userId: string,
    event: K,
    data: DataOf<T, K>,
    opts: NotifyOptions = {},
  ): Promise<NotifyResult[]> {
    const t = o.templates[event] as TemplateDef | undefined
    if (!t) throw new NotifyError("UNKNOWN_EVENT", `No template for "${event}".`)
    const parsed = t.data.safeParse(data)
    if (!parsed.success) throw new NotifyError("BAD_DATA", `Invalid data for "${event}".`)
    const [recipient, prefs] = await Promise.all([o.recipients(userId), store.getPrefs(userId)])
    const r = recipient ?? {}
    const locale = r.locale ?? "en"
    const key = opts.idempotencyKey ?? crypto.randomUUID()
    const channels = (opts.channels ?? CHANNELS).filter((ch) => variantsFor(t, locale, ch))
    const quiet = prefs?.quietHours === undefined ? o.quietHours : prefs.quietHours
    const quietLeft =
      quiet && opts.priority !== "urgent"
        ? quietMinutesLeft(quiet, new Date(now()), r.timezone ?? o.timezone ?? "Asia/Kolkata")
        : 0

    const results: NotifyResult[] = []
    for (const channel of channels) {
      const skip = (reason: string): void => {
        results.push({ channel, status: "skipped", reason })
        emit("notify.skipped", { event, channel, reason })
      }
      if (!allowed(prefs, t.category, channel)) {
        skip("PREFS")
        continue
      }
      if (channel !== "inApp" && !o.channels[channel]) {
        skip("NO_SENDER")
        continue
      }
      const to = addressFor(r, channel, userId)
      if (!to) {
        skip("NO_ADDRESS")
        continue
      }
      if (channel !== "push" && channel !== "inApp" && (await store.isSuppressed(channel, to))) {
        skip("SUPPRESSED")
        continue
      }
      if (channel === "whatsapp" && !(await store.getOptIn(userId, "whatsapp"))) {
        skip("NO_OPT_IN")
        continue
      }
      const delay = channel === "inApp" ? 0 : quietLeft * 60
      if (delay && !enqueue) {
        skip("QUIET_HOURS")
        continue
      }
      if (o.rateLimitStore && !required.has(t.category)) {
        const lim = o.rateLimit ?? { max: 30, windowSeconds: 3600 }
        const hit = await o.rateLimitStore.hit(
          `notify-${channel}`,
          userId,
          lim.max,
          lim.windowSeconds,
        )
        if (!hit.ok) {
          skip("RATE_LIMITED")
          continue
        }
      }
      const unsub =
        channel === "email" && !required.has(t.category) && o.unsubscribeUrl && o.secret
          ? `${o.unsubscribeUrl}${o.unsubscribeUrl.includes("?") ? "&" : "?"}token=${await unsubscribeToken(userId, t.category)}`
          : undefined
      const rendered = render(
        event,
        channel,
        parsed.data,
        locale,
        unsub ? { unsubscribeUrl: unsub } : {},
      )
      if (!rendered) continue
      const id = (await sha256Hex(`${userId}\n${event}\n${key}\n${channel}`)).slice(0, 32)
      const at = iso()
      const created = await store.createDelivery({
        id,
        userId,
        event,
        category: t.category,
        channel,
        to: channel === "push" || channel === "inApp" ? channel : maskAddress(to),
        status: "queued",
        attempts: 0,
        createdAt: at,
        updatedAt: at,
      })
      if (!created) {
        results.push({ channel, deliveryId: id, status: "skipped", reason: "DUPLICATE" })
        continue
      }
      const payload: Payload = { channel, to, rendered }
      if (channel === "inApp") {
        const r = rendered as RenderedInApp
        payload.inbox = { id, event, category: t.category, ...r, createdAt: at }
      }
      await store.putPayload(id, payload, (o.payloadTtlSeconds ?? 2 * 86400) + delay)
      emit("notify.queued", { id, event, channel })
      if (enqueue) {
        const q = enqueue
        defer(q(id, delay || undefined))
      } else defer(deliverWithRetry(id))
      results.push({ channel, deliveryId: id, status: "queued" })
    }
    return results
  }

  // --- prefs ---
  async function getPrefs(userId: string): Promise<Prefs> {
    return (await store.getPrefs(userId)) ?? { channels: {} }
  }
  /** Merge a change. Turning a channel off for a required category is refused (REQUIRED_CATEGORY). */
  async function updatePrefs(
    userId: string,
    change: { channels?: Prefs["channels"]; quietHours?: QuietHours | null },
  ): Promise<Prefs> {
    for (const [cat, chs] of Object.entries(change.channels ?? {}))
      if (required.has(cat) && Object.values(chs).includes(false))
        throw new NotifyError(
          "REQUIRED_CATEGORY",
          `"${cat}" notifications cannot be turned off.`,
          true,
        )
    if (change.quietHours) quietMinutesLeft(change.quietHours, new Date()) // throws on a bad zone
    const prev = await getPrefs(userId)
    const next: Prefs = { ...prev, channels: { ...prev.channels } }
    for (const [cat, chs] of Object.entries(change.channels ?? {}))
      next.channels[cat] = { ...next.channels[cat], ...chs }
    if (change.quietHours !== undefined) next.quietHours = change.quietHours
    await store.setPrefs(userId, next)
    return next
  }

  // --- inbox ---
  const inbox = {
    /** Newest first. `cursor` is the last id of the previous page. */
    async list(
      userId: string,
      opts: { cursor?: string; limit?: number; archived?: boolean } = {},
    ): Promise<{ items: InboxItem[]; nextCursor?: string }> {
      const all = (await store.listInbox(userId)).filter((i) => !!i.archivedAt === !!opts.archived)
      const start = opts.cursor ? all.findIndex((i) => i.id === opts.cursor) + 1 : 0
      const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100)
      const items = all.slice(start, start + limit)
      const last = items[items.length - 1]
      return start + limit < all.length && last ? { items, nextCursor: last.id } : { items }
    },
    async unreadCount(userId: string): Promise<number> {
      return (await store.listInbox(userId)).filter((i) => !i.readAt && !i.archivedAt).length
    },
    async markRead(userId: string, ids: string[]): Promise<void> {
      const at = iso()
      await store.saveInbox(
        userId,
        (await store.listInbox(userId)).map((i) =>
          ids.includes(i.id) && !i.readAt ? { ...i, readAt: at } : i,
        ),
      )
    },
    async markAllRead(userId: string): Promise<void> {
      const at = iso()
      await store.saveInbox(
        userId,
        (await store.listInbox(userId)).map((i) => (i.readAt ? i : { ...i, readAt: at })),
      )
    },
    async archive(userId: string, id: string): Promise<void> {
      const at = iso()
      await store.saveInbox(
        userId,
        (await store.listInbox(userId)).map((i) => (i.id === id ? { ...i, archivedAt: at } : i)),
      )
    },
  }

  return {
    notify,
    deliver,
    getPrefs,
    updatePrefs,
    inbox,
    templates: o.templates,
    required: [...required],
    /** Used by `notifyJob`; you rarely call it. */
    setEnqueue(fn: NotifierOptions<T>["enqueue"]) {
      enqueue = fn
    },
    unsubscribeToken,
    /**
     * Handle a one-click unsubscribe (RFC 8058 POST, or the footer link's GET):
     * turns email off for the token's category. False for a bad token or a
     * required category.
     */
    async unsubscribe(token: string): Promise<boolean> {
      if (!o.secret) return false
      const [body, sig] = token.split(".")
      if (!body || !sig || !timingSafeEqual(sig, await hmacSha256(o.secret, `unsub:${body}`)))
        return false
      let userId: string
      let category: string
      try {
        ;[userId = "", category = ""] = unb64(body).split("\n")
      } catch {
        return false
      }
      if (!userId || !category || required.has(category)) return false
      await updatePrefs(userId, { channels: { [category]: { email: false } } })
      emit("notify.unsubscribed", { category })
      return true
    },
    /** Record that the user agreed to business-initiated messages on `channel` (WhatsApp). Pass null to withdraw. */
    async setOptIn(userId: string, channel: Channel, optIn: { source?: string } | null) {
      await store.setOptIn(userId, optIn ? { channel, at: iso(), ...optIn } : null, channel)
    },
    /** Apply normalised webhook events: status updates, suppression. Unknown provider ids are ignored. */
    async recordEvents(events: DeliveryEvent[]): Promise<number> {
      let n = 0
      const rank: Record<DeliveryStatus, number> = {
        skipped: 0,
        queued: 1,
        sent: 2,
        delivered: 3,
        opened: 4,
        failed: 5,
        bounced: 5,
      }
      for (const e of events) {
        if (e.suppress) {
          await store.suppress(e.suppress.channel, e.suppress.address, e.suppress.reason)
          emit("notify.suppressed", { channel: e.suppress.channel, reason: e.suppress.reason })
        }
        if (!e.providerId) continue
        const id = await store.findByProvider(e.provider, e.providerId)
        const d = id ? await store.getDelivery(id) : null
        if (!d || !id) continue
        // Webhooks arrive out of order: never move a record backwards.
        if (rank[e.status] < rank[d.status]) continue
        await store.updateDelivery(id, { status: e.status, updatedAt: e.at ?? iso() })
        n++
      }
      return n
    },
    /** A WhatsApp user wrote in: their 24 h customer service window is open. */
    openWhatsAppWindow: (phone: string) => store.openWindow(phone, 86400),
    /** Prefs, opt-ins, inbox and delivery history for `userId`, for a data export. */
    async exportUser(userId: string) {
      const [prefs, inboxItems, deliveries, ...optIns] = await Promise.all([
        store.getPrefs(userId),
        store.listInbox(userId),
        store.listDeliveries(userId),
        ...CHANNELS.map((ch) => store.getOptIn(userId, ch)),
      ])
      return {
        prefs,
        optIns: optIns.filter((x): x is OptIn => x !== null),
        inbox: inboxItems,
        deliveries,
      }
    },
    /** Erase what `exportUser` returns. Suppressions stay (hashed, no address). */
    deleteUser: (userId: string) => store.deleteUser(userId),
  }
}

/**
 * The job that sends queued deliveries, with the jobs runtime's retries and
 * backoff. Register it and the notifier enqueues through it:
 *
 * ```ts
 * const sendJob = notifyJob(notifier, z)
 * const jobs = createJobs({ jobs: [sendJob, ...], queue })
 * ```
 *
 * `z` is your zod import: this module does not load zod itself.
 */
export function notifyJob<T extends Templates>(
  notifier: Notifier<T>,
  zod: typeof z,
  opts: { name?: string; retry?: Partial<RetryPolicy> } = {},
): Job<z.ZodObject<{ id: z.ZodString }>> {
  const job = defineJob({
    name: opts.name ?? "signet-notify.deliver",
    input: zod.object({ id: zod.string().min(1) }),
    retry: { attempts: 5, backoff: "exponential", baseSeconds: 30, ...opts.retry },
    run: async ({ id }) => {
      await notifier.deliver(id)
    },
  })
  notifier.setEnqueue((id, delaySeconds) =>
    job.enqueue({ id }, { key: id, ...(delaySeconds ? { delaySeconds } : {}) }),
  )
  return job
}
