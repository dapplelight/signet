### create-signet-app: `--template extension` scaffolds a Chrome MV3 extension

`create-signet-app my-ext --template extension` writes a Manifest V3 extension:
a popup, an options page (React, `signet-ui`, a `signet-tokens` theme with dark
mode) and a background service worker, built by plain Vite with no extension
plugin. Sign-in is authorization code + PKCE through `chrome.identity.launchWebAuthFlow`
against `clientLoginRoutes`; tokens are kept with `createSession` and
`chromeStorage()`, and API calls go through `createApiClient` with bearer tokens
and `tokenEndpointRefresh`. The README covers loading it unpacked and registering
the client id and `https://<extension-id>.chromiumapp.org/` redirect URI on the server.
