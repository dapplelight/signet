import type { StorageAdapter } from "@dapplelight/signet-lib/storage"
import * as SecureStore from "expo-secure-store"
import kv from "expo-sqlite/kv-store"

/** The Keychain / Keystore, for the session's tokens. Small values only (about 2 KB). */
export const secureStorage: StorageAdapter = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
}

/** A key-value table in SQLite, for everything else: the outbox, preferences. Not encrypted. */
export const appStorage: StorageAdapter = {
  get: (key) => kv.getItem(key),
  set: (key, value) => kv.setItem(key, value),
  remove: (key) => kv.removeItem(key),
}
