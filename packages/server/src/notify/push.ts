/**
 * Web push fan-out with dead-subscription pruning.
 *
 * The VAPID signing itself is injected rather than implemented: the `web-push`
 * package is Node-only and does not run on Workers, so hardcoding it would make
 * this module unusable in half the places it is needed.
 *
 * What IS here is the part app-a got right and that is easy to omit: a push
 * endpoint that returns 404 or 410 is permanently gone, and a subscription that
 * is never pruned is retried forever on every future notification.
 */

export type PushSubscription = {
  id: string
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export type PushPayload = {
  title: string
  message: string
  url?: string
}

export type PushSender = (sub: PushSubscription, body: string) => Promise<void>

export type PushConfig = {
  /** Performs the signed POST. Wrap `web-push` on Node, or a Workers signer. */
  send: PushSender
  /** Delete a permanently-gone subscription. */
  removeSubscription: (id: string) => Promise<void>
  onEvent?: (event: string, data: Record<string, unknown>) => void
}

/** 404 Not Found and 410 Gone both mean the subscription will never work again. */
export function isGone(err: unknown): boolean {
  const status = (err as { statusCode?: number }).statusCode ?? (err as { status?: number }).status
  return status === 404 || status === 410
}

export function createPusher(config: PushConfig) {
  return {
    /** Returns how many actually delivered. Never throws. */
    async sendTo(subscriptions: PushSubscription[], payload: PushPayload): Promise<number> {
      const body = JSON.stringify(payload)
      let sent = 0
      await Promise.all(
        subscriptions.map(async (sub) => {
          try {
            await config.send(sub, body)
            sent++
          } catch (err) {
            if (isGone(err)) {
              // Prune, or this endpoint is retried on every future send forever.
              await config.removeSubscription(sub.id).catch(() => {})
              config.onEvent?.("push.pruned", { id: sub.id })
            } else {
              config.onEvent?.("push.failed", { id: sub.id, err: String(err) })
            }
          }
        }),
      )
      return sent
    },
  }
}
