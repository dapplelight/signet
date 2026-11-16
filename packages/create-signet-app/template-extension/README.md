# __APP_NAME__

A Chrome (Manifest V3) extension: a popup, an options page and a background
service worker, built with plain Vite. The UI is `@dapplelight/signet-ui` on a
`@dapplelight/signet-tokens` theme, with dark mode. Sign-in is authorization
code + PKCE through `chrome.identity.launchWebAuthFlow`, against the routes
`clientLoginRoutes` mounts in `@dapplelight/signet-server`.

## Load it

```sh
__PM_INSTALL__
__PM_RUN__ build
```

1. Open `chrome://extensions` and turn on Developer mode.
2. Load unpacked, and pick this project's `dist/` folder.
3. Copy the extension's ID from its card.

`__PM_RUN__ dev` rebuilds on every change; reload the extension on its card to
pick the new build up. Loading `dist/` from the same folder keeps the ID stable.

## Register it on the server

The server must know this extension before it will send it a code. In the
server that mounts `clientLoginRoutes` (see `@dapplelight/signet-server/auth/client-login`):

```ts
clients: {
  "__APP_NAME__": {
    redirectUris: ["https://<extension-id>.chromiumapp.org/"],
  },
},
```

- The client id is `VITE_CLIENT_ID` (default: this project's name).
- The redirect URI is `https://<extension-id>.chromiumapp.org/`, with the ID
  from step 3 and the trailing slash. It is matched exactly.
- `VITE_API_BASE` is where the server mounts those routes without `/auth`:
  `https://api.example.com/api` for `app.route("/api/auth", clientLoginRoutes(...))`.
  Copy `.env.example` to `.env` to change either variable.
- Put the same origin in `host_permissions` in `public/manifest.json`, or the
  extension's requests to it are blocked.

The user signs in on your web app in the window the extension opens. If they
are not signed in there yet, set `loginUrl` on `clientLoginRoutes` so the
server sends them to your login page and back.

## Layout

- `public/manifest.json`: Permissions `storage` and `identity`; copied to `dist/` as is
- `popup.html`, `src/popup.tsx`: The toolbar popup
- `options.html`, `src/options.tsx`: The options page (theme, account)
- `src/background.ts`: The service worker. It runs sign-in, because the popup closes when the sign-in window opens
- `src/lib/auth.ts`: `signIn`, `signOut` and the session in `chrome.storage.local`
- `src/lib/api.ts`: `api`: a bearer API client that refreshes the token on a 401
- `src/lib/pkce.ts`: The S256 verifier and challenge, with the RFC 7636 test vector

Extension pages cannot run inline scripts, so the theme is applied before
first paint by `public/theme-init.js`, not a `<script>` in the page.

## Scripts

`__PM_RUN__ build`, `__PM_RUN__ dev`, `__PM_RUN__ lint`, `__PM_RUN__ typecheck`, `__PM_RUN__ test`.
