# __APP_NAME__

A Tauri v2 desktop and menu-bar app: React + Vite in the webview, styled with Signet's tokens and UI, signed in through the system browser.

## Run

You need [Rust](https://rustup.rs) and [Tauri's system dependencies](https://tauri.app/start/prerequisites/).

```sh
__PM_INSTALL__
__PM_X__ tauri dev
```

`__PM_RUN__ dev` alone runs just the webview (no sign-in or tray; those need Tauri).

## What is here

- `src/` the webview. `src/lib/auth.ts` is sign-in; `src/lib/pkce.ts` the PKCE helper.
- `src-tauri/src/main.rs` the tray icon (left click toggles the small `tray` window, right click opens the menu), the two windows and the loopback listener.
- `src-tauri/tauri.conf.json` windows, CSP and bundling. The identifier `com.example.__APP_ID__` is a placeholder: set your own before you ship.
- `src-tauri/capabilities/default.json` what the windows may call. Narrow the `opener:allow-open-url` scope to your API's origin.
- `src-tauri/icons/` placeholder icons. Replace them: `__PM_X__ tauri icon path/to/logo.png`.
- `.github/workflows/ci.yml` lint, typecheck and test, then an installer build on macOS, Windows and Linux.

## Sign-in

Authorization code + PKCE (S256) against signet-server's `clientLoginRoutes`, mounted at `<API>/auth`. The app opens `/authorize` in your browser (you must be signed in to the web app there), the server redirects to `http://127.0.0.1:<port>/callback`, a one-shot listener in Rust hands the code to the webview, and the webview swaps it for tokens. Tokens are kept in the Tauri store (`auth.json`) through `createSession`.

Register the client on the server:

```ts
clients: { "__APP_ID__-desktop": { redirectUris: ["http://127.0.0.1/callback"] } }
```

The server matches a port-less loopback URI on any port. Set `VITE_API_BASE` (default `http://localhost:8787/api`) to your API. The webview calls the API cross-origin, so the server's CORS must allow the webview's origin (`tauri://localhost` on macOS and Linux, `http://tauri.localhost` on Windows). In `tauri.conf.json`, narrow the CSP's `connect-src https:` to your API's origin.

## Release

CI builds unsigned installers. Code signing and notarization (Apple, Windows) are yours to add; see [Tauri's distribution guide](https://tauri.app/distribute/).
