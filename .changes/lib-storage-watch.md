### signet-lib: `StorageAdapter.watch`, so a session follows other windows and workers

- `StorageAdapter` gains an optional `watch(key, cb)` returning an unsubscribe. `chromeStorage` implements it with `chrome.storage` `onChanged`, `webStorage` with the window `storage` event (other tabs), and `tauriStorage` with the injected store's `onKeyChange` when it has one. Memory and file storage have none.
- `createSession` uses it: a sign-in, refresh or sign-out in another context (an extension's service worker, a second window) updates `get()`, `token()` and `subscribe()` listeners. Echoes of its own writes are ignored.
