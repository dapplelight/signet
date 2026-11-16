### signet-lib: storage adapters, bearer sessions, platform-free imports

- New `./storage`: `StorageAdapter` (async `get`/`set`/`remove` of strings) with `memoryStorage()`, `webStorage()` (localStorage), `chromeStorage()` (MV3 `chrome.storage.local`, typed by shape) and `tauriStorage(store)` (an injected plugin-store `Store`). No backend is looked up until first use.
- New `./storage/file`: `fileStorage(path)`, a 0600 JSON file for Node/Bun CLIs, on its own path so browser bundles never pull in `fs`.
- New `./session`: `createSession({ storage, refresh })` keeps access and refresh tokens with `get`/`set`/`clear`/`subscribe`, and exposes `token` and `refresh` for the api client. `tokenEndpointRefresh(url, clientId)` and `fromTokenResponse()` talk to an OAuth token endpoint such as signet-server's `clientLoginRoutes`.
- `createApiClient` and `createRpcClient` take `token` (sent as `Authorization: Bearer`) and `refresh` (one refresh-and-retry on a 401). Without them nothing changes, so cookie auth works as before.
- Every export path is tested to import with no `window`, `document`, `localStorage`, `navigator` or `chrome`, so the package loads in a service worker, a Tauri webview, a Bun CLI and React Native.
