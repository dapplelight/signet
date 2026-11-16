/**
 * Where the server is and who this extension is to it. Vite reads VITE_API_BASE
 * and VITE_CLIENT_ID at build time (they end up in the bundle: nothing secret).
 *
 * API_BASE is the prefix `clientLoginRoutes` is mounted under, minus `/auth`,
 * e.g. https://api.example.com/api for `app.route("/api/auth", ...)`.
 * CLIENT_ID is this extension's key in the server's `clients` map. Put the
 * server's origin in host_permissions in public/manifest.json.
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:8787/api"
export const CLIENT_ID: string = import.meta.env.VITE_CLIENT_ID ?? "__APP_NAME__"
