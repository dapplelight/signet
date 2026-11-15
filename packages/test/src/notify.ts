/**
 * Fake notification senders: `Sender<C>` from `@dapplelight/signet-server/notify/notifier`,
 * the interface `createNotifier` takes, writing to an in-memory outbox instead
 * of Resend, Twilio, MSG91, WhatsApp, web push or Telegram.
 *
 *   const { outbox, senders } = fakeSenders()
 *   const notify = createNotifier({ ..., senders })
 *   await notify.send(...)
 *   expect(outbox.last("email")?.rendered.subject).toBe("Welcome")
 */
import {
  type Channel,
  type Delivery,
  type InboxItem,
  NotifyError,
  type NotifyStore,
  type OptIn,
  type Prefs,
  type Rendered,
  type Sender,
  type SendResult,
} from "@dapplelight/signet-server/notify/notifier"

export type SendChannel = Exclude<Channel, "inApp">
export const SEND_CHANNELS: readonly SendChannel[] = [
  "email",
  "sms",
  "whatsapp",
  "push",
  "telegram",
]

export type OutboxMessage<C extends SendChannel = SendChannel> = {
  /** The provider message id the sender returned. */
  id: string
  channel: C
  to: string
  rendered: Rendered[C]
  idempotencyKey: string
  /** Epoch ms, from the outbox's `now`. */
  at: number
}

export type Outbox = {
  /** Every message sent, oldest first. */
  readonly messages: OutboxMessage[]
  last<C extends SendChannel>(channel?: C): OutboxMessage<C> | undefined
  /** Messages to one address. */
  to(address: string): OutboxMessage[]
  /** Make the next send on `channel` throw. `permanent` marks it as one a retry cannot fix. */
  failNext(channel: SendChannel, options?: { code?: string; permanent?: boolean }): void
  clear(): void
  /** Store a message (what the fake senders call). Throws a failure queued by `failNext`. */
  record(message: Omit<OutboxMessage, "at">): void
  /** Called after each message is stored (the dev overlay listens here). Returns an unsubscribe. */
  subscribe(listener: (message: OutboxMessage) => void): () => void
}

