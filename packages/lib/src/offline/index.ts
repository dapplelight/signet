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
 * `send` must be safe to repeat for the same `id` (send it as an idempotency key):
 * a crash between sending and removing, or a browser without Web Locks, can
 * deliver an item twice. Where `navigator.locks` exists, tabs and the service
 * worker sharing a `key` take turns, so each item is sent once per flush.
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
  // Across tabs and the service worker: one holder per name where Web Locks exist.
  const lock = <R>(name: string, fn: () => Promise<R>): Promise<R> => {
    const locks = (
      globalThis as {
        navigator?: { locks?: { request<R>(n: string, cb: () => Promise<R>): Promise<R> } }
      }
    ).navigator?.locks
    return locks ? locks.request(`${key}:${name}`, fn) : fn()
  }
  // Serialise reads and writes of the array (this instance in order, other tabs by lock) so add and flush never overwrite each other.
  let chain: Promise<unknown> = Promise.resolve()
  const locked = <R>(fn: () => Promise<R>): Promise<R> => {
    const go = () => lock("rw", fn)
    const run = chain.then(go, go)
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
      // One flush at a time: a second call (an "online" event and a timer together) joins it,
      // and another tab's flush waits for the lock, then reads what is left.
      flushing ??= lock("flush", async () => {
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
      }).finally(() => {
        flushing = null
      })
      return flushing
    },
    clear() {
      return locked(() => storage.remove(key))
    },
  }
}
