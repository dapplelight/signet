import { isAuthError } from "@dapplelight/signet-lib/api"
import { isRetryable } from "@dapplelight/signet-lib/api/query-client"
import { createOutbox } from "@dapplelight/signet-lib/offline"
import * as Network from "expo-network"
import { useEffect, useState } from "react"
import { api } from "./api"
import { appStorage } from "./storage"

/** A write to send when the phone is back online. */
export type QueuedWrite = {
  method: "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  body?: unknown
}

export const outbox = createOutbox<QueuedWrite>({ storage: appStorage, key: "outbox" })

const listeners = new Set<() => void>()
const changed = () => {
  for (const l of listeners) l()
}

/** Send what is queued, oldest first. A write the server refuses for good (a 4xx) is dropped. */
export async function flushOutbox(): Promise<number> {
  const sent = await outbox.flush(async (w, id) => {
    try {
      await api.request(w.path, {
        method: w.method,
        ...(w.body === undefined ? {} : { body: JSON.stringify(w.body) }),
        headers: { "Idempotency-Key": id },
      })
    } catch (e) {
      // Offline, a 5xx or a 401 stays for the next flush; a 400 or 404 never succeeds.
      if (isRetryable(e) || isAuthError(e)) throw e
    }
  })
  changed()
  return sent
}

/**
 * Send `write` now; when the request cannot reach the server, queue it.
 * Resolves "sent" or "queued"; a refusal (a 4xx) still throws, for the form.
 */
export async function sendOrQueue(write: QueuedWrite): Promise<"sent" | "queued"> {
  try {
    await api.request(write.path, {
      method: write.method,
      ...(write.body === undefined ? {} : { body: JSON.stringify(write.body) }),
    })
    return "sent"
  } catch (e) {
    // A fetch that never reached the server is a TypeError; anything else is the server's answer.
    if (!(e instanceof TypeError)) throw e
    await outbox.add(write)
    changed()
    return "queued"
  }
}

/** Flush when the network comes back. Mounted once, in the signed-in layout. */
export function useOutboxFlush() {
  useEffect(() => {
    void flushOutbox().catch(() => {})
    const sub = Network.addNetworkStateListener((s) => {
      if (s.isConnected && s.isInternetReachable !== false) void flushOutbox().catch(() => {})
    })
    return () => sub.remove()
  }, [])
}

/** How many writes wait to be sent. */
export function usePendingWrites(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const read = () => void outbox.count().then(setN, () => {})
    read()
    listeners.add(read)
    return () => {
      listeners.delete(read)
    }
  }, [])
  return n
}
