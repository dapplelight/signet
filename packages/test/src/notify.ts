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
import type {
  Channel,
  Rendered,
  Sender,
  SendResult,
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
      if (fail) throw Object.assign(new Error(`fake ${m.channel} failure`), fail)
      const stored = { ...m, at: now() } as OutboxMessage
      messages.push(stored)
      for (const l of listeners) l(stored)
    },
  }
}

/**
 * One fake sender. Failures queued with `outbox.failNext` throw an error
 * shaped like `NotifyError` (`code`, `permanent`), so the notifier's retry
 * logic runs as it would against a real provider.
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
