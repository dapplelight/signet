/**
 * A small async key-value interface for strings, with an adapter per surface:
 * the web (localStorage), a Chrome MV3 extension (chrome.storage.local), a
 * Tauri app (an injected plugin-store `Store`), and memory. The Node/Bun file
 * adapter is a separate import, `@dapplelight/signet-lib/storage/file`, so a
 * browser bundle never pulls in `fs`.
 *
 * Nothing here touches a platform global at import time; each adapter looks
 * its backend up on first use, so the module loads in a service worker, a
 * webview, a CLI and React Native alike.
 */

export type StorageAdapter = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  /**
   * Call `cb` with the new value (null when removed) when `key` is changed from
   * outside this adapter's own writes' caller: another extension page, another
   * window or tab. Returns unsubscribe. Optional: absent where the backend
   * cannot tell (memory, files). `createSession` uses it to follow a sign-in,
   * sign-out or refresh made in another context.
   */
  watch?(key: string, cb: (value: string | null) => void): () => void
}

/** In-memory, per process. For tests, SSR and as a fallback. */
export function memoryStorage(): StorageAdapter {
  const map = new Map<string, string>()
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, value) {
      map.set(key, value)
    },
    async remove(key) {
      map.delete(key)
    },
  }
}

type WebStorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

type StorageEventLike = { key: string | null; newValue: string | null; storageArea?: unknown }

/** `localStorage` by default, read when first used; pass `sessionStorage` or a stub instead. */
export function webStorage(storage?: WebStorageLike): StorageAdapter {
  const s = () => storage ?? (globalThis as { localStorage?: WebStorageLike }).localStorage
  const need = () => {
    const found = s()
    if (!found) throw new Error("webStorage: no localStorage here; pass a Storage")
    return found
  }
  return {
    async get(key) {
      return need().getItem(key)
    },
    async set(key, value) {
      need().setItem(key, value)
    },
    async remove(key) {
      need().removeItem(key)
    },
    // The browser fires "storage" in the OTHER tabs of the origin, never the writer.
    watch(key, cb) {
      const g = globalThis as {
        addEventListener?: (t: "storage", l: (e: StorageEventLike) => void) => void
        removeEventListener?: (t: "storage", l: (e: StorageEventLike) => void) => void
      }
      if (!g.addEventListener) return () => {}
      const listener = (e: StorageEventLike) => {
        // key null: the whole area was cleared.
        if ((e.key === key || e.key === null) && (!e.storageArea || e.storageArea === s()))
          cb(e.key === null ? null : e.newValue)
      }
      g.addEventListener("storage", listener)
      return () => g.removeEventListener?.("storage", listener)
    },
  }
}

/** The promise form of `chrome.storage.StorageArea` (MV3), typed by shape. */
export type ChromeStorageAreaLike = {
  get(keys: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string): Promise<void>
  /** `chrome.storage.local.onChanged`: the changes are `{ [key]: { newValue? } }`. */
  onChanged?: {
    addListener(l: (changes: Record<string, { newValue?: unknown }>) => void): void
    removeListener(l: (changes: Record<string, { newValue?: unknown }>) => void): void
  }
}

/**
 * `chrome.storage.local` by default (needs the "storage" permission), shared
 * by the service worker, popup and options page. Pass `chrome.storage.session`
 * or `.sync` to use another area.
 */
export function chromeStorage(area?: ChromeStorageAreaLike): StorageAdapter {
  const a = () => {
    const found =
      area ??
      (globalThis as { chrome?: { storage?: { local?: ChromeStorageAreaLike } } }).chrome?.storage
        ?.local
    if (!found)
      throw new Error('chromeStorage: no chrome.storage.local; add the "storage" permission')
    return found
  }
  return {
    async get(key) {
      const v = (await a().get(key))[key]
      return typeof v === "string" ? v : null
    },
    async set(key, value) {
      await a().set({ [key]: value })
    },
    async remove(key) {
      await a().remove(key)
    },
    // Fires in every extension context, the writer's too; createSession ignores the echo.
    watch(key, cb) {
      const changed = a().onChanged
      if (!changed) return () => {}
      const listener = (changes: Record<string, { newValue?: unknown }>) => {
        if (!(key in changes)) return
        const v = changes[key]?.newValue
        cb(typeof v === "string" ? v : null)
      }
      changed.addListener(listener)
      return () => changed.removeListener(listener)
    },
  }
}

