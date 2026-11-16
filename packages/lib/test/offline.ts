/** offline: the outbox on a StorageAdapter, and indexedDbStorage against a small in-memory fake. */

import { createOutbox } from "../src/offline"
import { indexedDbStorage, memoryStorage } from "../src/storage"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, JSON.stringify(d)))
}

// --- outbox ---
{
  const storage = memoryStorage()
  const box = createOutbox<{ n: number }>({ storage })
  await box.add({ n: 1 })
  await box.add({ n: 2 })
  await box.add({ n: 3 })
  ok("count", (await box.count()) === 3)

  const seen: number[] = []
  const sent = await box.flush(async ({ n }) => {
    seen.push(n)
    if (n === 2) throw new Error("offline again")
  })
  ok("flush sends in order", seen.join() === "1,2,3", seen)
  ok("flush returns how many were sent", sent === 2)
  ok("a failed item is kept", (await box.count()) === 1)

  await box.flush(async () => {})
  ok(
    "next flush sends it; the key is removed when empty",
    (await storage.get("signet-outbox")) === null,
  )
}
{
  // An item added while a flush is sending survives it.
  const box = createOutbox<string>({ storage: memoryStorage() })
  await box.add("a")
  let release = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const flushing = box.flush(async () => gate)
  await box.add("b")
  release()
  await flushing
  const left: string[] = []
  await box.flush(async (s) => {
    left.push(s)
  })
  ok("item added mid-flush is kept", left.join() === "b", left)
}
{
  const box = createOutbox<string>({ storage: memoryStorage() })
  await box.add("a")
  let sends = 0
  const send = async () => {
    sends++
    await new Promise((r) => setTimeout(r, 5))
  }
  const [x, y] = await Promise.all([box.flush(send), box.flush(send)])
  ok("concurrent flushes join: each item sent once", sends === 1 && x === 1 && y === 1, {
    sends,
    x,
    y,
  })
}
{
  const storage = memoryStorage()
  await storage.set("signet-outbox", "not json")
  ok("corrupt storage reads as empty", (await createOutbox({ storage }).count()) === 0)
  const box = createOutbox<number>({ storage, key: "other" })
  await box.add(1)
  await box.clear()
  ok("separate key + clear", (await box.count()) === 0)
}

// --- indexedDbStorage, against a fake with IndexedDB's request/callback shape ---
function fakeIndexedDB() {
  const stores = new Map<string, Map<string, unknown>>()
  const req = <T>(fn: () => T) => {
    const r = { result: undefined as T, error: null, onsuccess: null, onerror: null } as {
      result: T
      error: unknown
      onsuccess: null | (() => void)
      onerror: null | (() => void)
    }
    queueMicrotask(() => {
      r.result = fn()
      r.onsuccess?.()
    })
    return r
  }
  const db = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore: (n: string) => stores.set(n, new Map()),
    transaction: (s: string) => ({
      objectStore: () => {
        const m = stores.get(s) as Map<string, unknown>
        return {
          get: (k: string) => req(() => m.get(k)),
          put: (v: unknown, k: string) => req(() => m.set(k, v)),
          delete: (k: string) => req(() => m.delete(k)),
        }
      },
    }),
  }
  return {
    open() {
      const r = {
        result: db,
        error: null,
        onsuccess: null as null | (() => void),
        onerror: null,
        onupgradeneeded: null as null | (() => void),
      }
      queueMicrotask(() => {
        r.onupgradeneeded?.()
        r.onsuccess?.()
      })
      return r
    },
  }
}
{
  const s = indexedDbStorage({ indexedDB: fakeIndexedDB() })
  ok("idb: missing key is null", (await s.get("k")) === null)
  await s.set("k", "v")
  ok("idb: set then get", (await s.get("k")) === "v")
  await s.remove("k")
  ok("idb: remove", (await s.get("k")) === null)
  const box = createOutbox<number>({ storage: s })
  await box.add(7)
  ok("idb: outbox runs on it", (await box.count()) === 1)
}
{
  let err = ""
  await indexedDbStorage()
    .get("k")
    .catch((e: Error) => {
      err = e.message
    })
  ok("idb: clear error where there is no indexedDB", err.includes("no indexedDB"), err)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