export function createOutbox(options: { now?: () => number } = {}): Outbox {
  const now = options.now ?? Date.now
  const messages: OutboxMessage[] = []
  const listeners = new Set<(m: OutboxMessage) => void>()
  const failures = new Map<SendChannel, { code: string; permanent: boolean }[]>()
  return {
    messages,
    last: <C extends SendChannel>(channel?: C) =>
      messages.findLast((m) => !channel || m.channel === channel) as OutboxMessage<C> | undefined,
    to: (address) => messages.filter((m) => m.to === address),
    failNext(channel, o = {}) {
      const list = failures.get(channel) ?? []
      list.push({ code: o.code ?? "FAKE_FAILURE", permanent: o.permanent ?? false })
      failures.set(channel, list)
    },
    clear() {
      messages.length = 0
      failures.clear()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    record(m) {
      const fail = failures.get(m.channel)?.shift()
      // A real NotifyError: the notifier only treats `permanent` as final on one.
      if (fail) throw new NotifyError(fail.code, `fake ${m.channel} failure`, fail.permanent)
      const stored = { ...m, at: now() } as OutboxMessage
      messages.push(stored)
      // A throwing listener must not fail the send: the notifier would retry
      // and the message would be stored twice.
      for (const l of listeners)
        try {
          l(stored)
        } catch (err) {
          console.error("signet-test: outbox listener threw", err)
        }
    },
  }
}

/**
 * One fake sender. Failures queued with `outbox.failNext` throw an error
 * shaped like `NotifyError` (`code`, `permanent`), so the notifier's retry
 * logic runs as it would against a real provider. A repeated idempotency key
 * returns the first message's id and stores nothing, as providers do.
 */
export function fakeSender<C extends SendChannel>(
  channel: C,
  outbox: Outbox,
  options: { provider?: string } = {},
): Sender<C> {
  let n = 0
  return {
    provider: options.provider ?? "fake",
    async send(to, rendered, ctx): Promise<SendResult> {
      // Providers dedupe on the idempotency key: a retry gets the first answer.
      const seen = outbox.messages.find(
        (m) => m.channel === channel && m.idempotencyKey === ctx.idempotencyKey,
      )
      if (seen) return { id: seen.id, status: "sent" }
      const id = `fake-${channel}-${++n}`
      outbox.record({ id, channel, to, rendered, idempotencyKey: ctx.idempotencyKey })
      return { id, status: "sent" }
    },
  }
}

/** A fake sender for every sending channel, sharing one outbox. In-app goes to the notify store, not a sender. */
export function fakeSenders(outbox: Outbox = createOutbox()): {
  outbox: Outbox
  senders: { [C in SendChannel]: Sender<C> }
} {
  return {
    outbox,
    senders: {
      email: fakeSender("email", outbox),
      sms: fakeSender("sms", outbox),
      whatsapp: fakeSender("whatsapp", outbox),
      push: fakeSender("push", outbox),
      telegram: fakeSender("telegram", outbox),
    },
  }
}

// ---------------------------------------------------------------- store

export type FakeNotifyStore = NotifyStore & {
  /** Every delivery record, by id. */
  readonly deliveries: Map<string, Delivery>
  /** Inbox items by user, newest first. */
  readonly inboxes: Map<string, InboxItem[]>
  readonly prefs: Map<string, Prefs>
  /** Suppressed addresses as "channel:address" (lower-cased). */
  readonly suppressed: Map<string, string>
  /** Empty everything. */
  reset(): void
}

/**
 * An in-memory `NotifyStore` (the store `createNotifier` takes), with its
 * contents open for assertions. TTLs follow `now`, so a fake clock expires
 * queued payloads and WhatsApp service windows.
 *
 *   const store = fakeNotifyStore()
 *   const notifier = createNotifier({ channels: senders, store, templates, recipients })
 *   expect(store.inboxes.get("u1")?.[0]?.title).toBe("Shipped")
 */
export function fakeNotifyStore(options: { now?: () => number } = {}): FakeNotifyStore {
  const now = options.now ?? Date.now
  const deliveries = new Map<string, Delivery>()
  const inboxes = new Map<string, InboxItem[]>()
  const prefs = new Map<string, Prefs>()
  const suppressed = new Map<string, string>()
  const payloads = new Map<string, { value: unknown; until: number }>()
  const providers = new Map<string, string>()
  const optIns = new Map<string, OptIn>()
  const windows = new Map<string, number>()
  const live = <T>(m: Map<string, { value: T; until: number }>, k: string) => {
    const e = m.get(k)
    if (e && e.until <= now()) m.delete(k)
    return m.get(k)?.value ?? null
  }
  const copy = <T>(v: T): T => structuredClone(v)
  return {
    deliveries,
    inboxes,
    prefs,
    suppressed,
    getPrefs: async (u) => copy(prefs.get(u) ?? null),
    setPrefs: async (u, p) => void prefs.set(u, copy(p)),
    async createDelivery(d) {
      if (deliveries.has(d.id)) return false
      deliveries.set(d.id, copy(d))
      return true
    },
    getDelivery: async (id) => copy(deliveries.get(id) ?? null),
    async updateDelivery(id, patch) {
      const d = deliveries.get(id)
      if (d) deliveries.set(id, { ...d, ...copy(patch) })
    },
    listDeliveries: async (u) =>
      copy([...deliveries.values()].filter((d) => d.userId === u).reverse()),
    putPayload: async (id, value, ttl) =>
      void payloads.set(id, { value: copy(value), until: now() + ttl * 1000 }),
    getPayload: async (id) => copy(live(payloads, id)),
    deletePayload: async (id) => void payloads.delete(id),
    linkProvider: async (p, pid, id) => void providers.set(`${p}:${pid}`, id),
    findByProvider: async (p, pid) => providers.get(`${p}:${pid}`) ?? null,
    suppress: async (ch, a, reason) => void suppressed.set(`${ch}:${a.toLowerCase()}`, reason),
    isSuppressed: async (ch, a) => suppressed.has(`${ch}:${a.toLowerCase()}`),
    async setOptIn(u, o, ch) {
      if (o) optIns.set(`${u}:${ch}`, copy(o))
      else optIns.delete(`${u}:${ch}`)
    },
    getOptIn: async (u, ch) => copy(optIns.get(`${u}:${ch}`) ?? null),
    openWindow: async (phone, s) => void windows.set(phone, now() + s * 1000),
    isWindowOpen: async (phone) => (windows.get(phone) ?? 0) > now(),
    addInbox: async (u, item) => void inboxes.set(u, [copy(item), ...(inboxes.get(u) ?? [])]),
    listInbox: async (u) => copy(inboxes.get(u) ?? []),
    saveInbox: async (u, items) => void inboxes.set(u, copy(items)),
    async deleteUser(u) {
      for (const [id, d] of deliveries)
        if (d.userId === u) {
          deliveries.delete(id)
          payloads.delete(id)
        }
      inboxes.delete(u)
      prefs.delete(u)
      for (const k of optIns.keys()) if (k.startsWith(`${u}:`)) optIns.delete(k)
    },
    reset() {
      for (const m of [
        deliveries,
        inboxes,
        prefs,
        suppressed,
        payloads,
        providers,
        optIns,
        windows,
      ])
        m.clear()
    },
  }
}
