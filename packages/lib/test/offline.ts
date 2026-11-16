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
// Databases persist across open() calls and only run onupgradeneeded for a higher version, like the real one.
// `ctl.failCommit` makes readwrite transactions abort at commit (a full disk) after their requests succeeded.
function fakeIndexedDB() {
  const dbs = new Map<string, { version: number; stores: Map<string, Map<string, unknown>> }>()
  // `blockUpgrade`: another connection ignores versionchange, so an upgrade fires onblocked and waits.
  const ctl = { failCommit: false, blockUpgrade: false }
  const connect = (d: { version: number; stores: Map<string, Map<string, unknown>> }) => ({
    version: d.version,
    close() {},
    onversionchange: null,
    objectStoreNames: { contains: (n: string) => d.stores.has(n) },
    createObjectStore: (n: string) => d.stores.set(n, new Map()),
    transaction(s: string) {
      const m = d.stores.get(s)
      if (!m) throw new Error("NotFoundError")
      const tx = {
        error: null as unknown,
        oncomplete: null as null | (() => void),
        onabort: null as null | (() => void),
        onerror: null as null | (() => void),
        wrote: false,
        objectStore: () => ({
          get: (k: string) => req(() => m.get(k)),
          put: (v: unknown, k: string) => {
            tx.wrote = true
            return req(() => {
              if (!ctl.failCommit) m.set(k, v)
            })
          },
          delete: (k: string) => {
            tx.wrote = true
            return req(() => {
              if (!ctl.failCommit) m.delete(k)
            })
          },
        }),
      }
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
          queueMicrotask(() => {
            if (ctl.failCommit && tx.wrote) {
              tx.error = new Error("QuotaExceededError")
              tx.onabort?.()
            } else tx.oncomplete?.()
          })
        })
        return r
      }
      return tx
    },
  })
  return {
    ctl,
    open(name: string, version?: number) {
      const r = {
        result: undefined as unknown,
        error: null,
        onsuccess: null as null | (() => void),
        onerror: null,
        onupgradeneeded: null as null | (() => void),
        onblocked: null as null | (() => void),
      }
      queueMicrotask(() => {
        let d = dbs.get(name)
        const upgrade = !d || (version !== undefined && version > d.version)
        if (d && upgrade && ctl.blockUpgrade) {
          r.onblocked?.()
          return
        }
        if (!d) {
          d = { version: version ?? 1, stores: new Map() }
          dbs.set(name, d)
        } else if (upgrade) d.version = version as number
        r.result = connect(d)
        if (upgrade) r.onupgradeneeded?.()
        r.onsuccess?.()
      })
      return r
    },
  }
}
{
  const fake = fakeIndexedDB()
  const first = indexedDbStorage({ indexedDB: fake, store: "outbox" })
  await first.set("k", "1")
  // Same database name, another store, opened later (or by another context).
  const second = indexedDbStorage({ indexedDB: fake, store: "session" })
  await second.set("k", "2")
  ok(
    "idb: a second store in an existing database is created",
    (await second.get("k")) === "2" && (await first.get("k")) === "1",
  )
}
{
  const fake = fakeIndexedDB()
  await indexedDbStorage({ indexedDB: fake, store: "other" }).set("k", "1")
  const s = indexedDbStorage({ indexedDB: fake })
  fake.ctl.blockUpgrade = true
  let err = ""
  await s.get("k").catch((e: Error) => {
    err = e.message
  })
  ok("idb: a blocked upgrade rejects instead of hanging", err.includes("blocking the upgrade"), err)
  fake.ctl.blockUpgrade = false
  ok("idb: and a later call retries", (await s.get("k")) === null)
}
{
  const fake = fakeIndexedDB()
  const s = indexedDbStorage({ indexedDB: fake })
  fake.ctl.failCommit = true
  let err = ""
  await s.set("k", "v").catch((e: Error) => {
    err = e.message
  })
  fake.ctl.failCommit = false
  ok("idb: a write that aborts at commit rejects", err === "QuotaExceededError", err)
  ok("idb: and nothing was stored", (await s.get("k")) === null)
}
{
  // Two outboxes on one key (two tabs) with Web Locks: each item is sent once.
  const held = new Map<string, Promise<unknown>>()
  const nav = {
    locks: {
      request<R>(n: string, cb: () => Promise<R>): Promise<R> {
        const run = (held.get(n) ?? Promise.resolve()).then(cb, cb)
        held.set(
          n,
          run.catch(() => {}),
        )
        return run
      },
    },
  }
  const had = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true })
  try {
    const storage = memoryStorage()
    const tab1 = createOutbox<string>({ storage })
    const tab2 = createOutbox<string>({ storage })
    await tab1.add("x")
    await tab2.add("y")
    const sent: string[] = []
    const send = async (s: string) => {
      await new Promise((r) => setTimeout(r, 5))
      sent.push(s)
    }
    await Promise.all([tab1.flush(send), tab2.flush(send)])
    ok("two tabs, one key: each item sent once", sent.sort().join() === "x,y", sent)
    ok("two tabs: outbox empty after", (await tab1.count()) === 0)
  } finally {
    if (had) Object.defineProperty(globalThis, "navigator", had)
    else Reflect.deleteProperty(globalThis, "navigator")
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