type IdbRequestLike<T> = {
  result: T
  error: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}
type IdbLike = {
  open(
    name: string,
    version?: number,
  ): IdbRequestLike<IdbDbLike> & {
    onupgradeneeded: (() => void) | null
  }
}
type IdbDbLike = {
  objectStoreNames: { contains(n: string): boolean }
  createObjectStore(n: string): unknown
  transaction(
    store: string,
    mode: "readonly" | "readwrite",
  ): {
    objectStore(n: string): {
      get(k: string): IdbRequestLike<unknown>
      put(v: string, k: string): IdbRequestLike<unknown>
      delete(k: string): IdbRequestLike<unknown>
    }
  }
}

const idbDone = <T>(r: IdbRequestLike<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })

/**
 * IndexedDB: larger than localStorage, and reachable from a service worker,
 * which localStorage is not. One object store of string values, opened on
 * first use. Pass `indexedDB` explicitly where it is not a global.
 */
export function indexedDbStorage(
  options: { db?: string; store?: string; indexedDB?: unknown } = {},
): StorageAdapter {
  const { db: name = "signet", store = "kv" } = options
  let opened: Promise<IdbDbLike> | null = null
  const open = () => {
    opened ??= (() => {
      const idb = (options.indexedDB ?? (globalThis as { indexedDB?: unknown }).indexedDB) as
        | IdbLike
        | undefined
      if (!idb) return Promise.reject(new Error("indexedDbStorage: no indexedDB here"))
      const req = idb.open(name, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store)
      }
      return idbDone(req)
    })()
    return opened
  }
  const os = async (mode: "readonly" | "readwrite") =>
    (await open()).transaction(store, mode).objectStore(store)
  return {
    async get(key) {
      const v = await idbDone((await os("readonly")).get(key))
      return typeof v === "string" ? v : null
    },
    async set(key, value) {
      await idbDone((await os("readwrite")).put(value, key))
    },
    async remove(key) {
      await idbDone((await os("readwrite")).delete(key))
    },
  }
}

/** `Store` / `LazyStore` from `@tauri-apps/plugin-store` v2, typed by shape. */
export type TauriStoreLike = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<unknown>
  save?(): Promise<void>
  /** plugin-store v2's `onKeyChange`: resolves to the unlisten function. */
  onKeyChange?(key: string, cb: (value: unknown) => void): Promise<() => void> | (() => void)
}

/**
 * A Tauri plugin-store `Store`, passed in so this package does not depend on
 * Tauri: `tauriStorage(await load("auth.json"))`. Saves after each write, so a
 * token survives the app being killed before the store's own auto-save.
 */
export function tauriStorage(store: TauriStoreLike): StorageAdapter {
  return {
    async get(key) {
      const v = await store.get(key)
      return typeof v === "string" ? v : null
    },
    async set(key, value) {
      await store.set(key, value)
      await store.save?.()
    },
    async remove(key) {
      await store.delete(key)
      await store.save?.()
    },
    // Only where the injected store has onKeyChange (plugin-store 2.x); else no watch.
    watch: store.onKeyChange
      ? (key, cb) => {
          let off: (() => void) | undefined
          let stopped = false
          Promise.resolve(
            store.onKeyChange?.(key, (v) => cb(typeof v === "string" ? v : null)),
          ).then((u) => {
            if (stopped) u?.()
            else off = u
          })
          return () => {
            stopped = true
            off?.()
          }
        }
      : undefined,
  }
}
