/** Storage adapters: the same get/set/remove contract over each backend. */

import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type ChromeStorageAreaLike,
  chromeStorage,
  memoryStorage,
  type StorageAdapter,
  type TauriStoreLike,
  tauriStorage,
  webStorage,
} from "../src/storage"
import { fileStorage } from "../src/storage/file"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, JSON.stringify(d)))
}

async function contract(name: string, s: StorageAdapter) {
  ok(`${name}: missing key is null`, (await s.get("k")) === null)
  await s.set("k", "v1")
  ok(`${name}: set then get`, (await s.get("k")) === "v1")
  await s.set("k", "v2")
  ok(`${name}: overwrite`, (await s.get("k")) === "v2")
  await s.remove("k")
  ok(`${name}: remove`, (await s.get("k")) === null)
  await s.remove("never-set")
  ok(`${name}: removing a missing key is fine`, true)
}

await contract("memory", memoryStorage())

const map = new Map<string, string>()
const fakeLocal = {
  getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => void map.set(k, v),
  removeItem: (k: string) => void map.delete(k),
}
await contract("web (injected)", webStorage(fakeLocal))
// Default: localStorage looked up on use, not at creation.
const lazy = webStorage()
;(globalThis as { localStorage?: unknown }).localStorage = fakeLocal
await lazy.set("x", "1")
ok("web: default localStorage read on first use", map.get("x") === "1")
delete (globalThis as { localStorage?: unknown }).localStorage
let threw = false
try {
  await webStorage().get("x")
} catch {
  threw = true
}
ok("web: no localStorage throws a clear error", threw)

const area: Record<string, unknown> = {}
const fakeArea: ChromeStorageAreaLike = {
  async get(k) {
    return k in area ? { [k]: area[k] } : {}
  },
  async set(items) {
    Object.assign(area, items)
  },
  async remove(k) {
    delete area[k]
  },
}
await contract("chrome (injected)", chromeStorage(fakeArea))
;(globalThis as { chrome?: unknown }).chrome = { storage: { local: fakeArea } }
await chromeStorage().set("y", "2")
ok("chrome: default is chrome.storage.local", area.y === "2")
area.z = 42
ok("chrome: a non-string value reads as null", (await chromeStorage().get("z")) === null)
delete (globalThis as { chrome?: unknown }).chrome

const store = new Map<string, unknown>()
let saves = 0
const fakeStore: TauriStoreLike = {
  async get(k) {
    return store.get(k)
  },
  async set(k, v) {
    store.set(k, v)
  },
  async delete(k) {
    return store.delete(k)
  },
  async save() {
    saves++
  },
}
await contract("tauri", tauriStorage(fakeStore))
ok("tauri: saves after each write", saves === 4, saves)

// --- watch: changes from other contexts ---
{
  // chrome: onChanged fires for the watched key only; unsubscribe stops it.
  let listener: ((c: Record<string, { newValue?: unknown }>) => void) | undefined
  const watched: ChromeStorageAreaLike = {
    ...fakeArea,
    onChanged: {
      addListener: (l) => {
        listener = l
      },
      removeListener: (l) => {
        if (listener === l) listener = undefined
      },
    },
  }
  const seen: (string | null)[] = []
  const off = chromeStorage(watched).watch?.("k", (v) => seen.push(v)) ?? (() => {})
  listener?.({ other: { newValue: "x" } })
  listener?.({ k: { newValue: "a" } })
  listener?.({ k: {} })
  listener?.({ k: { newValue: 5 } })
  ok(
    "chrome watch: own key only, removal and non-strings are null",
    JSON.stringify(seen) === '["a",null,null]',
    seen,
  )
  off()
  ok("chrome watch: unsubscribe removes the listener", listener === undefined)
  ok(
    "chrome watch: none when the area has no onChanged",
    (() => {
      const off2 = chromeStorage(fakeArea).watch?.("k", () => {})
      off2?.()
      return typeof off2 === "function"
    })(),
  )

  // tauri: only when the injected store has onKeyChange; the unlisten arrives async.
  ok("tauri watch: absent without onKeyChange", tauriStorage(fakeStore).watch === undefined)
  let tcb: ((v: unknown) => void) | undefined
  let unlistened = false
  const tw = tauriStorage({
    ...fakeStore,
    onKeyChange: async (_k, cb) => {
      tcb = cb
      return () => {
        unlistened = true
      }
    },
  })
  const tseen: (string | null)[] = []
  const toff = tw.watch?.("k", (v) => tseen.push(v)) ?? (() => {})
  tcb?.("a")
  tcb?.(undefined)
  ok("tauri watch: string value, else null", JSON.stringify(tseen) === '["a",null]', tseen)
  await Promise.resolve()
  toff()
  ok("tauri watch: unsubscribe calls the unlisten", unlistened)

  // web: the window "storage" event, key-matched; cleared (key null) is null.
  const g = globalThis as { addEventListener?: unknown; removeEventListener?: unknown }
  const prev = { a: g.addEventListener, r: g.removeEventListener }
  let wl:
    | ((e: { key: string | null; newValue: string | null; storageArea?: unknown }) => void)
    | undefined
  g.addEventListener = (_t: string, l: typeof wl) => {
    wl = l
  }
  g.removeEventListener = () => {
    wl = undefined
  }
  const wseen: (string | null)[] = []
  const woff = webStorage(fakeLocal).watch?.("k", (v) => wseen.push(v)) ?? (() => {})
  wl?.({ key: "other", newValue: "x" })
  wl?.({ key: "k", newValue: "a" })
  wl?.({ key: null, newValue: null })
  wl?.({ key: "k", newValue: "z", storageArea: {} })
  ok(
    "web watch: key match, clear is null, other areas ignored",
    JSON.stringify(wseen) === '["a",null]',
    wseen,
  )
  woff()
  ok("web watch: unsubscribe", wl === undefined)
  g.addEventListener = undefined
  ok(
    "web watch: no window events is a no-op",
    typeof webStorage(fakeLocal).watch?.("k", () => {}) === "function",
  )
  g.addEventListener = prev.a
  g.removeEventListener = prev.r
  ok(
    "memory and file have no watch",
    memoryStorage().watch === undefined && fileStorage("/x").watch === undefined,
  )
}

const dir = mkdtempSync(join(tmpdir(), "signet-storage-"))
try {
  const path = join(dir, "nested", "auth.json")
  await contract("file", fileStorage(path))
  const f = fileStorage(path)
  await Promise.all([f.set("a", "1"), f.set("b", "2"), f.set("c", "3")])
  ok(
    "file: concurrent writes all land",
    JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) === '{"a":"1","b":"2","c":"3"}',
  )
  ok(
    "file: owner-only mode",
    (statSync(path).mode & 0o777) === 0o600,
    (statSync(path).mode & 0o777).toString(8),
  )
  ok("file: a second instance reads the same file", (await fileStorage(path).get("b")) === "2")
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
