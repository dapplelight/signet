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
  }
}

/** The promise form of `chrome.storage.StorageArea` (MV3), typed by shape. */
export type ChromeStorageAreaLike = {
  get(keys: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string): Promise<void>
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
  }
}

/** `Store` / `LazyStore` from `@tauri-apps/plugin-store` v2, typed by shape. */
export type TauriStoreLike = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<unknown>
  save?(): Promise<void>
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
  }
}
