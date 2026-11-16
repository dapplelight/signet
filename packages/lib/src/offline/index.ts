/**
 * An outbox for work done offline: `add` saves an item, `flush` sends each one
 * and drops it once sent, keeping failures for the next try. Built on a
 * `StorageAdapter`, so it works in a browser (`indexedDbStorage`, `webStorage`),
 * an extension, a Tauri app or a CLI alike.
 *
 *   const outbox = createOutbox<NewExpense>({ storage: indexedDbStorage() })
 *   if (!navigator.onLine) await outbox.add(expense)
 *   addEventListener("online", () => outbox.flush((e) => api.post("/expenses", e)))
 *
 * Items are stored as one JSON array under `key`: fine for the tens or hundreds
 * of items a person queues offline. ponytail: one key, rewrite on each change;
 * a store-per-item layout if queues ever reach thousands.
 */

import type { StorageAdapter } from "../storage/index.js"

export type OutboxOptions = {
  storage: StorageAdapter
  /** Storage key; one per outbox. */
  key?: string
}

export type Outbox<T> = {
  add(item: T): Promise<string>
  count(): Promise<number>
  /** Send every item in order; sent ones are removed. Returns how many were sent. */
  flush(send: (item: T, id: string) => Promise<void>): Promise<number>
  clear(): Promise<void>
}

type Entry<T> = { id: string; item: T }

export function createOutbox<T>({ storage, key = "signet-outbox" }: OutboxOptions): Outbox<T> {
  const read = async (): Promise<Entry<T>[]> => {
    const raw = await storage.get(key)
    if (!raw) return []
    try {
      const v = JSON.parse(raw)
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }
  const write = (entries: Entry<T>[]) =>
    entries.length ? storage.set(key, JSON.stringify(entries)) : storage.remove(key)
  // Serialise this outbox's own reads and writes so add and flush never overwrite each other.
  let chain: Promise<unknown> = Promise.resolve()
  const locked = <R>(fn: () => Promise<R>): Promise<R> => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => {})
    return run
  }
  let flushing: Promise<number> | null = null

  return {
    add(item) {
      return locked(async () => {
        const id = crypto.randomUUID()
        await write([...(await read()), { id, item }])
        return id
      })
    },
    async count() {
      return (await read()).length
    },
    flush(send) {
      // One flush at a time: a second call (an "online" event and a timer together) joins it.
      flushing ??= (async () => {
        try {
          const sent = new Set<string>()
          for (const { id, item } of await read()) {
            try {
              await send(item, id)
              sent.add(id)
            } catch {
              // kept for the next flush
            }
          }
          // Re-read: items added while sending stay.
          if (sent.size)
            await locked(async () => write((await read()).filter((e) => !sent.has(e.id))))
          return sent.size
        } finally {
          flushing = null
        }
      })()
      return flushing
    },
    clear() {
      return locked(() => storage.remove(key))
    },
  }
}
